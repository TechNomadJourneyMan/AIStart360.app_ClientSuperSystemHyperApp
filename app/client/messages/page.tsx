export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getRequestUser } from '@/lib/request-user'
import ClientMessages from '@/components/client/messages/ClientMessages'

export const metadata = { title: 'Сообщения — AIStart360' }

/** «Сообщения» of the cabinet: the user's conversation with AIStart360 experts. */
export default async function ClientMessagesPage() {
  const user = await getRequestUser()
  if (!user) redirect('/login?from=/client/messages')
  return <ClientMessages />
}
