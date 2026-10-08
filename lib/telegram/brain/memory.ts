/**
 * Short memory of the bot assistant (migration 109, bot_ai_messages).
 *
 *   • the last MEMORY_MESSAGES messages (~10 turns: question + answer) of a
 *     chat younger than 24 hours are replayed to the model;
 *   • tool results (client data) are never stored — the model re-reads them;
 *   • the last files a person sent are remembered as Telegram file_id + name
 *     (not the bytes) for «прикрепить к клиенту»;
 *   • `/new` clears the chat; every write prunes the chat (age + window).
 * A failing read gives an empty memory: the assistant still answers.
 */
import { prisma } from '@/lib/db'

export type MemoryBot = 'admin' | 'expert'

export const MEMORY_MESSAGES = 20
export const MEMORY_TTL_HOURS = 24
const MAX_CONTENT = 4000

export interface MemoryMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface RememberedFile {
  id: string
  fileId: string
  fileName: string
  mime: string | null
  size: number | null
  kind: 'photo' | 'document'
  at: Date
}

export interface BrainMemory {
  load(bot: MemoryBot, chatId: string): Promise<MemoryMessage[]>
  append(bot: MemoryBot, chatId: string, userId: string | null, messages: MemoryMessage[]): Promise<void>
  reset(bot: MemoryBot, chatId: string): Promise<void>
  rememberFile(bot: MemoryBot, chatId: string, userId: string | null, file: Omit<RememberedFile, 'id' | 'at'>): Promise<string | null>
  lastFile(bot: MemoryBot, chatId: string): Promise<RememberedFile | null>
  fileById(bot: MemoryBot, chatId: string, id: string): Promise<RememberedFile | null>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uid = (v: string | null) => (v && UUID_RE.test(v) ? v : null)
const clip = (s: string) => s.slice(0, MAX_CONTENT)

type FileRow = { id: bigint | number | string; meta: Record<string, unknown>; created_at: Date }

function fileOf(r: FileRow | undefined): RememberedFile | null {
  if (!r) return null
  const m = r.meta ?? {}
  if (typeof m.fileId !== 'string' || typeof m.fileName !== 'string') return null
  return {
    id: String(r.id),
    fileId: m.fileId,
    fileName: m.fileName,
    mime: typeof m.mime === 'string' ? m.mime : null,
    size: typeof m.size === 'number' ? m.size : null,
    kind: m.kind === 'photo' ? 'photo' : 'document',
    at: r.created_at,
  }
}

export const dbBrainMemory: BrainMemory = {
  async load(bot, chatId) {
    try {
      const rows = await prisma.$queryRaw<Array<{ role: 'user' | 'assistant'; content: string }>>`
        SELECT role, content FROM (
          SELECT id, role, content FROM public.bot_ai_messages
          WHERE bot = ${bot} AND chat_id = ${chatId} AND role IN ('user', 'assistant')
            AND created_at > now() - make_interval(hours => ${MEMORY_TTL_HOURS}::int)
          ORDER BY id DESC LIMIT ${MEMORY_MESSAGES}
        ) t ORDER BY id`
      return rows.map((r) => ({ role: r.role, content: r.content }))
    } catch {
      return []
    }
  },
  async append(bot, chatId, userId, messages) {
    try {
      for (const m of messages) {
        await prisma.$executeRaw`
          INSERT INTO public.bot_ai_messages (bot, chat_id, user_id, role, content)
          VALUES (${bot}, ${chatId}, ${uid(userId)}::uuid, ${m.role}, ${clip(m.content)})`
      }
      await prisma.$executeRaw`
        DELETE FROM public.bot_ai_messages
        WHERE bot = ${bot} AND chat_id = ${chatId}
          AND (created_at < now() - make_interval(hours => ${MEMORY_TTL_HOURS}::int)
               OR (role IN ('user', 'assistant') AND id NOT IN (
                     SELECT id FROM public.bot_ai_messages
                     WHERE bot = ${bot} AND chat_id = ${chatId} AND role IN ('user', 'assistant')
                     ORDER BY id DESC LIMIT ${MEMORY_MESSAGES}))
               OR (role = 'file' AND id NOT IN (
                     SELECT id FROM public.bot_ai_messages
                     WHERE bot = ${bot} AND chat_id = ${chatId} AND role = 'file'
                     ORDER BY id DESC LIMIT 5)))`
    } catch (err) {
      console.warn('[telegram/brain] memory write skipped:', err instanceof Error ? err.message.split('\n')[0] : err)
    }
  },
  async reset(bot, chatId) {
    await prisma.$executeRaw`DELETE FROM public.bot_ai_messages WHERE bot = ${bot} AND chat_id = ${chatId}`
  },
  async rememberFile(bot, chatId, userId, file) {
    try {
      const rows = await prisma.$queryRaw<Array<{ id: bigint }>>`
        INSERT INTO public.bot_ai_messages (bot, chat_id, user_id, role, content, meta)
        VALUES (${bot}, ${chatId}, ${uid(userId)}::uuid, 'file', ${clip(file.fileName)}, ${JSON.stringify(file)}::jsonb)
        RETURNING id`
      return rows[0] ? String(rows[0].id) : null
    } catch {
      return null
    }
  },
  async lastFile(bot, chatId) {
    try {
      const rows = await prisma.$queryRaw<FileRow[]>`
        SELECT id, meta, created_at FROM public.bot_ai_messages
        WHERE bot = ${bot} AND chat_id = ${chatId} AND role = 'file'
          AND created_at > now() - make_interval(hours => ${MEMORY_TTL_HOURS}::int)
        ORDER BY id DESC LIMIT 1`
      return fileOf(rows[0])
    } catch {
      return null
    }
  },
  async fileById(bot, chatId, id) {
    if (!/^\d{1,18}$/.test(id)) return null
    try {
      const rows = await prisma.$queryRaw<FileRow[]>`
        SELECT id, meta, created_at FROM public.bot_ai_messages
        WHERE bot = ${bot} AND chat_id = ${chatId} AND role = 'file' AND id = ${BigInt(id)}
          AND created_at > now() - make_interval(hours => ${MEMORY_TTL_HOURS}::int)`
      return fileOf(rows[0])
    } catch {
      return null
    }
  },
}

/** In-memory memory for tests (same window rules). */
export function memoryBrainMemory(now: () => Date = () => new Date()): BrainMemory & { rows: () => number } {
  type Row = { id: number; bot: MemoryBot; chatId: string; role: 'user' | 'assistant' | 'file'; content: string; file?: Omit<RememberedFile, 'id' | 'at'>; at: Date }
  let rows: Row[] = []
  let seq = 0
  const fresh = (r: Row) => now().getTime() - r.at.getTime() < MEMORY_TTL_HOURS * 3_600_000
  const asFile = (r: Row | undefined): RememberedFile | null => (r?.file ? { ...r.file, id: String(r.id), at: r.at } : null)
  return {
    async load(bot, chatId) {
      return rows
        .filter((r) => r.bot === bot && r.chatId === chatId && r.role !== 'file' && fresh(r))
        .slice(-MEMORY_MESSAGES)
        .map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content }))
    },
    async append(bot, chatId, _userId, messages) {
      for (const m of messages) rows.push({ id: ++seq, bot, chatId, role: m.role, content: clip(m.content), at: now() })
      const mine = rows.filter((r) => r.bot === bot && r.chatId === chatId && r.role !== 'file')
      const keep = new Set(mine.slice(-MEMORY_MESSAGES).map((r) => r.id))
      rows = rows.filter((r) => !(r.bot === bot && r.chatId === chatId && r.role !== 'file' && !keep.has(r.id)) && fresh(r))
    },
    async reset(bot, chatId) {
      rows = rows.filter((r) => !(r.bot === bot && r.chatId === chatId))
    },
    async rememberFile(bot, chatId, _userId, file) {
      const row: Row = { id: ++seq, bot, chatId, role: 'file', content: file.fileName, file, at: now() }
      rows.push(row)
      return String(row.id)
    },
    async lastFile(bot, chatId) {
      return asFile(rows.filter((r) => r.bot === bot && r.chatId === chatId && r.role === 'file' && fresh(r)).pop())
    },
    async fileById(bot, chatId, id) {
      return asFile(rows.find((r) => r.bot === bot && r.chatId === chatId && r.role === 'file' && String(r.id) === id && fresh(r)))
    },
    rows: () => rows.length,
  }
}
