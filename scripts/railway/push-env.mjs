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
 * What the output may contain: counts and variable NAMES, nothing else. In particular never a value,
 * never the token and never a response body. Railway's error messages are the one text we do not
 * write ourselves and GraphQL errors can echo the request, so they are scrubbed of every value
 * (and of the token) before they reach the report; an HTTP error or a network error reports its
 * status or kind only.
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

/** What a name in names.json may look like. A value pasted there by mistake rarely does, and is never echoed. */
const NAME_PATTERN = /^[A-Za-z0-9_]{1,256}$/
const REDACTED = '[скрыто]'
/** Shorter values (flags like 0 and 1, ports) are no secrets, and redacting them would shred the message. */
const MIN_REDACT_LENGTH = 4
const MAX_MESSAGES = 5
const MAX_LINE_LENGTH = 200
const REQUEST_TIMEOUT_MS = 60_000

const MUTATION = `mutation variableCollectionUpsert($input: VariableCollectionUpsertInput!) {
  variableCollectionUpsert(input: $input)
}`

/**
 * @typedef {{ projectId: string, environmentId: string, serviceId: string }} RailwayIds
 * @typedef {{ ok: true, pushed: number, skippedEmpty?: string[], missing?: string[], excluded?: string[] }} SuccessResult
 * @typedef {{ ok: false, reason: string, messages?: string[], skippedEmpty?: string[], missing?: string[], excluded?: string[] }} FailureResult
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

/** @type {Record<string, string>} */
const SIMPLE_ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }

/** Undo JSON string escapes (\n, \", \\, \uXXXX) as they stand in a text that quotes a JSON document. */
function decodeJsonEscapes(/** @type {string} */ text) {
  return text.replace(/\\(?:u([0-9a-fA-F]{4})|(["\\/bfnrt]))/g, (_match, /** @type {string | undefined} */ hex, /** @type {string} */ simple) =>
    hex ? String.fromCharCode(parseInt(hex, 16)) : SIMPLE_ESCAPES[simple],
  )
}

/**
 * Replaces every value (and its JSON-escaped form) found in `text` by «[скрыто]». An error that
 * quotes the request may show a value as it is, as a JSON string (\n for a newline) or with \uXXXX
 * escapes; the text is therefore also decoded and checked again, up to three layers deep.
 * Longer values go first, so a value that contains a shorter one does not leave its tail behind.
 * @param {string} text
 * @param {string[]} values
 * @returns {string}
 */
export function redactValues(text, values, depth = 0) {
  const secrets = [...new Set(values)].filter((value) => typeof value === 'string' && value.length >= MIN_REDACT_LENGTH)
  secrets.sort((a, b) => b.length - a.length)
  let out = String(text)
  for (const secret of secrets) {
    for (const form of new Set([secret, JSON.stringify(secret).slice(1, -1)])) {
      out = out.split(form).join(REDACTED)
    }
  }
  const decoded = decodeJsonEscapes(out)
  return decoded !== out && depth < 3 ? redactValues(decoded, secrets, depth + 1) : out
}

const oneLine = (/** @type {unknown} */ text) => String(text).replace(/\s+/g, ' ').trim().slice(0, MAX_LINE_LENGTH)

/** A text from outside (Railway), scrubbed of values and the token, on one line, short. */
function cleanMessage(/** @type {unknown} */ text, /** @type {string[]} */ secrets) {
  return typeof text === 'string' ? oneLine(redactValues(text, secrets)) : ''
}

/** What went wrong with a request, by kind only. A network error's own message is never used. */
function describeError(/** @type {any} */ error, /** @type {string[]} */ secrets) {
  const kind = [error?.name, error?.cause?.code ?? error?.code].filter((part) => typeof part === 'string' && part)
  return cleanMessage(kind.join(' ') || 'неизвестная ошибка', secrets)
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
 * Pushes the chosen variables to Railway. Returns a result for `formatReport`; never throws for a
 * problem with the input or the request.
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
    // not echoed: a value pasted into names.json by mistake must not reach the log
    return failure(`в names.json ${badNames} записей, которые не похожи на имя переменной (буквы, цифры, _) - значений там быть не должно`)
  }

  /** @type {any} */
  const target = ids
  const idsOk = target && ['projectId', 'environmentId', 'serviceId'].every((key) => typeof target[key] === 'string' && /^\S+$/.test(target[key]))
  if (!idsOk) return failure('в railway-target.json должны быть projectId, environmentId и serviceId')

  const { variables, skippedEmpty, missing } = selectVariables(env, names)
  const excluded = [...new Set(names)].filter(isExcluded)
  const lists = { skippedEmpty, missing, excluded }
  if (Object.keys(variables).length === 0) return failure('нет ни одной переменной для переноса', lists)

  const secrets = [...Object.values(variables), secretToken]
  /** @type {Response} */
  let response
  try {
    response = await fetchImpl(RAILWAY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Project-Access-Token': secretToken },
      body: JSON.stringify(buildUpsertBody(target, variables)),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    return failure(`запрос к Railway не выполнен (${describeError(error, secrets)})`, lists)
  }

  /** @type {any} */
  let payload = null
  try {
    payload = JSON.parse(await response.text())
  } catch {
    // not JSON (a proxy's page, say): the status alone is reported
  }
  const errors = Array.isArray(payload?.errors) ? payload.errors : []
  const messages = errors
    .map((/** @type {any} */ error) => cleanMessage(error?.message, secrets))
    .filter(Boolean)
    .slice(0, MAX_MESSAGES)

  if (!response.ok) return failure(`Railway ответил HTTP ${Number(response.status)}`, { messages, ...lists })
  if (errors.length > 0) return failure(`Railway вернул ошибки (${errors.length})`, { messages, ...lists })
  if (payload?.data?.variableCollectionUpsert !== true) return failure('Railway не подтвердил запись переменных', lists)

  return { ok: true, pushed: Object.keys(variables).length, ...lists }
}

/**
 * The text of the report: all that is printed. It is built from counts and names only, so it cannot
 * carry a value; a Railway message in a failure was scrubbed by `syncEnv` and is cut to one short line.
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
    for (const message of (result.messages ?? []).slice(0, MAX_MESSAGES)) lines.push(`  Railway: ${oneLine(message)}`)
  }
  const list = (/** @type {string} */ title, /** @type {string[] | undefined} */ names) => {
    if (names && names.length > 0) lines.push(`${title} (${names.length}): ${names.map(oneLine).join(', ')}`)
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
    result = failure(error instanceof InputError ? error.message : `непредвиденная ошибка (${describeError(error, [])}), текст скрыт`)
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
