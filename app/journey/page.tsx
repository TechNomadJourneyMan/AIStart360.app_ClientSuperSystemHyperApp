import type { Metadata } from 'next'
import { JourneyWorkspace } from '@/components/journey/Workspace'
import { parseJourneyDemoScenario } from '@/components/journey/demo-scenarios'

export const metadata: Metadata = {
  title: 'AI-first Workspace · эксперимент',
  description: 'Изолированная тестовая рабочая область AIStart360: диалог, Точка A, путь и Точка B.',
  robots: { index: false, follow: false },
}

interface JourneyPageProps {
  searchParams?: { demo?: string | string[] }
}

export default function JourneyPage({ searchParams }: JourneyPageProps) {
  return <JourneyWorkspace initialDemoScenario={parseJourneyDemoScenario(searchParams?.demo)} />
}
