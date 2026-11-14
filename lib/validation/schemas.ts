/**
 * lib/validation/schemas — the request-body schemas of the client API
 * (R-053 mass assignment, R-149 Zod on writing routes).
 *
 * Each schema lists exactly the keys its known callers send (found by their
 * fetch in app/, components/, hooks/, lib/); `.strict()` refuses anything
 * else, so a browser cannot slip a service column (user_id, partner_id,
 * status, id…) into an insert / update.
 */
import { z } from 'zod'

/** Optional text: string (trimmed, capped) or null. */
const optText = (max: number) => z.union([z.string().trim().max(max), z.null()]).optional()

// ─── POST /api/client/register ──────────────────────────────────────────────
/**
 * The register page sends { userId, email, name, company }. Identity comes
 * from the session: `userId` is only cross-checked, `email` is ignored.
 */
export const ClientRegisterBody = z
  .object({
    userId: z.string().trim().max(64).optional(),
    email: z.string().trim().max(320).optional(),
    name: z.string().trim().max(120).optional(),
    company: z.string().trim().max(200).optional(),
  })
  .strict()
export type ClientRegisterBody = z.infer<typeof ClientRegisterBody>

// ─── POST /api/v1/onboarding/company ────────────────────────────────────────
/** Number of employees: a number, a numeric string, null, or a survey envelope { value }. */
const employeeCount = z
  .union([
    z.number(),
    z.string().trim().max(20),
    z.null(),
    z.object({ value: z.union([z.number(), z.string().trim().max(20), z.null()]) }).passthrough(),
  ])
  .optional()
  .transform((v, ctx): number | null | undefined => {
    if (v === undefined) return undefined
    const raw = v !== null && typeof v === 'object' ? v.value : v
    if (raw === null || raw === '') return null
    const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/\s+/g, ''))
    if (!Number.isInteger(n) || n < 0 || n > 10_000_000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Количество сотрудников — целое число от 0 до 10 000 000' })
      return z.NEVER
    }
    return n
  })

/**
 * The step-1 fields of the questionnaire mirrored into `companies` (the
 * onboarding page and lib/survey/answers-controller.ts send exactly these).
 * Never: id, user_id, partner_id, status, stage, size, target_revenue_*,
 * created_at / updated_at — they are owned by the server and the staff.
 */
export const OnboardingCompanyBody = z
  .object({
    // An empty name is «not given» (the column is NOT NULL): dropped, never written as ''.
    name: z.union([z.string().trim().max(200), z.null()]).optional().transform((v) => (v ? v : undefined)),
    industry: optText(200),
    employee_count: employeeCount,
    founded_at: optText(32),
    business_model: optText(100),
    regions: z.union([z.array(z.string().trim().max(100)).max(50), z.null()]).optional(),
    contact_name: optText(200),
    contact_position: optText(200),
    contact_phone: optText(50),
    contact_email: optText(320),
  })
  .strict()
export type OnboardingCompanyBody = z.infer<typeof OnboardingCompanyBody>

// ─── /api/v1/crm/* ──────────────────────────────────────────────────────────
/**
 * The keys of a CRM client (hooks/useCrm.ts AddClientInput / UpdateClientInput).
 * Types and hard caps only: the normalisation (phone → E.164, trimming to the
 * column caps, status list, dates) stays in lib/crm/client-validate.ts.
 */
const looseText = (max: number) => z.union([z.string().max(max), z.null()]).optional()
export const CrmClientBody = z
  .object({
    name: z.union([z.string().max(500), z.null()]).optional(),
    phone: looseText(64),
    phone_raw: looseText(64),
    email: looseText(1000),
    status: looseText(32),
    source: looseText(200),
    avg_check: z.union([z.number().finite().min(0).max(1e13), z.string().max(32), z.null()]).optional(),
    note: looseText(10_000),
    next_contact_at: looseText(64),
  })
  .strict()

/** Interaction kinds a user logs by hand (status_change is written by the system). */
export const CRM_LOGGABLE_KINDS = ['call', 'message', 'meeting', 'note'] as const
/** A WhatsApp draft can be long: it is cut to 2000 characters, refused only above 10 000. */
export const CrmInteractionBody = z
  .object({
    kind: z.enum(CRM_LOGGABLE_KINDS),
    comment: looseText(10_000),
  })
  .strict()

export const CrmReminderBody = z
  .object({
    due_at: z.string().trim().min(1).max(64),
    note: looseText(10_000),
  })
  .strict()

export const CrmReminderPatchBody = z
  .object({
    status: z.enum(['done', 'dismissed']),
    next_contact_at: looseText(64),
  })
  .strict()

export const CRM_PROVIDERS = ['bitrix24', 'amocrm'] as const
export const CrmConnectionBody = z
  .object({
    provider: z.enum(CRM_PROVIDERS),
    base_url: z.string().trim().min(1).max(500),
    access_token: z.string().trim().min(1).max(4096),
    connection_name: z.union([z.string().trim().max(120), z.null()]).optional(),
  })
  .strict()

// ─── PUT /api/v1/point-b/finmodel ───────────────────────────────────────────
/**
 * The shape only (1..20 items, a string key, string caps). The value range,
 * the key list, the date / period formats and the 500-character note are
 * checked by lib/point-b/finmodel (codes invalid_value / unknown_key with the
 * field), so `value` stays unknown here. Top-level extra keys (companyId,
 * userId) are dropped, as before: the company comes from the session.
 */
export const FINMODEL_MAX_VALUES = 20
export const FinmodelPutBody = z.object({
  values: z
    .array(
      z
        .object({
          key: z.string().min(1).max(100),
          value: z.unknown(),
          asOf: z.union([z.string().max(32), z.null()]).optional(),
          period: z.union([z.string().max(32), z.null()]).optional(),
          note: z.union([z.string().max(2000), z.null()]).optional(),
        })
        .strict(),
    )
    .min(1)
    .max(FINMODEL_MAX_VALUES),
})

// ─── POST /api/checkout ─────────────────────────────────────────────────────
/** app/_components/CheckoutButton.tsx sends { planKey }; an unknown provider falls back to the default. */
export const CheckoutBody = z
  .object({
    planKey: z.string().trim().min(1).max(64),
    provider: z.string().trim().max(32).optional(),
  })
  .strict()

// ─── POST /api/giga-admin/requests ──────────────────────────────────────────
/**
 * A request created by hand in GIGA (users.manage). The values match the Prisma enums of admin_requests
 * (AdminRequestType, RequestPriority); status is always «new» and never taken from the body.
 */
export const GigaAdminRequestBody = z
  .object({
    type: z.enum(['registration', 'access', 'support']).default('registration'),
    priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
    source: z.string().trim().min(1).max(64).default('manual'),
    payload: z.record(z.unknown()).default({}),
  })
  .strict()
export type GigaAdminRequestBody = z.infer<typeof GigaAdminRequestBody>
