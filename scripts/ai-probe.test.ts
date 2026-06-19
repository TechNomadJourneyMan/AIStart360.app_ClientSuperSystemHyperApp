/**
 * Latency probe — measures OpenRouter round-trip for different models/sizes so
 * we can pick a model that fits the <=20s budget. Manual only.
 *   npx vitest run --config scripts/vitest.smoke.config.ts scripts/ai-probe.test.ts
 */
import 'dotenv/config'
import { config as loadEnv } from 'dotenv'
import { describe, it } from 'vitest'
loadEnv({ path: '.env.local' })

import { chatWithOpenRouter, hasOpenRouterKey, OPENROUTER_MODELS } from '@/lib/ai/openrouter'

const run = hasOpenRouterKey() ? describe : describe.skip

async function timed(label: string, model: string, words: number) {
  const t0 = Date.now()
  const out = await chatWithOpenRouter({
    system: 'You are a business consultant. Respond in English, dense and specific.',
    user: `Write exactly ${words} words analysing a Kazakhstan coffee chain's finance and sales. Use numbers.`,
    model,
    maxTokens: Math.ceil(words * 2),
    temperature: 0.4,
  })
  const s = ((Date.now() - t0) / 1000).toFixed(1)
  process.stdout.write(`\n[probe] ${label.padEnd(22)} ${s}s  (${out?.split(/\s+/).length ?? 0} words)\n`)
}

run('latency probe', () => {
  it('measures models', async () => {
    await timed('sonnet ~250w', OPENROUTER_MODELS.sonnet, 250)
    await timed('haiku ~250w', OPENROUTER_MODELS.haiku, 250)
    await timed('sonnet ~600w', OPENROUTER_MODELS.sonnet, 600)
    await timed('haiku ~600w', OPENROUTER_MODELS.haiku, 600)
  }, 180_000)
})
