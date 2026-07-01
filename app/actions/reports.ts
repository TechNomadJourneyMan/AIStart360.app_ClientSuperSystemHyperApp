'use server'

import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { prisma } from '@/lib/db'

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
  db: DbClient = prisma,
) {
  const parsed = reportMetadataSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error('VALIDATION_ERROR')
  }

  return db.reportDocument.create({
    data: parsed.data,
  })
}

export async function getReportDocuments(db: DbClient = prisma) {
  return db.reportDocument.findMany({
    orderBy: { createdAt: 'desc' },
    // Cap the list — the Reports hub shows recent docs, not an unbounded dump.
    take: 100,
  })
}

export async function uploadReport(formData: FormData) {
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

    const cookieStore = await cookies()
    const userId = cookieStore.get('aistart360_user_id')?.value
    let uploadedBy = 'System'

    if (userId) {
      const user = await prisma.user.findUnique({ where: { id: userId } })
      if (user?.name) uploadedBy = user.name
      else if (user?.email) uploadedBy = user.email
    }

    await createReportMetadata({
      name: name || file.name,
      clientName: clientName || 'Без клиента',
      category,
      type: extension,
      fileUrl: publicUrl,
      fileSizeBytes: file.size,
      uploadedBy,
    })

    revalidatePath('/reports')
    revalidatePath('/owner/reports')
    revalidatePath('/expert/reports')

    return { success: true }
  } catch (error) {
    console.error('uploadReportAction error:', error)
    return { error: 'UPLOAD_FAILED' }
  }
}

export async function uploadReportAction(formData: FormData): Promise<void> {
  await uploadReport(formData)
}
