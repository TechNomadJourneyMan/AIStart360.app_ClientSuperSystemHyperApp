import { inngest } from '@/lib/inngest'
import {
  COMM_CAMPAIGN_RUN_EVENT, campaignTick, emitCampaignRun, loadSendSchedule, staleRunningCampaigns, type TickResult,
} from '@/lib/comm/campaigns'
import { isWithinWindow } from '@/lib/comm/schedule'
import { createServiceClient } from '@/lib/supabase-service'

/**
 * Inngest wiring of broadcasts (lib/comm/campaigns.ts, spec §6.2).
 *
 * DB discipline (the 504 of 2026-10-15 came from background jobs holding
 * pooler connections):
 *   - every recipient is its own short step.run (a few queries + the delivery);
 *   - pauses between messages and the wait for working hours are step.sleep /
 *     step.sleepUntil — Inngest calls back later, nothing is held meanwhile;
 *   - the campaign status is read before every send: pause / cancel stop the run
 *     at its next step;
 *   - after CAMPAIGN_SENDS_PER_RUN steps the run hands over to a fresh run (an
 *     event) and ends — the per-run step limit is never reached;
 *   - one step at a time over all campaigns (concurrency 1; sleeping runs do
 *     not occupy the slot), one run per campaign (singleton: a newer event —
 *     continuation, «Продолжить», the watchdog — replaces the old run; the
 *     pending → sending claim makes an overlap harmless).
 * inngest 4.x registers triggers only via `triggers: [...]`.
 */

/** Steps of one run before it hands over to the next (each = tick + pause). */
export const CAMPAIGN_SENDS_PER_RUN = 150
/** After a lost claim (another run took the user) — a short breath, not a spin. */
const IDLE_PAUSE_MS = 2_000

export interface CampaignEngineStep {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>
  sleep(id: string, ms: number): Promise<unknown>
  sleepUntil(id: string, at: string | Date): Promise<unknown>
  sendEvent(id: string, payload: { name: string; data: Record<string, unknown> }): Promise<unknown>
}

export interface CampaignEngineDeps {
  tick?: (campaignId: string) => Promise<TickResult>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The handler, exported for tests (a fake `step` replays it synchronously). */
export async function runCampaignEngine(
  { event, step }: { event: { data?: { campaignId?: unknown } }; step: CampaignEngineStep },
  deps: CampaignEngineDeps = {},
) {
  const campaignId = event.data?.campaignId
  if (typeof campaignId !== 'string' || !UUID_RE.test(campaignId)) return { skipped: 'no campaignId' }
  const tick = deps.tick ?? ((id: string) => campaignTick(id))
  let sent = 0
  for (let i = 0; i < CAMPAIGN_SENDS_PER_RUN; i++) {
    const r = await step.run(`tick-${i}`, () => tick(campaignId))
    if (r.action === 'stop') return { stopped: r.reason, sent }
    if (r.action === 'done') return { done: true, sent }
    if (r.action === 'wait') await step.sleepUntil(`window-${i}`, r.until)
    else if (r.action === 'idle') await step.sleep(`idle-${i}`, IDLE_PAUSE_MS)
    else {
      sent++
      if (r.pauseMs > 0) await step.sleep(`pause-${i}`, r.pauseMs)
    }
  }
  await step.sendEvent('continue', { name: COMM_CAMPAIGN_RUN_EVENT, data: { campaignId } })
  return { continued: true, sent }
}

export const commCampaignRun = inngest.createFunction(
  {
    id: 'comm-campaign-run',
    // A failed step (DB hiccup) is retried; a claimed recipient is never resent.
    retries: 2,
    concurrency: [{ limit: 1 }, { key: 'event.data.campaignId', limit: 1 }],
    singleton: { key: 'event.data.campaignId', mode: 'cancel' },
    triggers: [{ event: COMM_CAMPAIGN_RUN_EVENT }],
  },
  // @ts-ignore -- handler inference is incomplete in this repository's Inngest setup.
  async ({ event, step }: { event: { data?: { campaignId?: unknown } }; step: CampaignEngineStep }) => runCampaignEngine({ event, step }),
)

/**
 * Safety net: a running campaign whose engine went quiet (lost event, crashed
 * run) gets its event again. Works only inside the working hours and not in
 * their first 15 minutes (a run sleeping until the window is just waking up);
 * outside them it does not even touch the database.
 */
export async function campaignWatchdog(deps: { now?: Date; emit?: (id: string) => Promise<boolean> } = {}) {
  const now = deps.now ?? new Date()
  const { window, intervalSeconds, jitterSeconds } = await loadSendSchedule()
  if (!isWithinWindow(now, window) || !isWithinWindow(new Date(now.getTime() - 15 * 60_000), window)) {
    return { skipped: 'outside_window' }
  }
  // A live run touches the campaign after every send: quiet for longer than the
  // longest pause + 5 minutes (at least 10) means nobody is sending.
  const staleMinutes = Math.max(10, Math.ceil((intervalSeconds + jitterSeconds) / 60) + 5)
  const ids = await staleRunningCampaigns(createServiceClient(), now, staleMinutes)
  let revived = 0
  for (const id of ids) if (await (deps.emit ?? emitCampaignRun)(id)) revived++
  return { stale: ids.length, revived }
}

export const commCampaignWatchdog = inngest.createFunction(
  { id: 'comm-campaign-watchdog', retries: 0, concurrency: { limit: 1 }, triggers: [{ cron: '*/15 * * * *' }] },
  // @ts-ignore -- handler inference is incomplete in this repository's Inngest setup.
  async () => campaignWatchdog(),
)
