const SHEET_MARKER = /(?=^\[Sheet:[^\n]+\]$)/gmu

function takeHeadAndTail(text: string, limit: number): string {
  if (text.length <= limit) return text
  const marker = '\n…[фрагмент сокращён]…\n'
  const contentBudget = Math.max(2, limit - marker.length)
  const head = Math.max(1, Math.floor(contentBudget * 0.72))
  const tail = Math.max(1, contentBudget - head)
  return `${text.slice(0, head)}${marker}${text.slice(-tail)}`.slice(0, limit)
}

/**
 * Bound very large parsed files without sampling only their first worksheet.
 * XLS/XLSX sheet sections receive an equal budget; plain documents preserve
 * their beginning and end. The original text remains available to deterministic
 * row extraction, while LLM/RAG work stays bounded.
 */
export function boundDocumentText(text: string, maxChars: number): string {
  const clean = text.trim()
  if (!Number.isFinite(maxChars) || maxChars <= 0 || clean.length <= maxChars) {
    return clean
  }

  const sections = clean
    .split(SHEET_MARKER)
    .map((section) => section.trim())
    .filter(Boolean)
  if (sections.length <= 1 || !sections.every((section) => section.startsWith('[Sheet:'))) {
    return takeHeadAndTail(clean, maxChars)
  }

  const separatorBudget = Math.max(0, (sections.length - 1) * 2)
  const perSection = Math.max(
    200,
    Math.floor((maxChars - separatorBudget) / sections.length),
  )
  return sections
    .map((section) => takeHeadAndTail(section, perSection))
    .join('\n\n')
    .slice(0, maxChars)
}
