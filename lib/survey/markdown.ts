/**
 * lib/survey/markdown.ts — the small Markdown subset of questionnaire answers
 * (answer editor, PO item 4.1). Answers stay plain strings in
 * survey_answers.answer.value; the editor only adds
 *   **жирный**, _курсив_ (or *курсив*), [текст](https://…),
 *   «- пункт» bulleted and «1. пункт» numbered lists.
 *
 * Pure and browser-safe. `parseMarkdown` gives a tiny AST that the preview
 * renders as React elements (never innerHTML); links are kept only for
 * http(s) / mailto / tel. `stripMarkdown` gives the plain text for readers
 * that want no markup.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'link'; href: string; children: Inline[] }

export type Block =
  | { type: 'p'; lines: Inline[][] }
  | { type: 'ul'; items: Inline[][] }
  | { type: 'ol'; items: Inline[][]; start: number }

const UL_RE = /^\s*[-*•]\s+(.*)$/
const OL_RE = /^\s*(\d{1,4})[.)]\s+(.*)$/

/** A link target the preview may open, or null. */
export function safeHref(raw: string): string | null {
  const url = raw.trim()
  if (/^(https?:\/\/|mailto:|tel:)/i.test(url) && !/[\s<>"']/.test(url)) return url
  if (/^www\.[^\s<>"']+$/i.test(url)) return `https://${url}`
  return null
}

// One inline token at a time: link, bold, italic (* or _), else text. No
// lookbehind (older iOS Safari cannot parse it): an italic marker must follow
// the start or a non-word character, captured as a prefix and kept as text.
const INLINE_RE = /\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|(^|[^\p{L}\p{N}*])\*([^*\s](?:[^*\n]*?[^*\s])?)\*(?![\p{L}\p{N}*])|(^|[^\p{L}\p{N}_])_([^_\s](?:[^_\n]*?[^_\s])?)_(?![\p{L}\p{N}_])/gu

export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  const push = (t: string) => {
    if (!t) return
    const prev = out[out.length - 1]
    if (prev?.type === 'text') prev.text += t
    else out.push({ type: 'text', text: t })
  }
  for (const m of text.matchAll(INLINE_RE)) {
    const at = m.index ?? 0
    push(text.slice(last, at))
    if (m[1] !== undefined) {
      const href = safeHref(m[2])
      if (href) out.push({ type: 'link', href, children: parseInline(m[1]) })
      else push(m[0])
    } else if (m[3] !== undefined || m[4] !== undefined) {
      out.push({ type: 'strong', children: parseInline(m[3] ?? m[4]) })
    } else {
      push(m[5] ?? m[7] ?? '')
      out.push({ type: 'em', children: parseInline(m[6] ?? m[8]) })
    }
    last = at + m[0].length
  }
  push(text.slice(last))
  return out
}

export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = []
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  let para: Inline[][] = []
  const flush = () => {
    if (para.length) blocks.push({ type: 'p', lines: para })
    para = []
  }
  for (const line of lines) {
    const ul = UL_RE.exec(line)
    const ol = ul ? null : OL_RE.exec(line)
    if (ul) {
      flush()
      const prev = blocks[blocks.length - 1]
      if (prev?.type === 'ul') prev.items.push(parseInline(ul[1]))
      else blocks.push({ type: 'ul', items: [parseInline(ul[1])] })
    } else if (ol) {
      flush()
      const prev = blocks[blocks.length - 1]
      if (prev?.type === 'ol') prev.items.push(parseInline(ol[2]))
      else blocks.push({ type: 'ol', items: [parseInline(ol[2])], start: Number(ol[1]) || 1 })
    } else if (line.trim() === '') {
      flush()
    } else {
      para.push(parseInline(line))
    }
  }
  flush()
  return blocks
}

function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.type === 'text' ? n.text : inlineText(n.children))).join('')
}

/**
 * Plain text without the markup: «**Цель**: _рост_» → «Цель: рост»; list
 * markers become «• » / «1. », links keep their text.
 */
export function stripMarkdown(text: string): string {
  if (typeof text !== 'string' || !/[*_[\]\-•]|\d[.)]\s/.test(text)) return typeof text === 'string' ? text : ''
  return parseMarkdown(text)
    .map((b) => {
      if (b.type === 'p') return b.lines.map(inlineText).join('\n')
      if (b.type === 'ul') return b.items.map((i) => `• ${inlineText(i)}`).join('\n')
      return b.items.map((i, n) => `${b.start + n}. ${inlineText(i)}`).join('\n')
    })
    .join('\n\n')
}

/** Does the text use any of the editor's markup? (the preview toggle hint) */
export function hasMarkdown(text: string): boolean {
  if (!text) return false
  return parseMarkdown(text).some((b) => b.type !== 'p' || b.lines.some((l) => l.some((n) => n.type !== 'text')))
}
