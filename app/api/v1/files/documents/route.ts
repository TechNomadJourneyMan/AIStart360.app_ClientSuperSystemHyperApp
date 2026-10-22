export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import type { NextRequest } from 'next/server'
import { liveFileAccessDeps } from '@/lib/documents/file-access'
import { handleFileRequest } from '@/lib/documents/file-route'

/**
 * GET /api/v1/files/documents?path=<uid>/…[&bucket=documents|client-documents][&format=json]
 *
 * Access-checked file link: owner / staff in scope / company reader → 302 to a
 * 10-minute signed URL. Never a public Storage URL (lib/documents/file-route.ts).
 */
export async function GET(req: NextRequest) {
  return handleFileRequest(req, liveFileAccessDeps(req))
}
