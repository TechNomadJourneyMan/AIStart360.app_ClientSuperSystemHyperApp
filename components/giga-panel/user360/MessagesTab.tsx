'use client'

/** User 360 → «Сообщения»: the same conversation as in GIGA «Сообщения». */
import Link from 'next/link'
import { Conversation } from '@/components/giga-panel/comm/Conversation'
import { useWorkspace } from '@/components/giga-panel/WorkspaceContext'
import { GIGA_BASE } from '@/lib/admin/nav'

export function MessagesTab({ userId }: { userId: string }) {
  const { base } = useWorkspace()
  return (
    <div className="space-y-2">
      <Conversation userId={userId} />
      {base === GIGA_BASE && (
        <p className="text-right text-[11px] text-slate-500">
          <Link href={`${GIGA_BASE}/messages?user=${userId}`} className="hover:text-slate-300">Открыть в разделе «Сообщения» →</Link>
        </p>
      )}
    </div>
  )
}
