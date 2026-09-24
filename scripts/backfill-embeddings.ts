/**
 * scripts/backfill-embeddings.ts — index already-parsed documents for chat
 * search (F-073). Documents uploaded while ENABLE_DOCUMENT_EMBEDDINGS was off
 * (or before migration 091, when clients without a Prisma `clients` row were
 * silently skipped) have no chunks, so the chat cannot quote them.
 *
 *   npx tsx scripts/backfill-embeddings.ts                 # dry-run: план и оценка стоимости
 *   npx tsx scripts/backfill-embeddings.ts --apply         # проиндексировать
 *   npx tsx scripts/backfill-embeddings.ts --apply --limit=20 --user=<uuid> --force
 *
 * Флаги:
 *   --apply        выполнить (без него — только план; файлы скачиваются и
 *                  разбираются локально, это бесплатно, ИИ не вызывается)
 *   --limit=N      не больше N документов (по умолчанию 200)
 *   --user=<uuid>  только документы этого пользователя
 *   --force        переиндексировать и уже проиндексированные документы
 *
 * Оценка стоимости (openai/text-embedding-3-small, $0.02 за 1M токенов):
 *   токены ≈ символы × 1,25 (перекрытие чанков 200/1000) / 2,5 (кириллица ≈ 2,5 символа на токен)
 *   $     ≈ токены × 0,02 / 1 000 000   → ~ $0,01 на 1 млн символов текста
 * Фактические токены и стоимость пишутся в ai_usage (feature = doc_embed).
 *
 * Переменные окружения: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * DATABASE_URL (Prisma, запись чанков), OPENROUTER_API_KEY (только для --apply).
 * Нужна применённая миграция 091.
 */

import fs from 'node:fs'
import path from 'node:path'

function loadEnv(file: string): void {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let val = m[2].trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    if (process.env[m[1]] === undefined) process.env[m[1]] = val
  }
}
loadEnv(path.resolve(process.cwd(), '.env.local'))
loadEnv(path.resolve(process.cwd(), '.env'))

const arg = (name: string): string | undefined => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`)

interface DocRow {
  id: string
  user_id: string
  file_name: string
  file_url: string
  mime_type: string | null
}

async function main(): Promise<void> {
  const { createServiceClient } = await import('@/lib/supabase-service')
  const { parseDocument } = await import('@/lib/documents/parse')
  const { indexDocumentForRetrieval, estimateEmbeddingCost } = await import('@/lib/documents/embed')
  const { runWithAiActor } = await import('@/lib/ai/usage')
  const { isSupabaseStorageUrl } = await import('@/lib/upload-url')

  const apply = flag('apply')
  const force = flag('force')
  const limit = Math.max(1, Math.min(5000, Number(arg('limit')) || 200))
  const onlyUser = arg('user')

  console.log('— Бэкфилл эмбеддингов документов —')
  console.log('  режим :', apply ? 'APPLY (запись и платные вызовы эмбеддингов)' : 'dry-run (ничего не меняем)')
  if (apply && !process.env.OPENROUTER_API_KEY) throw new Error('Для --apply нужен OPENROUTER_API_KEY')

  const sb = createServiceClient()
  let q = sb
    .from('documents')
    .select('id, user_id, file_name, file_url, mime_type')
    .eq('parse_status', 'parsed')
    .order('uploaded_at', { ascending: true })
    .limit(limit)
  if (onlyUser) q = q.eq('user_id', onlyUser)
  const { data: docs, error } = await q
  if (error) throw new Error(`documents: ${error.message}`)

  const { data: summaries, error: sErr } = await sb.from('document_summaries').select('metadata')
  if (sErr) throw new Error(`document_summaries: ${sErr.message}`)
  const indexed = new Set(
    ((summaries ?? []) as Array<{ metadata: { source_document_id?: string } | null }>)
      .map((s) => s.metadata?.source_document_id)
      .filter((v): v is string => typeof v === 'string'),
  )

  const todo = ((docs ?? []) as DocRow[]).filter((d) => force || !indexed.has(d.id))
  console.log(`  разобранных документов: ${docs?.length ?? 0}, уже в индексе: ${indexed.size}, к обработке: ${todo.length}\n`)

  let totalChars = 0
  let done = 0
  let failed = 0
  for (const d of todo) {
    try {
      if (!isSupabaseStorageUrl(d.file_url)) { console.log(`  ⨯ ${d.file_name}: источник не Supabase Storage — пропуск`); continue }
      const res = await fetch(d.file_url, { signal: AbortSignal.timeout(60_000) })
      if (!res.ok) { console.log(`  ⨯ ${d.file_name}: HTTP ${res.status}`); failed++; continue }
      const parsed = await parseDocument(Buffer.from(await res.arrayBuffer()), d.file_name, d.mime_type ?? undefined)
      const text = parsed.text?.trim() ?? ''
      if (!text) { console.log(`  ⨯ ${d.file_name}: пустой текст`); continue }
      totalChars += text.length
      const est = estimateEmbeddingCost(text.length)
      if (!apply) {
        console.log(`  • ${d.file_name} — ${text.length.toLocaleString('ru-RU')} симв., ≈${est.tokens.toLocaleString('ru-RU')} ток., ≈$${est.costUsd.toFixed(4)}`)
        continue
      }
      const r = await runWithAiActor({ userId: d.user_id, actorId: 'script:backfill-embeddings' }, () =>
        indexDocumentForRetrieval({ documentId: d.id, userId: d.user_id, text }),
      )
      if (r.error) { console.log(`  ⨯ ${d.file_name}: ${r.error}`); failed++ }
      else { console.log(`  ✓ ${d.file_name}: чанков ${r.stored}/${r.chunks}`); done++ }
    } catch (e) {
      failed++
      console.log(`  ⨯ ${d.file_name}: ${e instanceof Error ? e.message : e}`)
    }
  }

  const total = estimateEmbeddingCost(totalChars)
  console.log(`\nИтого текста: ${totalChars.toLocaleString('ru-RU')} симв. ≈ ${total.tokens.toLocaleString('ru-RU')} токенов ≈ $${total.costUsd.toFixed(4)}`)
  if (apply) console.log(`Проиндексировано: ${done}, ошибок: ${failed}`)
  else console.log('dry-run: ничего не изменено. Запустите с --apply, чтобы проиндексировать.')
}

main()
  .then(async () => {
    const { prisma } = await import('@/lib/db')
    await prisma.$disconnect().catch(() => undefined)
  })
  .catch((err) => {
    console.error('Ошибка:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
