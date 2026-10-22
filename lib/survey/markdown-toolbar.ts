/**
 * lib/survey/markdown-toolbar.ts — the answer editor's toolbar as pure text
 * transforms: (text, selection) → (text, selection). The textarea applies the
 * result; nothing here touches the DOM, so every button is unit-tested.
 *
 * Markup (lib/survey/markdown.ts): **жирный**, _курсив_, «- » / «1. » lists,
 * [текст](https://…). Bold / italic toggle: pressing again on wrapped text
 * unwraps it. Lists toggle per selected lines.
 */

export interface EditState {
  value: string
  /** Selection start / end (textarea.selectionStart / selectionEnd). */
  start: number
  end: number
}

export type ToolbarAction = 'bold' | 'italic' | 'ul' | 'ol' | 'link'

const PLACEHOLDER: Record<'bold' | 'italic' | 'link', string> = {
  bold: 'жирный текст',
  italic: 'курсив',
  link: 'текст ссылки',
}

function clampState(s: EditState): EditState {
  const len = s.value.length
  const a = Math.max(0, Math.min(s.start, len))
  const b = Math.max(0, Math.min(s.end, len))
  return { value: s.value, start: Math.min(a, b), end: Math.max(a, b) }
}

/**
 * Wrap the selection in `marker` (or insert a selected placeholder when
 * nothing is selected); unwrap when the selection is already wrapped — either
 * the markers sit just outside it or the selection includes them.
 */
export function toggleWrap(state: EditState, marker: string, placeholder: string): EditState {
  const { value, start, end } = clampState(state)
  const m = marker.length
  const selected = value.slice(start, end)

  // Markers just outside the selection: **[sel]**
  if (start >= m && value.slice(start - m, start) === marker && value.slice(end, end + m) === marker) {
    return { value: value.slice(0, start - m) + selected + value.slice(end + m), start: start - m, end: end - m }
  }
  // The selection includes the markers: [**sel**]
  if (selected.length >= 2 * m + 1 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(m, selected.length - m)
    return { value: value.slice(0, start) + inner + value.slice(end), start, end: start + inner.length }
  }

  // Wrap; keep surrounding spaces of the selection outside the markers.
  const text = selected || placeholder
  const lead = selected.match(/^\s*/)?.[0] ?? ''
  const trail = selected.trim() ? selected.match(/\s*$/)?.[0] ?? '' : ''
  const core = selected ? text.slice(lead.length, text.length - trail.length) : text
  const wrapped = `${lead}${marker}${core}${marker}${trail}`
  const coreStart = start + lead.length + m
  return { value: value.slice(0, start) + wrapped + value.slice(end), start: coreStart, end: coreStart + core.length }
}

/** Line range [lineStart, lineEnd) covering the selection. */
function selectedLines(value: string, start: number, end: number): { from: number; to: number } {
  const from = value.lastIndexOf('\n', start - 1) + 1
  // A selection ending right after a newline does not include the next line.
  const endAt = end > start && value[end - 1] === '\n' ? end - 1 : end
  const nl = value.indexOf('\n', endAt)
  return { from, to: nl === -1 ? value.length : nl }
}

const UL_PREFIX = /^(\s*)[-*•]\s+/
const OL_PREFIX = /^(\s*)\d{1,4}[.)]\s+/

/**
 * Toggle a bulleted (`ul`) or numbered (`ol`) list on the selected lines:
 * when every non-empty line already is an item of that kind, the markers are
 * removed; otherwise each line becomes an item (a list of the other kind is
 * converted). Empty lines are left alone. The selection covers the lines.
 */
export function toggleList(state: EditState, kind: 'ul' | 'ol'): EditState {
  const { value, start, end } = clampState(state)
  const { from, to } = selectedLines(value, start, end)
  const lines = value.slice(from, to).split('\n')
  const own = kind === 'ul' ? UL_PREFIX : OL_PREFIX
  const content = lines.filter((l) => l.trim() !== '')
  const allListed = content.length > 0 && content.every((l) => own.test(l))

  let n = 0
  const next = lines.map((line) => {
    if (allListed) return line.replace(own, '$1')
    if (line.trim() === '' && lines.length > 1) return line
    const bare = line.replace(UL_PREFIX, '$1').replace(OL_PREFIX, '$1')
    const indent = bare.match(/^\s*/)?.[0] ?? ''
    n += 1
    return `${indent}${kind === 'ul' ? '- ' : `${n}. `}${bare.slice(indent.length)}`
  })
  const block = next.join('\n')
  const value2 = value.slice(0, from) + block + value.slice(to)
  // An empty line turned into a fresh item: the caret goes after the marker.
  if (start === end && lines.length === 1 && lines[0].trim() === '' && !allListed) {
    return { value: value2, start: from + block.length, end: from + block.length }
  }
  return { value: value2, start: from, end: from + block.length }
}

/**
 * Insert a link: the selection (or a placeholder) becomes the link text, the
 * URL is normalized (www. → https://www.). Returns null for an unusable URL.
 */
export function insertLink(state: EditState, rawUrl: string): EditState | null {
  const url = normalizeUrl(rawUrl)
  if (!url) return null
  const { value, start, end } = clampState(state)
  const selected = value.slice(start, end).trim()
  const label = (selected || PLACEHOLDER.link).replace(/[[\]\n]/g, ' ')
  const md = `[${label}](${url})`
  return { value: value.slice(0, start) + md + value.slice(end), start: start + 1, end: start + 1 + label.length }
}

/** https://… / mailto: / tel: as is; «www.x.kz» / «x.kz/path» → https://; else null. */
export function normalizeUrl(raw: string): string | null {
  const url = (raw ?? '').trim()
  if (!url || /[\s<>"'()]/.test(url)) return null
  if (/^(https?:\/\/|mailto:|tel:)/i.test(url)) return url
  if (/^[^:/]+\.[a-zа-яё]{2,}(\/.*)?$/i.test(url)) return `https://${url}`
  return null
}

/** Apply one toolbar button (link needs the URL; null = nothing changed). */
export function applyToolbarAction(state: EditState, action: ToolbarAction, url?: string): EditState | null {
  switch (action) {
    case 'bold': return toggleWrap(state, '**', PLACEHOLDER.bold)
    case 'italic': return toggleWrap(state, '_', PLACEHOLDER.italic)
    case 'ul': return toggleList(state, 'ul')
    case 'ol': return toggleList(state, 'ol')
    case 'link': return url === undefined ? null : insertLink(state, url)
  }
}

/**
 * Enter inside a list item continues the list («- » / next number); Enter on
 * an empty item ends the list. Null → let the textarea insert a newline.
 */
export function continueListOnEnter(state: EditState): EditState | null {
  const { value, start, end } = clampState(state)
  if (start !== end) return null
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const line = value.slice(lineStart, start)
  const ul = /^(\s*)([-*•])\s+(.*)$/.exec(line)
  const ol = ul ? null : /^(\s*)(\d{1,4})([.)])\s+(.*)$/.exec(line)
  if (!ul && !ol) return null
  const rest = ul ? ul[3] : ol![4]
  if (rest.trim() === '') {
    // Empty item: drop the marker, end the list.
    return { value: value.slice(0, lineStart) + value.slice(start), start: lineStart, end: lineStart }
  }
  const marker = ul ? `${ul[1]}${ul[2]} ` : `${ol![1]}${Number(ol![2]) + 1}${ol![3]} `
  const insert = `\n${marker}`
  return { value: value.slice(0, start) + insert + value.slice(end), start: start + insert.length, end: start + insert.length }
}
