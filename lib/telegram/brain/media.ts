/**
 * Files sent to the assistant, turned into a question.
 *
 *   voice / audio → getFile → transcribe → «🎙 текст» shown → the question;
 *   photo         → vision description; without a caption it IS the answer,
 *                   with a caption it goes to the model as fenced context;
 *   document      → preflight (lib/documents/preflight.ts) → extractDocumentText
 *                   (pdf / xlsx / docx / csv / txt …, char cap) → fenced
 *                   context; an image document is handled like a photo.
 * Photos and documents are remembered (file_id, not bytes) so the person can
 * ask to attach the last file to a client. Downloads are capped at 20 MB.
 */
import { fenceUntrusted } from '@/lib/ai/gateway'
import { extractDocumentText, hasNoText } from '@/lib/documents/text'
import { preflightDocument } from '@/lib/documents/preflight'
import type { BotContext, IncomingMedia } from '../bots/dispatcher'
import { downloadTelegramFile, TG_DOWNLOAD_MAX_BYTES } from '../bots/registry'
import { esc } from '../bots/ui'
import type { TurnInput } from './engine'
import { toTelegramHtml } from './engine'
import type { MemoryBot, RememberedFile } from './memory'
import type { BrainDeps, BrainRole } from './types'

export const DOCUMENT_TEXT_MAX_CHARS = 40_000
const VISION_TIMEOUT_MS = 60_000

export type MediaOutcome =
  | { kind: 'turn'; input: TurnInput; file: RememberedFile | null }
  | { kind: 'done' }

const DOWNLOAD_ERRORS: Record<string, string> = {
  too_large: '📦 Файл больше 20 МБ — Telegram не отдаёт такие файлы ботам. Сожмите его или загрузите в кабинете.',
  not_found: 'Не удалось получить файл из Telegram. Пришлите его ещё раз.',
  unavailable: 'Telegram сейчас не отдаёт файл. Попробуйте ещё раз через минуту.',
  not_configured: 'Бот не настроен для приёма файлов.',
}

async function remember(ctx: BotContext<unknown>, deps: BrainDeps, role: BrainRole, media: IncomingMedia, kind: 'photo' | 'document', fileName: string, mime: string | null, size: number): Promise<RememberedFile | null> {
  const file = { fileId: media.fileId, fileName, mime, size, kind }
  const id = await deps.memory.rememberFile(ctx.bot as MemoryBot, ctx.chatId, role.userId, file)
  return id ? { ...file, id, at: deps.now() } : null
}

async function photoTurn(
  ctx: BotContext<unknown>, deps: BrainDeps, role: BrainRole, bytes: Buffer, mime: string, caption: string, file: RememberedFile | null, name: string,
): Promise<MediaOutcome> {
  const dataUrl = `data:${mime};base64,${bytes.toString('base64')}`
  const prompt = caption
    ? 'Опиши изображение подробно и точно: весь текст, цифры, таблицы, графики, подписи. Без оценок и выводов.'
    : 'Опиши, что на изображении, и кратко выдели главное (цифры, выводы). Если это документ или скриншот — перескажи его содержание. Отвечай по-русски.'
  const r = await deps.llm.describeImage({ userId: role.userId, dataUrl, prompt, timeoutMs: VISION_TIMEOUT_MS })
  if (!r.ok) {
    await ctx.reply(/UNAVAILABLE|NO_API_KEY|NO_ROUTE/i.test(r.code)
      ? '🤖 Разбор изображений сейчас недоступен (нет модели с поддержкой изображений).'
      : 'Не удалось разобрать изображение. Попробуйте ещё раз.')
    return { kind: 'done' }
  }
  if (!caption) {
    await ctx.reply(toTelegramHtml(r.text))
    await deps.memory.append(ctx.bot as MemoryBot, ctx.chatId, role.userId, [
      { role: 'user', content: `[Изображение: ${name}]` },
      { role: 'assistant', content: r.text.slice(0, 4000) },
    ])
    return { kind: 'done' }
  }
  return {
    kind: 'turn',
    file,
    input: { text: caption, extra: fenceUntrusted('image_description', `Изображение «${name}»:\n${r.text}`, 12_000), display: `[Изображение: ${name}] ${caption}`, tier: 'standard' },
  }
}

export async function prepareMedia(ctx: BotContext<unknown>, deps: BrainDeps, role: BrainRole, media: IncomingMedia, caption: string): Promise<MediaOutcome> {
  if (media.fileSize !== null && media.fileSize > TG_DOWNLOAD_MAX_BYTES) {
    await ctx.reply(DOWNLOAD_ERRORS.too_large)
    return { kind: 'done' }
  }
  const dl = await downloadTelegramFile(ctx.bot, media.fileId, { fetchImpl: ctx.deps.fetchImpl })
  if (!dl.ok) {
    await ctx.reply(DOWNLOAD_ERRORS[dl.reason] ?? DOWNLOAD_ERRORS.unavailable)
    return { kind: 'done' }
  }

  if (media.kind === 'voice' || media.kind === 'audio') {
    const r = await deps.llm.transcribe({ userId: role.userId, bytes: dl.bytes, filename: media.fileName ?? 'voice.ogg', mime: media.mime ?? 'audio/ogg', language: 'ru' })
    if (!r.ok) {
      await ctx.reply(/UNAVAILABLE|NO_API_KEY|NO_ROUTE/i.test(r.code)
        ? '🤖 Распознавание речи сейчас недоступно. Напишите вопрос текстом.'
        : 'Не удалось распознать голосовое сообщение. Попробуйте ещё раз или напишите текстом.')
      return { kind: 'done' }
    }
    const text = r.text.trim().slice(0, 4000)
    if (!text) {
      await ctx.reply('Не расслышал — в сообщении нет речи. Попробуйте ещё раз.')
      return { kind: 'done' }
    }
    await ctx.reply(`🎙 ${esc(text)}`)
    const question = caption ? `${caption}\n${text}` : text
    return { kind: 'turn', file: null, input: { text: question, display: `🎙 ${question}` } }
  }

  if (media.kind === 'photo') {
    const file = await remember(ctx, deps, role, media, 'photo', 'photo.jpg', 'image/jpeg', dl.bytes.length)
    return photoTurn(ctx, deps, role, dl.bytes, 'image/jpeg', caption, file, 'фото')
  }

  // Document.
  const name = (media.fileName ?? 'document').slice(0, 200)
  const check = preflightDocument(dl.bytes, name, { maxBytes: TG_DOWNLOAD_MAX_BYTES })
  if (!check.ok) {
    await ctx.reply(`📄 Файл «${esc(name)}» не принят: ${esc(check.reason)}`)
    return { kind: 'done' }
  }
  const file = await remember(ctx, deps, role, media, 'document', name, check.mime, dl.bytes.length)
  if (check.kind === 'image') return photoTurn(ctx, deps, role, dl.bytes, check.mime, caption, file, name)

  let text: string
  let truncated = false
  try {
    const st = await extractDocumentText(dl.bytes, check.kind, { maxChars: DOCUMENT_TEXT_MAX_CHARS, maxPdfPages: 60, maxSheetRows: 3000 })
    if (hasNoText(st)) {
      await ctx.reply(`📄 В файле «${esc(name)}» нет текстового слоя (похоже на скан).${role.bot === 'admin' ? ' Его можно прикрепить к клиенту — напишите, к какому.' : ''}`)
      return { kind: 'done' }
    }
    text = st.text
    truncated = st.truncated
  } catch {
    await ctx.reply(`📄 Не удалось прочитать текст файла «${esc(name)}».${role.bot === 'admin' ? ' Его всё равно можно прикрепить к клиенту — напишите, к какому.' : ''}`)
    return { kind: 'done' }
  }
  const question = caption || 'Кратко перескажи содержание документа и выдели главное: цифры, выводы, риски.'
  return {
    kind: 'turn',
    file,
    input: {
      text: question,
      extra: fenceUntrusted('document', `Файл «${name}»${truncated ? ' (текст обрезан)' : ''}:\n${text}`, DOCUMENT_TEXT_MAX_CHARS + 500),
      display: `[Файл: ${name}] ${question}`,
      tier: 'standard',
    },
  }
}
