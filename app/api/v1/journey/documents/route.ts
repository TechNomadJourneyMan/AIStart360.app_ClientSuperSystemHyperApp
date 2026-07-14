import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { extractFromDocument } from '@/lib/documents/extract'
import { identityFromRequest, journeyErrorResponse, resolveJourneyActor } from '@/lib/journey/http'
import { assertSafeJourneyFile, UnsafeJourneyFileError } from '@/lib/journey/file-safety'
import { isRateLimited, isRateLimitedKey } from '@/lib/rate-limit'
import { enforceJourneyStatePolicy } from '@/lib/journey/policy'
import {
  appendJourneyMessages,
  loadJourneyState,
  saveJourneyState,
  storeJourneyFile,
  upsertJourneyFile,
} from '@/lib/journey/persistence'
import {
  journeyFactSchema,
  journeyFileSchema,
  journeyStateSchema,
  journeyWidgetSchema,
  type JourneyFact,
  type JourneyState,
  type JourneyWidget,
} from '@/lib/journey/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Vercel buffers multipart Function bodies and rejects requests above ~4.5 MB.
// Keep headroom for form boundaries + serialized workspace state.
const MAX_FILE_BYTES = 4 * 1024 * 1024
const MIME_BY_EXTENSION: Record<string, string[]> = {
  pdf: ['application/pdf'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  csv: ['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain'],
  txt: ['text/plain'],
}

export async function POST(request: Request) {
  try {
    const actorUserId = await resolveJourneyActor()
    const form = await request.formData()
    const workspaceId = z.string().min(8).max(120).parse(form.get('workspaceId'))
    const rawAccessToken = form.get('accessToken')
    const accessToken = rawAccessToken == null || rawAccessToken === ''
      ? undefined
      : z.string().min(24).max(240).parse(rawAccessToken)
    const identity = identityFromRequest(request, { workspaceId, accessToken })
    if (
      await isRateLimited(request, 'journey-document-ip', { max: 10, windowMs: 60 * 60_000 }) ||
      await isRateLimitedKey(identity.workspaceId, 'journey-document', { max: 5, windowMs: 10 * 60_000 })
    ) {
      return NextResponse.json(
        { error: { code: 'JOURNEY_RATE_LIMIT', message: 'Лимит анализа файлов исчерпан. Попробуйте позже.' } },
        { status: 429 },
      )
    }
    const stateJson = z.string().min(2).max(1_000_000).parse(form.get('state'))
    const stateFromClient = journeyStateSchema.parse(JSON.parse(stateJson))
    const fileValue = form.get('file')
    if (!(fileValue instanceof File)) {
      return NextResponse.json(
        { error: { code: 'FILE_REQUIRED', message: 'Добавьте файл для анализа.' } },
        { status: 400 },
      )
    }
    const file = fileValue
    const fileInfo = validateFile(file)
    await loadJourneyState(identity, actorUserId)
    const state = stateFromClient
    const buffer = Buffer.from(await file.arrayBuffer())
    try {
      assertSafeJourneyFile(buffer, fileInfo.extension)
    } catch (error) {
      if (error instanceof UnsafeJourneyFileError) {
        return NextResponse.json(
          { error: { code: 'UNSAFE_JOURNEY_FILE', message: error.message } },
          { status: 400 },
        )
      }
      throw error
    }
    const fileId = `file-${randomUUID()}`
    const analyzingFile = journeyFileSchema.parse({
      id: fileId,
      name: fileInfo.safeName,
      sizeBytes: file.size,
      mime: file.type || fileInfo.mime,
      status: 'analyzing',
      statusLabel: 'Анализируем документ…',
    })
    try {
      const extracted = await extractFromDocument({
        buffer,
        fileName: fileInfo.safeName,
        mimeType: file.type || fileInfo.mime,
        docType: inferDocumentType(fileInfo.safeName),
        // Raw business documents never leave this server route. Only facts the
        // user later confirms may enter the chat/orchestration context.
        allowAi: false,
        extractRows: false,
      })
      const facts = extracted.extraction.fields.slice(0, 20).map((field) =>
        journeyFactSchema.parse({
          id: `fact-${randomUUID()}`,
          label: field.label,
          value: fieldValue(field.value),
          category: categoryFromTarget(field.target_tab),
          sourceLabel: fileInfo.safeName,
          confidence: field.confidence,
          status: 'pending',
        }),
      )
      const readyFile = journeyFileSchema.parse({
        ...analyzingFile,
        status: 'ready',
        statusLabel: facts.length
          ? `Готово · найдено фактов: ${facts.length}`
          : 'Готово · факты для автозаполнения не найдены',
        documentId: fileId,
      })
      // Store the original only after the safety preflight and parser both
      // succeed; malicious/polyglot input must not enter the knowledge base.
      const storagePath = await storeJourneyFile(
        identity,
        fileId,
        fileInfo.safeName,
        analyzingFile.mime,
        buffer,
      )
      const next = addDocumentResult(state, readyFile, facts, extracted.modelUsed)
      const previousMessageIds = new Set(state.messages.map((message) => message.id))
      const saved = await saveJourneyState(identity, enforceJourneyStatePolicy(next), actorUserId)
      await upsertJourneyFile(identity, readyFile, {
        storagePath,
        parser: extracted.modelUsed,
        facts,
      })
      await appendJourneyMessages(
        identity,
        saved.state.messages.filter((message) => !previousMessageIds.has(message.id)),
        saved.state.provider.mode,
      )
      return NextResponse.json({
        state: saved.state,
        provider: saved.state.provider,
        persistence: saved.persistence,
        analysis: {
          parser: extracted.modelUsed,
          extractedFacts: facts.length,
          stored: Boolean(storagePath),
        },
      })
    } catch (parseError) {
      console.warn('[journey:documents] parse failed', parseError)
      const failedFile = journeyFileSchema.parse({
        ...analyzingFile,
        status: 'error',
        statusLabel: 'Не удалось прочитать файл',
        documentId: fileId,
      })
      const next = addDocumentError(state, failedFile)
      const saved = await saveJourneyState(identity, enforceJourneyStatePolicy(next), actorUserId)
      await upsertJourneyFile(identity, failedFile, {
        error: parseError instanceof Error ? parseError.message.slice(0, 500) : 'parse_failed',
      })
      return NextResponse.json({
        state: saved.state,
        provider: saved.state.provider,
        persistence: saved.persistence,
        analysis: { parser: 'failed', extractedFacts: 0, stored: false },
      })
    }
  } catch (error) {
    return journeyErrorResponse(error)
  }
}

function validateFile(file: File): { extension: string; mime: string; safeName: string } {
  const safeName = file.name.replace(/[\u0000-\u001f/\\]/g, '_').trim().slice(-255)
  const extension = safeName.toLowerCase().split('.').pop() ?? ''
  const accepted = MIME_BY_EXTENSION[extension]
  if (!accepted) {
    throw new z.ZodError([
      { code: 'custom', path: ['file'], message: 'Поддерживаются PDF, DOCX, CSV и TXT. Excel временно отключён в Journey из-за проверки безопасности парсера.' },
    ])
  }
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
    throw new z.ZodError([
      { code: 'custom', path: ['file'], message: 'Размер файла должен быть от 1 байта до 4 МБ.' },
    ])
  }
  const mime = file.type.toLowerCase()
  if (mime && !accepted.includes(mime)) {
    throw new z.ZodError([
      { code: 'custom', path: ['file'], message: 'MIME-тип не соответствует расширению файла.' },
    ])
  }
  return { extension, mime: accepted[0], safeName }
}

function addDocumentResult(
  state: JourneyState,
  file: JourneyState['files'][number],
  newFacts: JourneyFact[],
  parser: string,
): JourneyState {
  const now = new Date().toISOString()
  const known = new Set(state.facts.map((fact) => `${fact.label}:${fact.value}`.toLowerCase()))
  const facts = [
    ...state.facts,
    ...newFacts.filter((fact) => !known.has(`${fact.label}:${fact.value}`.toLowerCase())),
  ].slice(0, 80)
  const files = [
    ...state.files.filter((item) =>
      item.id !== file.id &&
      !(item.name === file.name && (item.status === 'uploading' || item.status === 'analyzing')),
    ),
    file,
  ].slice(0, 30)
  const widgets = upsertWidgets(state.widgets, [
    safeWidget('knowledge_base', 'База знаний', 82, 740, 880, { files }),
    safeWidget('business_passport', 'Паспорт бизнеса', 100, 100, 620, {
      facts: facts.filter((fact) => fact.status !== 'rejected').slice(0, 16),
    }),
  ])
  const foundText = newFacts.length
    ? `Из файла «${file.name}» извлечено ${newFacts.length} фактов. Проверьте значения перед добавлением в Точку A.`
    : `Файл «${file.name}» прочитан, но структурированные бизнес-показатели не найдены. Я не стал придумывать значения.`
  const heuristic = parser === 'heuristic-parser' || parser === 'document-parser'

  return journeyStateSchema.parse({
    ...state,
    phase: facts.length ? 'partial' : state.phase,
    messages: [
      ...state.messages,
      { id: `message-${randomUUID()}`, role: 'user', text: `Загружен файл: ${file.name}`, createdAt: now },
      { id: `message-${randomUUID()}`, role: 'assistant', text: foundText, createdAt: now },
    ].slice(-80),
    facts,
    files,
    widgets,
    suggestions: newFacts.length
      ? [{ id: 'confirm-file-facts', label: 'Проверить факты', value: 'Покажи данные из файла для подтверждения.', target: 'point-a', status: 'active' }]
      : state.suggestions,
    provider: heuristic
      ? { mode: 'demo', label: 'Демо-режим · эвристический анализ файла' }
      : { mode: 'live', label: 'AI анализ документов · structured output' },
    updatedAt: now,
  })
}

function addDocumentError(
  state: JourneyState,
  file: JourneyState['files'][number],
): JourneyState {
  const now = new Date().toISOString()
  const files = [
    ...state.files.filter((item) =>
      item.id !== file.id &&
      !(item.name === file.name && (item.status === 'uploading' || item.status === 'analyzing')),
    ),
    file,
  ].slice(0, 30)
  return journeyStateSchema.parse({
    ...state,
    phase: state.facts.length ? 'partial' : 'error',
    files,
    widgets: upsertWidgets(state.widgets, [
      safeWidget('knowledge_base', 'База знаний', 82, 740, 880, { files }),
    ]),
    messages: [
      ...state.messages,
      {
        id: `message-${randomUUID()}`,
        role: 'assistant',
        text: `Не удалось прочитать «${file.name}». Проверьте, что файл не повреждён, и повторите загрузку.`,
        createdAt: now,
      },
    ].slice(-80),
    updatedAt: now,
  })
}

function safeWidget(
  kind: JourneyWidget['kind'],
  title: string,
  priority: number,
  x: number,
  y: number,
  data: Record<string, unknown>,
): JourneyWidget {
  return journeyWidgetSchema.parse({
    id: `widget-${kind}`,
    kind,
    title,
    priority,
    collapsed: false,
    hidden: false,
    focused: false,
    position: { x, y },
    data,
  })
}

function upsertWidgets(current: JourneyWidget[], incoming: JourneyWidget[]): JourneyWidget[] {
  const merged = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) {
    const previous = merged.get(item.id)
    merged.set(item.id, previous
      ? { ...item, collapsed: previous.collapsed, hidden: previous.hidden, focused: previous.focused, position: previous.position } as JourneyWidget
      : item)
  }
  return [...merged.values()].sort((a, b) => b.priority - a.priority).slice(0, 24)
}

function inferDocumentType(name: string): string {
  if (/p[&_ -]?l|profit|прибыл|опу/i.test(name)) return 'pl_report'
  if (/sales|продаж|сделк|crm/i.test(name)) return 'sales_report'
  if (/маркет|campaign|ads?/i.test(name)) return 'marketing_report'
  if (/баланс|balance/i.test(name)) return 'balance_sheet'
  return 'other'
}

function categoryFromTarget(target: string): JourneyFact['category'] {
  if (/финанс/i.test(target)) return 'finance'
  if (/маркет/i.test(target)) return 'marketing'
  if (/баз|продаж|клиент/i.test(target)) return 'sales'
  if (/орг|команд/i.test(target)) return 'team'
  if (/операц|процесс/i.test(target)) return 'operations'
  if (/цел/i.test(target)) return 'goal'
  return 'other'
}

function fieldValue(value: string | number | boolean | string[] | number[]): string {
  if (Array.isArray(value)) return value.join(', ').slice(0, 1_000)
  return String(value).slice(0, 1_000)
}
