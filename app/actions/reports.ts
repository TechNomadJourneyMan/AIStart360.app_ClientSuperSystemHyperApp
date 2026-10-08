'use server'

import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireExpert, type ExpertViewer } from '@/lib/expert-auth'

type DbClient = {
  reportDocument: {
    create: typeof prisma.reportDocument.create
    findMany: typeof prisma.reportDocument.findMany
  }
  user: {
    findUnique: typeof prisma.user.findUnique
  }
}

const reportMetadataSchema = z.object({
  name: z.string().min(1, 'Название обязательно'),
  clientName: z.string().min(1, 'Название клиента обязательно'),
  category: z.enum(['GRI', 'Financial', 'Growth', 'Market', 'Custom']),
  type: z.enum(['pdf', 'xlsx', 'csv', 'docx']),
  fileUrl: z.string().min(1),
  fileSizeBytes: z.number().int().positive(),
  uploadedBy: z.string().min(1),
})

function toExtension(fileName: string): 'pdf' | 'xlsx' | 'csv' | 'docx' | null {
  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext === 'pdf' || ext === 'xlsx' || ext === 'csv' || ext === 'docx') return ext
  return null
}

/**
 * Every export of this 'use server' module is a public RPC endpoint (callable
 * with a Next-Action header from any page), so each one authorizes on its own:
 * the /reports page is staff-only in middleware, and so are these actions —
 * an approved admin / super_admin who passed the second factor
 * (requireExpert: approved status + staffMfaGate).
 */
const REPORT_HUB_ROLES = new Set(['admin', 'super_admin'])

async function reportHubStaff(): Promise<ExpertViewer | null> {
  const viewer = await requireExpert()
  return viewer && REPORT_HUB_ROLES.has(viewer.role ?? '') ? viewer : null
}

async function insertReportMetadata(input: z.input<typeof reportMetadataSchema>, db: DbClient) {
  const parsed = reportMetadataSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error('VALIDATION_ERROR')
  }

  return db.reportDocument.create({
    data: parsed.data,
  })
}

/**
 * Insert a report_documents row. With an explicit `db` (server code and tests
 * pass a transaction — an RPC caller cannot send a client object) the caller
 * has authorized already; without one this is the RPC path: staff only, and
 * the uploader is the session's identity, never the caller's claim.
 */
export async function createReportMetadata(
  input: {
    name: string
    clientName: string
    category: 'GRI' | 'Financial' | 'Growth' | 'Market' | 'Custom'
    type: 'pdf' | 'xlsx' | 'csv' | 'docx'
    fileUrl: string
    fileSizeBytes: number
    uploadedBy: string
  },
  db?: DbClient,
) {
  if (db) return insertReportMetadata(input, db)
  const staff = await reportHubStaff()
  if (!staff) throw new Error('UNAUTHORIZED')
  return insertReportMetadata({ ...input, uploadedBy: staff.email ?? staff.id }, prisma)
}

export async function getReportDocuments() {
  if (!(await reportHubStaff())) throw new Error('UNAUTHORIZED')
  return prisma.reportDocument.findMany({
    orderBy: { createdAt: 'desc' },
    // Cap the list — the Reports hub shows recent docs, not an unbounded dump.
    take: 100,
  })
}

export async function uploadReport(formData: FormData) {
  // Authorize before touching the file or the disk.
  const staff = await reportHubStaff()
  if (!staff) return { error: 'UNAUTHORIZED' }

  try {
    const file = formData.get('file')
    const name = String(formData.get('name') || '')
    const clientName = String(formData.get('clientName') || '')
    const category = String(formData.get('category') || 'Custom') as 'GRI' | 'Financial' | 'Growth' | 'Market' | 'Custom'

    if (!(file instanceof File) || file.size === 0) {
      return { error: 'FILE_REQUIRED' }
    }

    const extension = toExtension(file.name)
    if (!extension) {
      return { error: 'UNSUPPORTED_FILE_TYPE' }
    }

    if (file.size > 50 * 1024 * 1024) {
      return { error: 'FILE_TOO_LARGE' }
    }

    const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'reports')
    await mkdir(uploadsDir, { recursive: true })

    const storedFileName = `${Date.now()}-${randomUUID()}.${extension}`
    const diskPath = path.join(uploadsDir, storedFileName)
    const publicUrl = `/uploads/reports/${storedFileName}`

    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(diskPath, buffer)

    // The uploader is the authenticated session, never a client-set cookie.
    const uploadedBy = staff.email ?? staff.id

    await insertReportMetadata({
      name: name || file.name,
      clientName: clientName || 'Без клиента',
      category,
      type: extension,
      fileUrl: publicUrl,
      fileSizeBytes: file.size,
      uploadedBy,
    }, prisma)

    revalidatePath('/reports')
    revalidatePath('/expert/reports')
    revalidatePath('/admin-giga-panel/users')

    return { success: true }
  } catch (error) {
    console.error('uploadReportAction error:', error)
    return { error: 'UPLOAD_FAILED' }
  }
}

export async function uploadReportAction(formData: FormData): Promise<void> {
  await uploadReport(formData)
}
