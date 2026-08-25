import { createHash } from 'node:crypto'
import {
  DEFAULT_META_GRAPH_API_VERSION,
  DEFAULT_META_GRAPH_TIMEOUT_MS,
  WHATSAPP_GRAPH_ORIGIN,
  redactMetaSecrets,
  type MetaFetch,
} from '@/lib/omnichannel/meta-client'
import {
  MYHONOR_TEMPLATE_PARAMETER_CONTRACT,
  myHonorTemplateBodyContract,
} from './templates'
import {
  MYHONOR_REACTIVATION_ENV_NAMES,
  type MyHonorReactivationSegment,
} from './types'

type Environment = Readonly<Record<string, string | undefined>>

interface MetaTemplateComponent {
  type?: unknown
  text?: unknown
  [key: string]: unknown
}

interface MetaTemplateRecord {
  id?: unknown
  name?: unknown
  status?: unknown
  category?: unknown
  language?: unknown
  components?: unknown
}

export interface MyHonorTemplatePreflightSuccess {
  ok: true
  templateId: string | null
  templateName: string
  languageCode: string
  status: 'APPROVED'
  category: 'MARKETING'
  bodyParameterCount: number
  contractHash: string
}

export interface MyHonorTemplatePreflightFailure {
  ok: false
  code:
    | 'configuration_error'
    | 'provider_unavailable'
    | 'template_not_found'
    | 'template_ambiguous'
    | 'template_not_approved'
    | 'template_wrong_category'
    | 'template_contract_mismatch'
    | 'template_copy_mismatch'
    | 'template_opt_out_missing'
  message: string
  retryable: boolean
  status: number | null
}

export type MyHonorTemplatePreflightResult =
  | MyHonorTemplatePreflightSuccess
  | MyHonorTemplatePreflightFailure

export interface VerifyMyHonorTemplateInput {
  segment: MyHonorReactivationSegment
  templateName: string
  languageCode: string
  env?: Environment
  fetchImpl?: MetaFetch
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function graphVersion(value: string | undefined): string {
  const candidate = nonEmpty(value)
  if (!candidate || !/^v?\d+\.\d+$/.test(candidate)) {
    return DEFAULT_META_GRAPH_API_VERSION
  }
  return candidate.startsWith('v') ? candidate : `v${candidate}`
}

function timeoutMs(value: string | undefined): number {
  const candidate = Number.parseInt(value ?? '', 10)
  return Number.isSafeInteger(candidate) && candidate > 0
    ? Math.min(candidate, 120_000)
    : DEFAULT_META_GRAPH_TIMEOUT_MS
}

function failure(
  code: MyHonorTemplatePreflightFailure['code'],
  message: string,
  options: { retryable?: boolean; status?: number | null } = {},
): MyHonorTemplatePreflightFailure {
  return {
    ok: false,
    code,
    message,
    retryable: options.retryable ?? false,
    status: options.status ?? null,
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function exactTemplateRows(
  payload: unknown,
  templateName: string,
  languageCode: string,
): MetaTemplateRecord[] {
  const data = record(payload)?.data
  if (!Array.isArray(data)) return []
  return data.filter((value): value is MetaTemplateRecord => {
    const row = record(value)
    return row?.name === templateName && row.language === languageCode
  })
}

function templateComponents(value: unknown): MetaTemplateComponent[] | null {
  if (!Array.isArray(value)) return null
  return value.every((item) => record(item) !== null)
    ? value as MetaTemplateComponent[]
    : null
}

function placeholders(value: string): { values: number[]; valid: boolean } {
  const matches = [...value.matchAll(/{{\s*([^{}]+?)\s*}}/g)]
  const stripped = value.replace(/{{\s*([^{}]+?)\s*}}/g, '')
  if (stripped.includes('{{') || stripped.includes('}}')) {
    return { values: [], valid: false }
  }
  const values: number[] = []
  for (const match of matches) {
    const raw = match[1]?.trim() ?? ''
    if (!/^[1-9][0-9]*$/.test(raw)) return { values: [], valid: false }
    values.push(Number(raw))
  }
  return { values, valid: true }
}

function hasExplicitOptOut(value: string): boolean {
  return /(?:^|[\s(])(?:STOP|СТОП)(?:[\s).,!?:;]|$)/iu.test(value)
}

export interface ExpectedMyHonorTemplateContractHashInput {
  segment: MyHonorReactivationSegment
  templateName: string
  languageCode: string
}

/**
 * Returns the immutable contract reviewed by an operator before launch. The
 * hash deliberately excludes Meta's revision id: it binds the server-owned
 * template identity and the entire permitted visible payload instead.
 */
export function expectedMyHonorTemplateContractHash(
  input: ExpectedMyHonorTemplateContractHashInput,
): string | null {
  const expectedBody = myHonorTemplateBodyContract(
    input.segment,
    input.languageCode,
  )
  if (
    !expectedBody
    || !/^[a-z0-9_]{1,512}$/.test(input.templateName)
    || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(input.languageCode)
  ) return null

  return createHash('sha256').update(JSON.stringify({
    contractVersion: 1,
    segment: input.segment,
    templateName: input.templateName,
    languageCode: input.languageCode,
    status: 'APPROVED',
    category: 'MARKETING',
    visibleComponents: [{ type: 'BODY', text: expectedBody }],
    parameterContract: MYHONOR_TEMPLATE_PARAMETER_CONTRACT[input.segment],
    nonBodyComponentPolicy: 'reject',
  })).digest('hex')
}

function providerMessage(payload: unknown, token: string): string {
  const error = record(record(payload)?.error)
  return redactMetaSecrets(
    nonEmpty(error?.message) ?? 'Meta template verification failed',
    [token],
  )
}

/**
 * Confirms the exact Meta-owned template immediately before launch. Environment
 * presence alone is never treated as proof of APPROVED/MARKETING status or of
 * the positional placeholder contract used by the recipient processor.
 */
export async function verifyMyHonorReactivationTemplate(
  input: VerifyMyHonorTemplateInput,
): Promise<MyHonorTemplatePreflightResult> {
  const env = input.env ?? process.env
  const token = nonEmpty(env[MYHONOR_REACTIVATION_ENV_NAMES.whatsappToken])
  const businessAccountId = nonEmpty(
    env[MYHONOR_REACTIVATION_ENV_NAMES.whatsappBusinessAccountId],
  )
  if (
    !token
    || !businessAccountId
    || !/^[0-9]{5,64}$/.test(businessAccountId)
    || !/^[a-z0-9_]{1,512}$/.test(input.templateName)
    || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(input.languageCode)
  ) {
    return failure(
      'configuration_error',
      'WhatsApp Business Account or template verification configuration is invalid',
    )
  }

  const url = new URL(
    `${WHATSAPP_GRAPH_ORIGIN}/${graphVersion(env.META_GRAPH_API_VERSION)}/${encodeURIComponent(businessAccountId)}/message_templates`,
  )
  url.searchParams.set('name', input.templateName)
  url.searchParams.set('fields', 'id,name,status,category,language,components')
  url.searchParams.set('limit', '100')

  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs(env.META_GRAPH_TIMEOUT_MS),
  )
  let response: Response
  let payload: unknown
  try {
    response = await (input.fetchImpl ?? globalThis.fetch.bind(globalThis))(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    })
    const body = await response.text()
    if (body.length > 1_000_000) {
      return failure('provider_unavailable', 'Meta template response is too large', {
        retryable: true,
        status: response.status,
      })
    }
    try {
      payload = body ? JSON.parse(body) : null
    } catch {
      return failure('provider_unavailable', 'Meta template response is not valid JSON', {
        retryable: response.status >= 500,
        status: response.status,
      })
    }
  } catch (error) {
    const timedOut = controller.signal.aborted
      || (error instanceof Error && error.name === 'AbortError')
    return failure(
      'provider_unavailable',
      timedOut
        ? 'Meta template verification timed out'
        : redactMetaSecrets(error, [token]),
      { retryable: true },
    )
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok || record(payload)?.error) {
    return failure('provider_unavailable', providerMessage(payload, token), {
      retryable: response.status === 429 || response.status >= 500,
      status: response.status,
    })
  }

  const matches = exactTemplateRows(payload, input.templateName, input.languageCode)
  if (matches.length === 0) {
    return failure(
      'template_not_found',
      'The configured WhatsApp template was not found for the exact language',
      { status: response.status },
    )
  }
  if (matches.length !== 1) {
    return failure(
      'template_ambiguous',
      'Meta returned more than one exact WhatsApp template revision',
      { status: response.status },
    )
  }

  const template = matches[0]
  if (String(template.status ?? '').toUpperCase() !== 'APPROVED') {
    return failure(
      'template_not_approved',
      'The configured WhatsApp template is not APPROVED',
      { status: response.status },
    )
  }
  if (String(template.category ?? '').toUpperCase() !== 'MARKETING') {
    return failure(
      'template_wrong_category',
      'The configured WhatsApp template is not a MARKETING template',
      { status: response.status },
    )
  }

  const components = templateComponents(template.components)
  const bodyComponents = components?.filter(
    (component) => String(component.type ?? '').toUpperCase() === 'BODY',
  ) ?? []
  const nonBodyComponents = components?.filter(
    (component) => String(component.type ?? '').toUpperCase() !== 'BODY',
  ) ?? []
  const bodyText = bodyComponents.length === 1
    ? nonEmpty(bodyComponents[0]?.text)
    : null
  const expectedParameters = MYHONOR_TEMPLATE_PARAMETER_CONTRACT[input.segment]
  const parsed = bodyText ? placeholders(bodyText) : { values: [], valid: false }
  const unique = [...new Set(parsed.values)].sort((left, right) => left - right)
  const expectedIndexes = expectedParameters.map((_, index) => index + 1)
  const bodyOnly = components?.length === 1
    && bodyComponents.length === 1
    && nonBodyComponents.length === 0
  const contractMatches = bodyOnly
    && parsed.valid
    && unique.length === expectedIndexes.length
    && unique.every((value, index) => value === expectedIndexes[index])
  if (!bodyText || !components || !contractMatches) {
    return failure(
      'template_contract_mismatch',
      'The approved template must contain exactly one BODY component and match the server-owned parameter contract',
      { status: response.status },
    )
  }
  if (!hasExplicitOptOut(bodyText)) {
    return failure(
      'template_opt_out_missing',
      'The approved marketing template must contain an explicit STOP/СТОП opt-out instruction',
      { status: response.status },
    )
  }
  const expectedBody = myHonorTemplateBodyContract(
    input.segment,
    input.languageCode,
  )
  if (!expectedBody || bodyText !== expectedBody) {
    return failure(
      'template_copy_mismatch',
      'The approved marketing template body does not match the reviewed server copy',
      { status: response.status },
    )
  }

  const templateId = nonEmpty(template.id)
  const contractHash = expectedMyHonorTemplateContractHash({
    segment: input.segment,
    templateName: input.templateName,
    languageCode: input.languageCode,
  })
  if (!contractHash) {
    return failure(
      'template_contract_mismatch',
      'The approved template contract cannot be represented safely',
      { status: response.status },
    )
  }
  return {
    ok: true,
    templateId,
    templateName: input.templateName,
    languageCode: input.languageCode,
    status: 'APPROVED',
    category: 'MARKETING',
    bodyParameterCount: expectedParameters.length,
    contractHash,
  }
}
