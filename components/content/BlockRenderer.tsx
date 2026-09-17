import { parseInline, safeUrl, videoEmbed } from '@/lib/cms/blocks'

export interface RenderBlock { id?: string; type: string; content: Record<string, unknown> }

const str = (v: unknown) => (typeof v === 'string' ? v : '')

function Inline({ line }: { line: string }) {
  return (
    <>
      {parseInline(line).map((p, i) =>
        p.t === 'bold' ? <strong key={i} className="font-semibold text-on-surface">{p.v}</strong>
          : p.t === 'link' ? <a key={i} href={p.href} className="text-primary underline underline-offset-2" {...(p.href.startsWith('/') ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>{p.v}</a>
          : <span key={i}>{p.v}</span>,
      )}
    </>
  )
}

/** Plain text with paragraphs, «- » lists and «## » subheadings. Never HTML. */
function RichText({ text }: { text: string }) {
  const chunks = text.replace(/\r/g, '').split(/\n{2,}/)
  return (
    <div className="space-y-3">
      {chunks.map((chunk, i) => {
        const lines = chunk.split('\n')
        if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
          return <ul key={i} className="list-disc space-y-1 pl-5">{lines.map((l, j) => <li key={j}><Inline line={l.replace(/^\s*[-•]\s+/, '')} /></li>)}</ul>
        }
        if (lines.length === 1 && lines[0].startsWith('## ')) {
          return <h3 key={i} className="pt-2 text-lg font-semibold text-on-surface"><Inline line={lines[0].slice(3)} /></h3>
        }
        return <p key={i} className="leading-relaxed">{lines.map((l, j) => <span key={j}>{j > 0 && <br />}<Inline line={l} /></span>)}</p>
      })}
    </div>
  )
}

const CALLOUT = {
  info: 'border-sky-400/30 bg-sky-400/[0.07]',
  success: 'border-primary/30 bg-primary/[0.07]',
  warning: 'border-amber-400/30 bg-amber-400/[0.08]',
}

export function BlockRenderer({ blocks }: { blocks: RenderBlock[] }) {
  return (
    <div className="space-y-6 text-[15px] text-on-surface-variant">
      {blocks.map((b, i) => {
        const c = b.content ?? {}
        const key = b.id ?? String(i)
        switch (b.type) {
          case 'heading': {
            const level = c.level === 3 ? 3 : 2
            return level === 2
              ? <h2 key={key} className="pt-2 text-2xl font-bold text-on-surface">{str(c.text)}</h2>
              : <h3 key={key} className="pt-1 text-lg font-semibold text-on-surface">{str(c.text)}</h3>
          }
          case 'text':
            return <RichText key={key} text={str(c.text)} />
          case 'image': {
            const src = safeUrl(c.url)
            if (!src) return null
            return (
              <figure key={key}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={str(c.alt)} loading="lazy" className="w-full rounded-2xl border border-white/[0.06] object-cover" />
                {str(c.caption) && <figcaption className="mt-2 text-center text-xs text-on-surface-variant/70">{str(c.caption)}</figcaption>}
              </figure>
            )
          }
          case 'video': {
            const v = videoEmbed(c.url)
            if (!v) return null
            return (
              <figure key={key}>
                <div className="aspect-video w-full max-w-full overflow-hidden rounded-2xl border border-white/[0.06] bg-black">
                  {v.kind === 'iframe'
                    ? <iframe src={v.src} title={str(c.caption) || 'Видео'} className="h-full w-full" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" loading="lazy" referrerPolicy="strict-origin-when-cross-origin" />
                    : <video src={v.src} controls preload="metadata" className="h-full w-full" />}
                </div>
                {str(c.caption) && <figcaption className="mt-2 text-center text-xs text-on-surface-variant/70">{str(c.caption)}</figcaption>}
              </figure>
            )
          }
          case 'document': {
            const href = safeUrl(c.url)
            if (!href) return null
            return (
              <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 transition-colors hover:bg-white/[0.06]">
                <span className="material-symbols-outlined text-2xl text-primary" aria-hidden>description</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-on-surface">{str(c.name)}</span>
                <span className="material-symbols-outlined text-lg text-on-surface-variant" aria-hidden>download</span>
              </a>
            )
          }
          case 'callout': {
            const tone = (['info', 'success', 'warning'].includes(str(c.tone)) ? str(c.tone) : 'info') as keyof typeof CALLOUT
            return (
              <div key={key} className={`rounded-2xl border px-4 py-3 ${CALLOUT[tone]}`}>
                {str(c.title) && <p className="mb-1 text-sm font-semibold text-on-surface">{str(c.title)}</p>}
                <RichText text={str(c.text)} />
              </div>
            )
          }
          case 'cta': {
            const href = safeUrl(c.href)
            if (!href) return null
            return (
              <div key={key}>
                <a
                  href={href}
                  data-track={`cms-cta:${str(c.label).slice(0, 40)}`}
                  {...(href.startsWith('/') ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-[#00e29e] px-5 py-3 text-sm font-bold text-[#003824]"
                >
                  {str(c.label)}
                  <span className="material-symbols-outlined text-base" aria-hidden>arrow_forward</span>
                </a>
              </div>
            )
          }
          case 'divider':
            return <hr key={key} className="border-white/[0.08]" />
          default:
            return null
        }
      })}
    </div>
  )
}
