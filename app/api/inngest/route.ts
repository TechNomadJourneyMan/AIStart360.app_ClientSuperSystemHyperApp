import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest'
import { inngestFunctionsForRole } from '@/lib/functions/registry'
import { portalRole } from '@/lib/runtime/role'

export const runtime = 'nodejs'
// A stuck run must release its DB connections soon (runs are budgeted to ~45 s).
export const maxDuration = 120

// The functions of the role this process booted with (PORTAL_ROLE): the list, and the notes on
// each function, are in lib/functions/registry.ts. A change of the role needs a new sync (PUT).
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: inngestFunctionsForRole(portalRole()),
})
