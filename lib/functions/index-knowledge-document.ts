import { inngest } from '@/lib/inngest'
import { indexKnowledgeDocument } from '@/lib/sales-monitoring/knowledge-ingestion'

export const indexKnowledgeDocumentJob = inngest.createFunction(
  {
    id: 'index-knowledge-document',
    retries: 3,
    // The legacy Inngest client has no generated event map yet.
    triggers: { event: 'knowledge/document.uploaded' } as any,
  },
  async ({ event, step }: any) => {
    const documentId = String(event.data.documentId)
    return step.run('parse-chunk-embed', () => indexKnowledgeDocument(documentId))
  },
)
