import { inngest } from '@/lib/inngest'
import { prisma } from '@/lib/db'

// Legacy Inngest GRI path.
//
// The real GRI flow is the 62-criteria assessment persisted to gri_assessments
// (see app/api/v1/gri/assessment). This background function never had a real
// scoring algorithm — it previously filled domain scores with Math.random()
// and saved them to griReport, which is fabricated data shown as if real.
//
// Per the data-integrity rules we refuse to persist invented scores. The
// function now fails loudly instead of writing fake numbers. When a real
// algorithm exists (deriving domains from client.reports / survey_answers),
// replace the throw below. See docs/technical-audit.md (D2).
export const calculateGri = inngest.createFunction(
  {
    id: 'calculate-gri',
    // @ts-ignore
    event: 'gri/calculate',
  },
  // @ts-ignore
  async ({ event, step }: any) => {
    const { clientId } = event.data

    const client = await step.run('fetch-client', async () => {
      return prisma.client.findUnique({
        where: { id: clientId },
        include: { reports: { orderBy: { uploadedAt: 'desc' }, take: 5 } },
      })
    })

    if (!client) throw new Error(`Client ${clientId} not found`)

    throw new Error(
      'GRI calculation is not available for this legacy path — there is no real ' +
        'scoring source for client ' + clientId + '. Use the GRI assessment ' +
        '(/api/v1/gri/assessment), which scores the 62 real criteria. ' +
        'Random scoring has been disabled to avoid persisting fabricated data.'
    )
  }
)
