import type { Metadata } from 'next'
import { ExpertQueuePanel } from '@/components/expert-sla/ExpertQueuePanel'

export const metadata: Metadata = { title: 'Очередь · Expert Portal' }

/**
 * Очередь эксперта (R2-B): обращения клиентов, отчёты и рекомендации на
 * проверке — с таймером до срока ответа клиенту. Данные и права —
 * GET /api/expert/sla-tasks (только назначенные эксперту и его клиентов).
 */
export default function ExpertQueuePage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-primary/70">Expert Portal</p>
        <h1 className="font-headline text-3xl font-extrabold text-on-surface">Очередь</h1>
        <p className="mt-2 max-w-2xl text-sm text-on-surface-variant">
          Если за 24 часа нет реакции, задачу увидят SuperExpert и администратор; через 48 часов без ответа она считается просроченной.
        </p>
      </div>
      <ExpertQueuePanel />
    </div>
  )
}
