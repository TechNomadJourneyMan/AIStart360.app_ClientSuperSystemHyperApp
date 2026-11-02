#!/usr/bin/env node
/**
 * scripts/railway/push-env.mjs — a ONE-OFF script: it runs once, as the build command of a throwaway
 * Vercel build (production environment), and pushes the project's environment variables straight into
 * the Railway service through Railway's public GraphQL API. The values never pass through a person, a
 * chat, git, a log or a disk. How to set the throwaway build up: scripts/railway/env-sync/README.md.
 *
 * Inputs, all next to this file in the throwaway folder:
 *   names.json            the variable NAMES to move (from `vercel env ls production`) - no values
 *   railway-target.json   { projectId, environmentId, serviceId } - ids, no secrets
 *   RAILWAY_ENV_SYNC_TOKEN  (environment) a Railway PROJECT token limited to the production environment
 *
 * The exit code is never 0, on purpose: a build that fails creates no usable Vercel deployment.
 *   1  the transfer was done (the log says «Перенос завершён, сборка остановлена намеренно»)
 *   2  it was not
 *
 * What the output may contain: counts, variable NAMES and Railway error CODES, nothing else. Never a
 * value, never the token, and never any free text from Railway: a GraphQL error can echo the request
 * in a form no filter can be sure to catch (truncated, re-wrapped, whitespace-normalised), so an
 * error is reported by HTTP status, number of errors and each errors[].extensions.code - not by its
 * message. A network error reports its kind only.
 *
 * After the upsert the script checks the write itself, with the same token: it asks Railway for the
 * service's variables (the answer holds names AND values), compares the names with the ones it sent,
 * in memory, and keeps only the names that are absent. The fetched object never leaves the function
 * that compared it. Verifying by any other means (a listing that returns values) would put every
 * secret in front of whoever reads it, which is what this script exists to avoid.
 *
 * Plain ESM, no dependencies, Node 20+ (global fetch, AbortSignal.timeout).
 */
import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const RAILWAY_ENDPOINT = 'https://backboard.railway.com/graphql/v2'
export const SUCCESS_LINE = 'Перенос завершён, сборка остановлена намеренно'

const TOKEN_NAME = 'RAILWAY_ENV_SYNC_TOKEN'
/** Names of the build system itself, never project variables. */
const SYSTEM_PREFIXES = ['VERCEL', 'TURBO_', 'NX_DAEMON']
/**
 * Variables that the Railway service defines itself (they exist before the push, and mean something
 * different there). `replace: false` still overwrites a name that is sent, so they are never sent.
 */
const RAILWAY_OWNED = new Set([
  'PORT',
  'PERSISTENT_SERVER',
  'CRON_RUNNER_ENABLED',
  'INTERNAL_BASE_URL',
  'NEXT_MANUAL_SIG_HANDLE',
  'WORKFLOW_TARGET_WORLD',
  'WORKFLOW_POSTGRES_URL',
  'WORKFLOW_POSTGRES_WORKER_CONCURRENCY',
  'RAILWAY_DEPLOYMENT_DRAINING_SECONDS',
  'RAILPACK_NODE_VERSION',
])

/**
 * What a name in names.json may look like. This only rejects content that is obviously not a name
 * (a URL, a multi-line key, anything with punctuation); a token-shaped secret IS made of these
 * characters, so names.json must be made from `vercel env ls` - names only - and never from values.
 */
const NAME_PATTERN = /^[A-Za-z0-9_]{1,256}$/
/** An error code is a constant like UNAUTHENTICATED; anything else is not trusted to be a code. */
const CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const NO_CODE = 'без кода'
/** A kind of network error: a class name or a system code (TypeError, ECONNRESET, TimeoutError). */
const KIND_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/
const MAX_CODES = 20
const MAX_LINE_LENGTH = 200
const REQUEST_TIMEOUT_MS = 60_000

const MUTATION = `mutation variableCollectionUpsert($input: VariableCollectionUpsertInput!) {
  variableCollectionUpsert(input: $input)
}`
const VARIABLES_QUERY = `query variables($projectId: String!, $environmentId: String!, $serviceId: String, $unrendered: Boolean) {
  variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId, unrendered: $unrendered)
}`

/**
 * @typedef {{ projectId: string, environmentId: string, serviceId: string }} RailwayIds
 * @typedef {{ present: number, total: number, absent: string[] }} Verification how many of the names sent are on Railway, and which are not
 * @typedef {{ ok: true, pushed: number, verification?: Verification, skippedEmpty?: string[], missing?: string[], excluded?: string[] }} SuccessResult
 * @typedef {{ ok: false, reason: string, errorCodes?: string[], verification?: Verification, skippedEmpty?: string[], missing?: string[], excluded?: string[] }} FailureResult
 */

/** A problem with the input files or the token: its text is ours and safe to print. */
class InputError extends Error {}

const hasOwn = (/** @type {object} */ object, /** @type {string} */ key) => Object.prototype.hasOwnProperty.call(object, key)

/** Is this name left out of the push: build-system names, the sync token itself, names Railway owns. */
export function isExcluded(/** @type {string} */ name) {
  return SYSTEM_PREFIXES.some((prefix) => name.startsWith(prefix)) || name === TOKEN_NAME || RAILWAY_OWNED.has(name)
}

/**
 * Picks the values to push out of the build's environment. Only the listed names are looked at, so
 * nothing else in the build environment can leave. Values are passed on exactly as they are.
 * @param {Record<string, string | undefined>} env
 * @param {string[]} names
 * @returns {{ variables: Record<string, string>, skippedEmpty: string[], missing: string[] }}
 */
export function selectVariables(env, names) {
  /** @type {Record<string, string>} */
  const variables = Object.create(null)
  /** @type {string[]} */
  const skippedEmpty = []
  /** @type {string[]} */
  const missing = []
  for (const name of new Set(names)) {
    if (isExcluded(name)) continue
    // own properties only: `constructor` or `toString` must not count as a variable
    const value = hasOwn(env, name) ? env[name] : undefined
    if (value === undefined) missing.push(name)
    else if (value === '') skippedEmpty.push(name)
    else variables[name] = value
  }
  return { variables, skippedEmpty, missing }
}

/**
 * The GraphQL request. The values travel in `variables.input` (JSON), never inside the query text, so
 * a multi-line value needs no GraphQL escaping and arrives byte for byte. `replace: false` keeps the
 * variables that are already on the service; `skipDeploys: true` pushes without starting a deploy.
 * @param {RailwayIds} ids
 * @param {Record<string, string>} variables
 */
export function buildUpsertBody(ids, variables) {
  return {
    query: MUTATION,
    variables: {
      input: {
        projectId: ids.projectId,
        environmentId: ids.environmentId,
        serviceId: ids.serviceId,
        variables,
        replace: false,
        skipDeploys: true,
      },
    },
  }
}

/**
 * The request that lists the service's variables: Railway answers with a JSON object of name -> value.
 * `unrendered` keeps references like ${{Postgres.DATABASE_URL}} as they are stored; only names are used.
 * @param {RailwayIds} ids
 */
export function buildVariablesQueryBody(ids) {
  return {
    query: VARIABLES_QUERY,
    variables: { projectId: ids.projectId, environmentId: ids.environmentId, serviceId: ids.serviceId, unrendered: true },
  }
}

const oneLine = (/** @type {unknown} */ text) => String(text).replace(/\s+/g, ' ').trim().slice(0, MAX_LINE_LENGTH)

/** What went wrong with a request, by kind only. A network error's own message is never used. */
function describeError(/** @type {any} */ error) {
  const kind = [error?.name, error?.cause?.code ?? error?.code].filter((part) => typeof part === 'string' && KIND_PATTERN.test(part))
  return kind.join(' ') || 'неизвестная ошибка'
}

/** The code of one GraphQL error, or «без кода». Its message is never read. */
function codeOf(/** @type {any} */ error) {
  const code = error?.extensions?.code
  return typeof code === 'string' && CODE_PATTERN.test(code) ? code : NO_CODE
}

/**
 * @param {string} reason
 * @param {Partial<FailureResult>} [extra]
 * @returns {FailureResult}
 */
function failure(reason, extra = {}) {
  return { ok: false, reason, ...extra }
}

/**
 * One GraphQL call. A problem is described without a word of Railway's free text: the HTTP status,
 * the number of errors and each error's code. On success `data` is Railway's `data` object, which
 * may hold values: the caller takes what it needs from it and lets go.
 * @param {{ fetchImpl: typeof fetch, token: string, body: unknown, timeoutMs: number }} call
 * @returns {Promise<{ data: any } | { failed: string, errorCodes?: string[] }>}
 */
async function callRailway({ fetchImpl, token, body, timeoutMs }) {
  /** @type {Response} */
  let response
  try {
    response = await fetchImpl(RAILWAY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Project-Access-Token': token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    return { failed: `запрос к Railway не выполнен (${describeError(error)})` }
  }

  /** @type {any} */
  let payload = null
  try {
    payload = JSON.parse(await response.text())
  } catch {
    // not JSON (a proxy's page, say): the status alone is reported
  }
  const errors = Array.isArray(payload?.errors) ? payload.errors : []
  const errorCodes = errors.map(codeOf)

  if (!response.ok) return { failed: `Railway ответил HTTP ${Number(response.status)}`, errorCodes }
  if (errors.length > 0) return { failed: `Railway вернул ошибки (${errors.length})`, errorCodes }
  return { data: payload?.data }
}

/**
 * The names of the service's variables, from Railway. The answer carries the values too; they are
 * dropped here, so nothing but names leaves this function.
 * @param {{ fetchImpl: typeof fetch, token: string, ids: RailwayIds, timeoutMs: number }} options
 * @returns {Promise<{ names: Set<string> } | { failed: string, errorCodes?: string[] }>}
 */
async function fetchStoredNames({ fetchImpl, token, ids, timeoutMs }) {
  const answer = await callRailway({ fetchImpl, token, body: buildVariablesQueryBody(ids), timeoutMs })
  if ('failed' in answer) return answer
  const stored = answer.data?.variables
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return { failed: 'ответ без списка переменных' }
  return { names: new Set(Object.keys(stored)) }
}

/**
 * Pushes the chosen variables to Railway and checks, by name, that they are there. Returns a result
 * for `formatReport`; never throws for a problem with the input or the requests.
 * @param {{
 *   env: Record<string, string | undefined>,
 *   names: unknown,
 *   ids: unknown,
 *   token: unknown,
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number,
 * }} options
 * @returns {Promise<SuccessResult | FailureResult>}
 */
export async function syncEnv({ env, names, ids, token, fetchImpl = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const secretToken = typeof token === 'string' ? token.trim() : ''
  if (!secretToken) return failure(`не задан ${TOKEN_NAME}`)

  if (!Array.isArray(names)) return failure('names.json должен быть списком имён переменных')
  const badNames = names.filter((name) => typeof name !== 'string' || !NAME_PATTERN.test(name)).length
  if (badNames > 0) {
    // not echoed: whatever is in that entry must not reach the log
    return failure(`в names.json ${badNames} записей, которые не похожи на имя переменной (буквы, цифры, _); там должны быть только имена из vercel env ls`)
  }

  /** @type {any} */
  const target = ids
  const idsOk = target && ['projectId', 'environmentId', 'serviceId'].every((key) => typeof target[key] === 'string' && /^\S+$/.test(target[key]))
  if (!idsOk) return failure('в railway-target.json должны быть projectId, environmentId и serviceId')

  const { variables, skippedEmpty, missing } = selectVariables(env, names)
  const excluded = [...new Set(names)].filter(isExcluded)
  const lists = { skippedEmpty, missing, excluded }
  const sent = Object.keys(variables)
  if (sent.length === 0) return failure('нет ни одной переменной для переноса', lists)

  const upsert = await callRailway({ fetchImpl, token: secretToken, body: buildUpsertBody(target, variables), timeoutMs })
  if ('failed' in upsert) return failure(upsert.failed, { errorCodes: upsert.errorCodes, ...lists })
  if (upsert.data?.variableCollectionUpsert !== true) return failure('Railway не подтвердил запись переменных', lists)

  // The write is done; now look at the service itself. The names come back in memory only.
  const stored = await fetchStoredNames({ fetchImpl, token: secretToken, ids: target, timeoutMs })
  if ('failed' in stored) {
    return failure(`запись выполнена, но проверить её на Railway не удалось: ${stored.failed}`, { errorCodes: stored.errorCodes, ...lists })
  }
  const absent = sent.filter((name) => !stored.names.has(name))
  const verification = { present: sent.length - absent.length, total: sent.length, absent }
  if (absent.length > 0) {
    return failure(`запись выполнена, но на Railway не нашлось ${absent.length} из ${sent.length} переменных`, { verification, ...lists })
  }
  return { ok: true, pushed: sent.length, verification, ...lists }
}

/**
 * The text of the report: all that is printed. It is built from counts, variable names and error
 * codes only, so it cannot carry a value or any text of Railway's.
 * @param {SuccessResult | FailureResult} result
 * @returns {string}
 */
export function formatReport(result) {
  /** @type {string[]} */
  const lines = []
  if (result.ok) {
    lines.push(SUCCESS_LINE, `Перенесено переменных: ${Number(result.pushed) || 0}`)
  } else {
    lines.push(`Перенос НЕ выполнен: ${oneLine(result.reason)}`)
    const codes = result.errorCodes ?? []
    if (codes.length > 0) {
      const shown = codes.slice(0, MAX_CODES).map(oneLine).join(', ')
      lines.push(`Коды ошибок Railway (${codes.length}): ${shown}${codes.length > MAX_CODES ? ', ...' : ''}`)
    }
  }
  const list = (/** @type {string} */ title, /** @type {string[] | undefined} */ names) => {
    if (names && names.length > 0) lines.push(`${title} (${names.length}): ${names.map(oneLine).join(', ')}`)
  }
  if (result.verification) {
    lines.push(`Проверено на Railway: ${Number(result.verification.present) || 0} из ${Number(result.verification.total) || 0}`)
    list('Нет на Railway', result.verification.absent)
  }
  list('Пропущено пустых', result.skippedEmpty)
  list('Нет в окружении сборки', result.missing)
  list('Не переносятся (системные и принадлежащие Railway)', result.excluded)
  return lines.join('\n')
}

function defaultReadText(/** @type {string} */ name) {
  return readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), name), 'utf8')
}

function readJson(/** @type {(name: string) => string} */ readText, /** @type {string} */ name) {
  let text
  try {
    text = readText(name)
  } catch {
    throw new InputError(`не найден файл ${name} рядом со скриптом`)
  }
  try {
    return JSON.parse(text)
  } catch {
    // the parser's own message quotes the file's content, so it is left out
    throw new InputError(`${name} не разобрать как JSON`)
  }
}

/**
 * Reads the input, pushes, prints the report and sets the exit code - 1 after a transfer, 2 after a
 * failure, never 0. The exit is `process.exitCode`, so the report is flushed before the process ends.
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   fetchImpl?: typeof fetch,
 *   readText?: (name: string) => string,
 *   log?: (text: string) => void,
 *   exit?: (code: number) => void,
 *   timeoutMs?: number,
 * }} [deps]
 * @returns {Promise<number>} the exit code
 */
export async function main(deps = {}) {
  const {
    env = process.env,
    fetchImpl = globalThis.fetch,
    readText = defaultReadText,
    log = (text) => console.log(text),
    exit = (code) => {
      process.exitCode = code
    },
    timeoutMs,
  } = deps

  /** @type {SuccessResult | FailureResult} */
  let result
  try {
    const names = readJson(readText, 'names.json')
    const ids = readJson(readText, 'railway-target.json')
    result = await syncEnv({ env, names, ids, token: env[TOKEN_NAME], fetchImpl, timeoutMs })
  } catch (error) {
    // an unexpected error: only its class is named, its message might hold anything
    result = failure(error instanceof InputError ? error.message : `непредвиденная ошибка (${describeError(error)}), текст скрыт`)
  }

  const code = result.ok ? 1 : 2
  try {
    log(formatReport(result))
  } finally {
    exit(code)
  }
  return code
}

/** Run only when started as a script, not when imported (tests). Symlinks are resolved on both sides. */
function isMainModule() {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(path.resolve(process.argv[1]))
  } catch {
    return false
  }
}

if (isMainModule()) {
  main().catch(() => {
    process.exitCode = 2
  })
}
