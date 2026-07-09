import type { Metadata } from 'next'
import PsychProfileClient from '@/components/psych/PsychProfileClient'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Профиль основателя' }

export default function PsychProfilePage() {
  return <PsychProfileClient />
}
