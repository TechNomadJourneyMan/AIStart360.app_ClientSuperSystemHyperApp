import { getSetting } from '@/lib/settings/store'
import AnnouncementBarView from './AnnouncementBarView'

/** Platform-wide announcement configured in GIGA-CRM → Настройки. */
export default async function AnnouncementBar({ className }: { className?: string }) {
  let a: Awaited<ReturnType<typeof getSetting<'announcement'>>>
  try {
    a = await getSetting('announcement')
  } catch {
    return null
  }
  if (!a.enabled || !a.text) return null
  return (
    <AnnouncementBarView
      className={className}
      text={a.text}
      tone={a.tone}
      linkLabel={a.link_label || null}
      linkHref={a.link_href || null}
    />
  )
}
