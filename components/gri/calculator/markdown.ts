// components/gri/calculator/markdown.ts
// Minimal, XSS-hardened markdown → HTML renderer for AI-generated strategy text.
// Extracted verbatim from GRICalculator so GrowthStrategy can reuse it.

export function renderMarkdown(text: string): string {
  // Escape HTML entities FIRST so any markup in the (AI-generated) strategy text
  // cannot inject active content when rendered via dangerouslySetInnerHTML. The
  // markdown tags added below are the only HTML in the output (XSS hardening).
  const html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h3>$1</h3>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^- (.+)$/gm, '<li class="strategy-action-item">$1</li>')
    .replace(/(<li>.*?<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    .replace(/\n\n([\s\S]+?)(?=\n\n|\n|$)/g, "<p>$1</p>")
    .replace(/^(?!<[hulo])((?!<).+)$/gm, (match) => {
      if (match.startsWith("<")) return match
      return `<p>${match}</p>`
    })
  return html
}
