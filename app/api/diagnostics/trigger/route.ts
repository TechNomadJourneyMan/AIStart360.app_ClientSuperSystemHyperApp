import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { parseDocument } from '@/lib/documents/parse'

// Optional: Force this route to be dynamic if you rely on headers/cookies etc.
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const clientId = formData.get('clientId') as string
    const file = formData.get('file') as File
    
    if (!clientId || !file) {
      return NextResponse.json({ error: 'Missing clientId or file' }, { status: 400 })
    }

    // 1. Create a DiagnosticRun record immediately to track status (Idempotent tracking)
    const run = await prisma.diagnosticRun.create({
      data: { 
        clientId, 
        status: 'parsing', 
        sourceFiles: [file.name] 
      }
    })

    // 2. Parse the document directly in Next.js before handing off to n8n
    // This removes the burden of complex file fetching/parsing from n8n 
    const buffer = Buffer.from(await file.arrayBuffer())
    const doc = await parseDocument(buffer, file.name)
    
    // 3. Save Document Summary
    const summary = await prisma.documentSummary.create({
      data: { 
        clientId, 
        content: doc.text, 
        metadata: doc.metadata 
      }
    })

    // Update run status to analyzing (handed off to n8n)
    await prisma.diagnosticRun.update({
      where: { id: run.id },
      data: { status: 'analyzing' }
    })
    
    // 4. Trigger n8n Webhook asynchronously (Fire and forget)
    // The n8n agent will pick up this payload and begin the orchestrations.
    const webhookUrl = process.env.N8N_WEBHOOK_URL
    if (webhookUrl) {
      fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Optionally add an auth header for n8n to verify
        },
        body: JSON.stringify({
          runId: run.id,
          clientId,
          summaryId: summary.id,
          fileName: file.name,
          // Sending text to n8n to avoid it having to query Supabase directly for PoC
          textPreview: doc.text.substring(0, 40000), 
          metadata: doc.metadata
        })
      }).catch(err => console.error('Error firing n8n webhook:', err))
    } else {
      console.warn('N8N_WEBHOOK_URL is not defined. Skipping AI orchestration.')
    }
    
    // Return immediately to the client so UI doesn't block while n8n works
    return NextResponse.json({ 
      success: true, 
      runId: run.id,
      summaryId: summary.id,
      message: 'Diagnostic run triggered successfully'
    })

  } catch (error: any) {
    console.error('Diagnostic trigger failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
