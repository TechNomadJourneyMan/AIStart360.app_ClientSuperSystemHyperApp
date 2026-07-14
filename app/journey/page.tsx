import type { Metadata } from 'next'
import { JourneyWorkspace } from '@/components/journey/Workspace'

export const metadata: Metadata = {
  title: 'AI-first Workspace · эксперимент',
  description: 'Изолированная тестовая рабочая область AIStart360: диалог, Точка A, путь и Точка B.',
  robots: { index: false, follow: false },
}

export default function JourneyPage() {
  return <JourneyWorkspace />
}
