import { Fragment, type ReactNode } from 'react'
import { parseMarkdown, type Inline } from '@/lib/survey/markdown'

/**
 * The answer's Markdown (lib/survey/markdown.ts) as React elements — never
 * innerHTML; links open in a new tab and only for http(s) / mailto / tel.
 * Server-renderable (no hooks), so it is tested with renderToStaticMarkup.
 */
function renderInline(nodes: Inline[], keyPrefix: string): ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyPrefix}-${i}`
    switch (n.type) {
      case 'text': return <Fragment key={key}>{n.text}</Fragment>
      case 'strong': return <strong key={key} className="font-semibold text-on-surface">{renderInline(n.children, key)}</strong>
      case 'em': return <em key={key}>{renderInline(n.children, key)}</em>
      case 'link':
        return (
          <a key={key} href={n.href} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline underline-offset-2 break-all">
            {renderInline(n.children, key)}
          </a>
        )
    }
  })
}

export default function MarkdownPreview({ text, emptyText = 'Пока пусто' }: { text: string; emptyText?: string }) {
  const blocks = parseMarkdown(text)
  if (!blocks.length) return <p className="text-sm text-on-surface-variant/60">{emptyText}</p>
  return (
    <div className="space-y-3 text-base leading-relaxed text-on-surface sm:text-[15px]">
      {blocks.map((b, i) => {
        const key = `b${i}`
        if (b.type === 'ul') {
          return (
            <ul key={key} className="list-disc space-y-1 pl-5 marker:text-primary/70">
              {b.items.map((item, j) => <li key={j}>{renderInline(item, `${key}-${j}`)}</li>)}
            </ul>
          )
        }
        if (b.type === 'ol') {
          return (
            <ol key={key} start={b.start} className="list-decimal space-y-1 pl-5 marker:text-primary/70">
              {b.items.map((item, j) => <li key={j}>{renderInline(item, `${key}-${j}`)}</li>)}
            </ol>
          )
        }
        return (
          <p key={key} className="whitespace-pre-wrap break-words">
            {b.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {renderInline(line, `${key}-${j}`)}
              </Fragment>
            ))}
          </p>
        )
      })}
    </div>
  )
}
