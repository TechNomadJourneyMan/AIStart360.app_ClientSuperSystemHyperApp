export const dynamic = "force-dynamic"

import type { Metadata } from 'next'
import { getReportDocuments } from '@/app/actions/reports'
import { ReportUploadForm } from '@/components/reports/ReportUploadForm'
import { ReportsBrowser, type ReportCard } from '@/components/reports/ReportsBrowser'

export const metadata: Metadata = { title: 'Отчёты' }

export default async function ReportsPage() {
  const documents = await getReportDocuments()

  // Plain shape for the client component — Prisma rows carry Date objects.
  const reports: ReportCard[] = documents.map((document) => ({
    id: document.id,
    name: document.name,
    clientName: document.clientName,
    category: document.category,
    type: document.type,
    fileUrl: document.fileUrl,
    fileSizeBytes: document.fileSizeBytes,
    createdAt: document.createdAt.toISOString(),
  }))

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-3xl font-bold text-on-surface">Отчёты</h1>
          <p className="text-on-surface-variant text-sm mt-1">
            Хранилище документов: последние 100 загруженных файлов.
          </p>
        </div>
      </div>

      <ReportsBrowser reports={reports}>
        <ReportUploadForm />
      </ReportsBrowser>
    </div>
  )
}
