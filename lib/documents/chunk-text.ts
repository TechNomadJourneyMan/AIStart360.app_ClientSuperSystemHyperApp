/**
 * Split a StructuredText into model-sized chunks for map-reduce extraction.
 *
 * Whole segments (pages / sheets / slides) are packed greedily; a segment
 * longer than a chunk is cut at line boundaries (a "label: value" row is never
 * split), and a single over-long line at the hard limit. Chunks carry their
 * offsets into the full text so extracted quotes can be located.
 */
import type { StructuredText } from './text'

export interface TextChunk {
  index: number
  text: string
  start: number
  end: number
  /** Labels of the segments the chunk touches («Страница 3», «Лист: P&L»). */
  labels: string[]
}

export function chunkStructuredText(st: StructuredText, maxChars = 12_000): TextChunk[] {
  const text = st.text
  if (!text) return []
  const limit = Math.max(500, maxChars)
  const ranges: Array<[number, number]> = []

  // Candidate cut points: segment starts first, then line starts.
  const segmentStarts = new Set(st.segments.map((s) => s.start))
  let start = 0
  while (start < text.length) {
    const hardEnd = Math.min(text.length, start + limit)
    if (hardEnd === text.length) {
      ranges.push([start, hardEnd])
      break
    }
    let cut = -1
    // Prefer the last segment boundary inside the window (beyond 1/3 of it).
    for (const s of segmentStarts) {
      if (s > start + limit / 3 && s <= hardEnd && s > cut) cut = s
    }
    if (cut < 0) {
      const nl = text.lastIndexOf('\n', hardEnd)
      cut = nl > start + limit / 3 ? nl + 1 : hardEnd
    }
    ranges.push([start, cut])
    start = cut
  }

  return ranges.map(([s, e], index) => ({
    index,
    text: text.slice(s, e),
    start: s,
    end: e,
    labels: st.segments.filter((seg) => seg.start < e && seg.end > s).map((seg) => seg.label),
  }))
}
