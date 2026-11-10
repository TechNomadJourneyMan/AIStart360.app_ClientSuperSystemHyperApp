import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { executeTaskById } from '@/lib/agents/queue'
import { runInBackground } from '@/lib/background'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { runsAgentWork } from '@/lib/runtime/role'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const bodySchema = z.object({ taskId: z.string().uuid() }).strict()

/**
 * POST /api/internal/agents/kick — "this task has just been queued, start it now".
 *
 * The portal in the web role does not execute agent tasks (PORTAL_ROLE, lib/runtime/role.ts): it
 * calls this route of the agents service over the private network instead
 * (lib/agents/remote-kick.ts). The task is claimed atomically in Postgres, so a repeated or a
 * stale call is harmless: a task that is taken, finished or unknown is simply not run.
 *
 * - A process that does not run agent work (the web role) answers 404: the route is not there.
 * - `Authorization: Bearer $CRON_SECRET`, checked exactly as on the cron routes (401, or 503 when
 *   the secret is not configured).
 * - The body is `{ "taskId": "<uuid>" }` and nothing else (400).
 * - The answer is 202 at once; the run goes on in the background, tracked so that a shutdown
 *   waits for it (lib/background.ts), under the same label as the inline run in the queue.
 */
export async function POST(req: NextRequest) {
  if (!runsAgentWork()) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  }
  const auth = isAuthorizedCron(req)
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.status === 503 ? 'CRON_SECRET не настроен' : 'Unauthorized' }, { status: auth.status })
  }
  const body = bodySchema.safeParse(await req.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 })
  }
  const { taskId } = body.data
  void runInBackground(`agent-task:${taskId}`, () => executeTaskById(taskId))
  return NextResponse.json({ ok: true }, { status: 202 })
}
