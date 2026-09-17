/**
 * lib/cms/blocks.ts — content blocks: schema, URL safety and page validation.
 * Text is rendered as text (never as HTML); links and media must be https or
 * site-relative. Videos from YouTube/Vimeo become embed URLs.
 */
import { z } from 'zod'
import { visibilitySchema } from '@/lib/platform/visibility'

export const BLOCK_TYPES = {
  heading: 'Заголовок',
  text: 'Текст',
  image: 'Изображение',
  video: 'Видео',
  document: 'Документ',
  callout: 'Выделенный блок',
  cta: 'Кнопка',
  divider: 'Разделитель',
} as const
export type BlockType = keyof typeof BLOCK_TYPES

export function safeUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  if (!v || v.length > 1000) return null
  if (v.startsWith('/') && !v.startsWith('//')) return v
  try {
    const u = new URL(v)
    return u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

/** YouTube / Vimeo page URL → embeddable URL; direct https video files pass through. */
export function videoEmbed(raw: unknown): { kind: 'iframe' | 'file'; src: string } | null {
  const url = safeUrl(raw)
  if (!url || url.startsWith('/')) return url ? { kind: 'file', src: url } : null
  const u = new URL(url)
  const host = u.hostname.replace(/^www\./, '')
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const id = u.searchParams.get('v') ?? (u.pathname.startsWith('/embed/') ? u.pathname.split('/')[2] : null)
    return id && /^[\w-]{6,20}$/.test(id) ? { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${id}` } : null
  }
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1)
    return /^[\w-]{6,20}$/.test(id) ? { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${id}` } : null
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = u.pathname.split('/').filter(Boolean).pop()
    return id && /^\d{5,12}$/.test(id) ? { kind: 'iframe', src: `https://player.vimeo.com/video/${id}` } : null
  }
  // Direct files only from our storage: the CSP (media-src) allows nothing else.
  const ours = host.endsWith('.supabase.co')
  return ours && /\.(mp4|webm)(\?|$)/i.test(u.pathname) ? { kind: 'file', src: url } : null
}

const text = (max: number) => z.string().max(max)
const url = z.string().max(1000).refine((v) => safeUrl(v) !== null, 'Ссылка должна начинаться с https:// или /')

export const blockContentSchemas = {
  heading: z.object({ text: text(200).min(1, 'Пустой заголовок'), level: z.union([z.literal(2), z.literal(3)]).default(2) }),
  text: z.object({ text: text(20_000) }),
  image: z.object({ url, alt: text(200).default(''), caption: text(300).default('') }),
  video: z.object({ url: z.string().max(1000).refine((v) => videoEmbed(v) !== null, 'Нужна ссылка YouTube, Vimeo или файл .mp4/.webm из медиатеки'), caption: text(300).default('') }),
  document: z.object({ url, name: text(200).min(1, 'Укажите название файла') }),
  callout: z.object({ tone: z.enum(['info', 'success', 'warning']).default('info'), title: text(200).default(''), text: text(2000) }),
  cta: z.object({ label: text(80).min(1, 'Текст кнопки'), href: url }),
  divider: z.object({}).passthrough(),
} as const

export const blockSchema = z.object({
  id: z.string().uuid().optional(),
  type: z.enum(Object.keys(BLOCK_TYPES) as [BlockType, ...BlockType[]]),
  content: z.record(z.string(), z.unknown()),
  hidden: z.boolean().default(false),
  visibility: visibilitySchema.nullish(),
}).superRefine((b, ctx) => {
  const r = blockContentSchemas[b.type].safeParse(b.content)
  if (!r.success) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${BLOCK_TYPES[b.type]}: ${r.error.issues[0]?.message ?? 'ошибка'}`, path: ['content'] })
})
export type CmsBlockInput = z.infer<typeof blockSchema>

export const pageFieldsSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Адрес: латиница, цифры и дефисы').max(80),
  title: z.string().trim().min(1, 'Введите заголовок').max(200),
  summary: z.string().trim().max(500).nullish(),
  category: z.string().trim().max(60).nullish(),
  icon: z.string().regex(/^[a-z0-9_]{1,40}$/).nullish(),
  cover_url: z.string().max(1000).refine((v) => safeUrl(v) !== null, 'Обложка: https:// или /').nullish().or(z.literal('')),
  visibility: visibilitySchema,
  show_in_nav: z.boolean(),
  sort_order: z.number().int().min(0).max(10_000),
})

export const pageSaveSchema = z.object({
  page: pageFieldsSchema,
  blocks: z.array(blockSchema).max(200),
  expectedVersion: z.number().int().min(1),
})

/** Minimal, safe inline formatting for text blocks: **bold** and [label](url). */
export type InlinePart = { t: 'text'; v: string } | { t: 'bold'; v: string } | { t: 'link'; v: string; href: string }

export function parseInline(line: string): InlinePart[] {
  const out: InlinePart[] = []
  const re = /\*\*([^*]+)\*\*|\[([^\]]{1,200})\]\(([^)\s]{1,1000})\)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    if (m.index > last) out.push({ t: 'text', v: line.slice(last, m.index) })
    if (m[1] !== undefined) out.push({ t: 'bold', v: m[1] })
    else {
      const href = safeUrl(m[3])
      out.push(href ? { t: 'link', v: m[2], href } : { t: 'text', v: m[0] })
    }
    last = m.index + m[0].length
  }
  if (last < line.length) out.push({ t: 'text', v: line.slice(last) })
  return out
}

export function slugify(title: string): string {
  const map: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', қ: 'k', ғ: 'g', ү: 'u', ұ: 'u', ң: 'n', ө: 'o', һ: 'h', ә: 'a', і: 'i' }
  return title
    .toLowerCase()
    .split('')
    .map((c) => map[c] ?? c)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'page'
}
