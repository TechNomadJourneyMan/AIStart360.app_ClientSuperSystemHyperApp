import { NextRequest, NextResponse } from 'next/server'
import { requireGiga } from '@/lib/admin/giga-actor'
import { providerErrorResponse, readBody, toProviderActor } from '@/lib/admin/ai-providers-http'
import { createProvider, listProviders, providerInputSchema } from '@/lib/ai/providers/service'
import { isEncryptionConfigured } from '@/lib/crypto/secrets'

export const dynamic = 'force-dynamic'

/**
 * GET /api/giga-admin/ai-providers — all LLM providers with their keys (masked
 * only), models and the routes they serve; plus whether keys can be stored
 * (SECRETS_ENCRYPTION_KEY configured). Read: agents.view.
 */
export async function GET(req: NextRequest) {
  const g = await requireGiga(req, 'agents.view')
  if (g.response) return g.response
  try {
    const providers = await listProviders()
    return NextResponse.json({ ok: true, providers, encryptionConfigured: isEncryptionConfigured() })
  } catch (err) {
    return providerErrorResponse('giga-admin/ai-providers', err)
  }
}

/** POST /api/giga-admin/ai-providers — create a provider (no keys here). settings.manage. */
export async function POST(req: NextRequest) {
  const g = await requireGiga(req, 'settings.manage')
  if (g.response) return g.response
  const body = await readBody(req, providerInputSchema)
  if (!body.ok) return body.response
  try {
    const provider = await createProvider(toProviderActor(g.actor, req), body.data)
    return NextResponse.json({ ok: true, provider }, { status: 201 })
  } catch (err) {
    return providerErrorResponse('giga-admin/ai-providers', err)
  }
}
