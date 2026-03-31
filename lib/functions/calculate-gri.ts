import { inngest } from '@/lib/inngest'
import { prisma } from '@/lib/db'

export const calculateGri = inngest.createFunction(
  {
    id: 'calculate-gri',
    // @ts-ignore
    event: 'gri/calculate',
  },
  // @ts-ignore
  async ({ event, step }: any) => {
    const { clientId } = event.data

    // Step 1: Получить данные клиента
    const client = await step.run('fetch-client', async () => {
      return prisma.client.findUnique({
        where: { id: clientId },
        include: { reports: { orderBy: { uploadedAt: 'desc' }, take: 5 } },
      })
    })

    if (!client) throw new Error(`Client ${clientId} not found`)

    // Step 2: Вычислить домены (здесь ваша бизнес-логика)
    const domains = await step.run('compute-domains', async () => {
      // TODO: реальный алгоритм расчёта по данным клиента
      return {
        strategy:   Math.round(600 + Math.random() * 400),
        finance:    Math.round(600 + Math.random() * 400),
        operations: Math.round(600 + Math.random() * 400),
        team:       Math.round(600 + Math.random() * 400),
        market:     Math.round(600 + Math.random() * 400),
        technology: Math.round(600 + Math.random() * 400),
      }
    })

    // Step 3: Weighted average → итоговый score
    const weights: Record<string, number> = { strategy: 0.2, finance: 0.2, operations: 0.15, team: 0.15, market: 0.15, technology: 0.15 }
    const score = Math.round(
      Object.entries(domains as Record<string, number>).reduce((sum, [key, val]) => {
        return sum + val * (weights[key] ?? 0)
      }, 0)
    )

    // Step 4: Сохранить результат
    const report = await step.run('save-report', async () => {
      return prisma.griReport.create({
        data: { clientId, score, domains: domains as any }
      })
    })

    // Step 5: Уведомить менеджера
    await step.run('notify', async () => {
      const manager = await prisma.user.findFirst({
        where: { managedClients: { some: { id: clientId } } }
      })
      if (manager) {
        await prisma.notification.create({
          data: {
            userId: manager.id,
            type: 'gri_updated',
            priority: 'medium',
            title: `GRI Updated: ${client.name}`,
            body: `New GRI Score: ${score}/1000. ${score >= 800 ? 'Excellent performance!' : 'Review recommended.'}`,
            entityType: 'gri',
            entityId: report.id,
          }
        })
      }
    })

    return { clientId, score, domains }
  }
)
