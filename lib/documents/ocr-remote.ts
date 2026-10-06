/**
 * lib/documents/ocr-remote.ts — connects the remote OCR slot of
 * lib/documents/ocr.ts to the AI providers router (lib/ai/providers).
 *
 * The owner turns remote OCR on by routing the «ocr» capability to a model of
 * a provider with ocr_mode 'chat_vision' (GIGA → «Провайдеры и ключи», e.g.
 * DeepSeek OCR on Alem Plus). Without such a route nothing is registered and
 * the local tesseract engine does the work. Each page call checks the
 * platform and provider budgets and is recorded in ai_usage_ledger.
 *
 * Unverified until checked live: the request shape for vision OCR (see
 * ocrMessages in lib/ai/providers/client.ts). A failing remote page falls
 * back to tesseract, so a wrong assumption costs time, not data.
 */
import { hasRemoteOcr, registerRemoteOcr, type RemoteOcrCall } from './ocr'
import { resolveTarget, providerBudgetRefusal } from '@/lib/ai/providers/router'
import { computeCost, ocrImage } from '@/lib/ai/providers/client'
import { platformBudgetLeft, recordUsage } from '@/lib/ai/usage-ledger'

export const REMOTE_OCR_SOURCE = 'documents.ocr'

/** One page through the routed OCR model; null when not configured, over budget or failed. */
export const remoteOcrCall: RemoteOcrCall = async (image, mime, ctx) => {
  const resolved = await resolveTarget('ocr')
  if (!resolved.ok || resolved.target.ocrMode !== 'chat_vision') return null
  const target = resolved.target

  const left = await platformBudgetLeft()
  if (left !== null && left <= 0) return null
  if (await providerBudgetRefusal(target)) return null

  const timeoutMs = ctx ? Math.max(1_000, ctx.deadlineAt - Date.now()) : 60_000
  const res = await ocrImage(target, {
    imageUrl: `data:${mime};base64,${image.toString('base64')}`,
    timeoutMs,
  })

  const tokensIn = res.ok ? res.tokensIn ?? 0 : 0
  const tokensOut = res.ok ? res.tokensOut ?? 0 : 0
  const cost = computeCost({
    providerCostUsd: res.ok ? res.providerCostUsd : null,
    tokensIn,
    tokensOut,
    priceInPerMtok: target.priceInPerMtok,
    priceOutPerMtok: target.priceOutPerMtok,
  })
  await recordUsage({
    source: REMOTE_OCR_SOURCE,
    model: target.model,
    tokensIn,
    tokensOut,
    costUsd: cost.costUsd,
    costSource: cost.costSource,
    providerKey: target.providerKey,
    ok: res.ok,
  })

  if (!res.ok || !res.text.trim()) return null
  return { text: res.text }
}

/** True while the registered remote engine is the one this module put there. */
let registeredByRouter = false

function unregisterOwn(): void {
  if (registeredByRouter) registerRemoteOcr(null)
  registeredByRouter = false
}

/**
 * Register the remote engine when an OCR route is usable, unregister it
 * otherwise. Called before each document OCR so admin changes apply without a
 * redeploy (the router caches its snapshot for ≤ 60 s). An engine registered
 * by someone else (scripts/ocr --remote-module, tests) is left alone.
 */
export async function syncRemoteOcr(): Promise<boolean> {
  if (hasRemoteOcr() && !registeredByRouter) return true
  try {
    const resolved = await resolveTarget('ocr')
    if (!resolved.ok || resolved.target.ocrMode !== 'chat_vision') {
      unregisterOwn()
      return false
    }
    registerRemoteOcr(remoteOcrCall, { name: `remote:${resolved.target.providerKey}/${resolved.target.model}` })
    registeredByRouter = true
    return true
  } catch (err) {
    console.warn('[ocr] remote OCR route check failed:', err instanceof Error ? err.message.split('\n')[0] : err)
    unregisterOwn()
    return false
  }
}
