/**
 * scripts/railway/push-env.mjs — the one-off script that runs inside a throwaway Vercel build and
 * pushes the project's environment variables into the Railway service.
 *
 * What these tests guard, in order of how bad the failure would be:
 *   - a value (or the Railway token) reaching the build log, in the report or in an error;
 *   - a multi-line secret (a private key) arriving altered;
 *   - the build ever finishing with exit 0 (that would create a Vercel deployment);
 *   - the script silently not running at all.
 * Nothing here touches the network: `fetch` is injected, and the CLI runs stop before any request.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RAILWAY_ENDPOINT,
  buildUpsertBody,
  formatReport,
  isExcluded,
  main,
  redactValues,
  selectVariables,
  syncEnv,
} from '../../../scripts/railway/push-env.mjs'

const SCRIPT = path.resolve(__dirname, '../../../scripts/railway/push-env.mjs')
const SUCCESS_LINE = 'Перенос завершён, сборка остановлена намеренно'

const IDS = { projectId: 'proj-id', environmentId: 'env-id', serviceId: 'svc-id' }
const TOKEN = 'rw-token-5b1c0e2d-0f6a-4a52-9d8e-0c2f1b7a9e11'
// Appears inside values only. If it shows up anywhere in the output, a value leaked.
const MARKER = 'LEAK-MARKER-7f3a91c2'
const PEM = '-----BEGIN\nabc\n-----END'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('selectVariables', () => {
  it('carries a multi-line value over byte for byte', () => {
    const { variables } = selectVariables({ PRIVATE_KEY: PEM }, ['PRIVATE_KEY'])
    expect(variables.PRIVATE_KEY).toBe(PEM)
  })

  it('does not trim or otherwise change a value', () => {
    const value = '  spaced \t value\r\n'
    const { variables } = selectVariables({ A: value }, ['A'])
    expect(variables.A).toBe(value)
  })

  it('puts an empty value into skippedEmpty and does not send it', () => {
    const result = selectVariables({ EMPTY: '', FULL: 'x' }, ['EMPTY', 'FULL'])
    expect(result.skippedEmpty).toEqual(['EMPTY'])
    expect(result.variables).toEqual({ FULL: 'x' })
    expect(result.missing).toEqual([])
  })

  it('puts a name that is absent from the environment into missing', () => {
    const result = selectVariables({ HERE: 'x' }, ['HERE', 'GONE'])
    expect(result.missing).toEqual(['GONE'])
    expect(result.variables).toEqual({ HERE: 'x' })
  })

  it('leaves out Vercel, Turbo and Nx system names, and does not report them as missing', () => {
    const env = {
      VERCEL: '1',
      VERCEL_URL: 'x.vercel.app',
      TURBO_CACHE: 'remote',
      TURBO_TOKEN: 'secret',
      NX_DAEMON: 'false',
      KEEP: 'yes',
    }
    const result = selectVariables(env, ['VERCEL', 'VERCEL_URL', 'TURBO_CACHE', 'TURBO_TOKEN', 'NX_DAEMON', 'VERCEL_GONE', 'KEEP'])
    expect(result.variables).toEqual({ KEEP: 'yes' })
    expect(result.missing).toEqual([])
    expect(result.skippedEmpty).toEqual([])
  })

  it('sends only the listed names, never the rest of the build environment', () => {
    const { variables } = selectVariables({ LISTED: 'a', NOT_LISTED: 'b', PATH: '/usr/bin' }, ['LISTED'])
    expect(Object.keys(variables)).toEqual(['LISTED'])
  })

  it('counts a repeated name once', () => {
    const result = selectVariables({ A: '1' }, ['A', 'A', 'GONE', 'GONE'])
    expect(Object.keys(result.variables)).toEqual(['A'])
    expect(result.missing).toEqual(['GONE'])
  })

  it('does not mistake an inherited property for a variable', () => {
    const result = selectVariables({}, ['constructor', 'toString', '__proto__'])
    expect(Object.keys(result.variables)).toEqual([])
    expect(result.missing).toEqual(['constructor', 'toString', '__proto__'])
  })

  it('never passes on the sync token itself', () => {
    // names.json comes from `vercel env ls production`, which lists the temporary token too
    const result = selectVariables({ RAILWAY_ENV_SYNC_TOKEN: TOKEN, A: '1' }, ['RAILWAY_ENV_SYNC_TOKEN', 'A'])
    expect(result.variables).toEqual({ A: '1' })
    expect(result.missing).toEqual([])
  })

  it('does not overwrite variables that the Railway service owns', () => {
    // they are set on the service before the push and mean something different there
    const owned = ['PERSISTENT_SERVER', 'CRON_RUNNER_ENABLED', 'INTERNAL_BASE_URL', 'NEXT_MANUAL_SIG_HANDLE',
      'WORKFLOW_TARGET_WORLD', 'WORKFLOW_POSTGRES_URL', 'WORKFLOW_POSTGRES_WORKER_CONCURRENCY',
      'RAILWAY_DEPLOYMENT_DRAINING_SECONDS', 'RAILPACK_NODE_VERSION', 'PORT']
    const env = Object.fromEntries(owned.map((name) => [name, 'vercel-value']))
    const result = selectVariables({ ...env, KEEP: 'yes' }, [...owned, 'KEEP'])
    expect(result.variables).toEqual({ KEEP: 'yes' })
  })

  it('returns exactly variables, skippedEmpty and missing', () => {
    expect(Object.keys(selectVariables({}, [])).sort()).toEqual(['missing', 'skippedEmpty', 'variables'])
  })
})

describe('isExcluded', () => {
  it('matches the system prefixes and the names Railway owns, and nothing else', () => {
    for (const name of ['VERCEL', 'VERCEL_ENV', 'TURBO_TEAM', 'NX_DAEMON', 'RAILWAY_ENV_SYNC_TOKEN', 'PORT']) {
      expect(isExcluded(name)).toBe(true)
    }
    for (const name of ['DATABASE_URL', 'NEXT_PUBLIC_APP_URL', 'MY_VERCEL_THING', 'TURBO', 'PORTAL_SECRET']) {
      expect(isExcluded(name)).toBe(false)
    }
  })
})

describe('buildUpsertBody', () => {
  const variables = { A: '1', PRIVATE_KEY: PEM, TOKEN: MARKER }
  const body = buildUpsertBody(IDS, variables)

  it('is the variableCollectionUpsert mutation with replace: false and skipDeploys: true', () => {
    expect(body.query).toContain('variableCollectionUpsert')
    expect(body.query).toMatch(/^\s*mutation\b/)
    expect(body.variables).toEqual({
      input: { ...IDS, variables, replace: false, skipDeploys: true },
    })
    // the serialized request carries both flags literally
    const wire = JSON.stringify(body)
    expect(wire).toContain('"replace":false')
    expect(wire).toContain('"skipDeploys":true')
  })

  it('keeps values out of the query text and out of the way of GraphQL escaping', () => {
    expect(body.query).not.toContain(MARKER)
    expect(body.query).not.toContain('BEGIN')
  })

  it('survives JSON serialization with the multi-line value unchanged', () => {
    const parsed = JSON.parse(JSON.stringify(body))
    expect(parsed.variables.input.variables.PRIVATE_KEY).toBe(PEM)
  })
})

describe('redactValues', () => {
  it('removes a value in the raw, JSON-escaped and \\u-escaped forms', () => {
    const value = 'пароль-LEAK\nвторая "строка"'
    const raw = `echo: ${value}`
    const jsonForm = `echo: ${JSON.stringify(value).slice(1, -1)}`
    const asciiForm = `echo: ${JSON.stringify(value).slice(1, -1).replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}`
    for (const text of [raw, jsonForm, asciiForm]) {
      const out = redactValues(text, [value])
      expect(out).not.toContain('LEAK')
      expect(out).toContain('[скрыто]')
    }
  })

  it('removes the longer of two overlapping values first, so no tail of it is left', () => {
    const out = redactValues('seen: abcd-efgh-ijkl', ['abcd', 'abcd-efgh-ijkl'])
    expect(out).not.toContain('efgh')
    expect(out).not.toContain('ijkl')
  })

  it('leaves values shorter than four characters alone (flags and ports are no secrets)', () => {
    expect(redactValues('status 401 on 1', ['1', '0'])).toBe('status 401 on 1')
  })
})

describe('formatReport', () => {
  function success() {
    const env = {
      DATABASE_URL: `postgresql://u:${MARKER}@host/db`,
      PRIVATE_KEY: `-----BEGIN\n${MARKER}\n-----END`,
      EMPTY_ONE: '',
    }
    const selected = selectVariables(env, ['DATABASE_URL', 'PRIVATE_KEY', 'EMPTY_ONE', 'NOT_SET'])
    return {
      ok: true as const,
      pushed: Object.keys(selected.variables).length,
      skippedEmpty: selected.skippedEmpty,
      missing: selected.missing,
      excluded: ['VERCEL_URL'],
    }
  }

  it('on success: the stop line, the count, the empty names and the missing names', () => {
    const text = formatReport(success())
    expect(text).toContain(SUCCESS_LINE)
    expect(text).toMatch(/Перенесено переменных: 2\b/)
    expect(text).toContain('EMPTY_ONE')
    expect(text).toContain('NOT_SET')
    expect(text).toContain('VERCEL_URL')
  })

  it('contains no value - checked with a marker placed inside the values', () => {
    const text = formatReport(success())
    expect(text).not.toContain(MARKER)
    expect(text).not.toContain('BEGIN')
    expect(text).not.toContain('postgresql://')
  })

  it('on failure: says so, never claims the transfer finished, still lists the names', () => {
    const text = formatReport({
      ok: false,
      reason: 'Railway вернул ошибки (1)',
      messages: ['Not Authorized'],
      skippedEmpty: ['EMPTY_ONE'],
      missing: ['NOT_SET'],
      excluded: [],
    })
    expect(text).toMatch(/не выполнен/i)
    expect(text).not.toContain('Перенос завершён')
    expect(text).toContain('Not Authorized')
    expect(text).toContain('EMPTY_ONE')
    expect(text).toContain('NOT_SET')
  })

  it('keeps each Railway message to one short line, so it cannot pass for the success line', () => {
    const long = `line one\n${SUCCESS_LINE}\n${'x'.repeat(2000)}`
    const text = formatReport({ ok: false, reason: 'r', messages: [long] })
    expect(text.split('\n').some((line) => line.startsWith(SUCCESS_LINE))).toBe(false)
    expect(text.split('\n').every((line) => line.length < 400)).toBe(true)
  })

  it('prints nothing for an empty list', () => {
    const text = formatReport({ ok: true, pushed: 1, skippedEmpty: [], missing: [], excluded: [] })
    expect(text).not.toMatch(/пустых|Нет в окружении|Не переносятся/)
  })
})

// --- the run itself, with fetch injected ---------------------------------------------------------

const NAMES = ['DATABASE_URL', 'PRIVATE_KEY', 'EMPTY_ONE', 'NOT_SET', 'VERCEL_URL', 'RAILWAY_ENV_SYNC_TOKEN']
const BUILD_ENV = {
  DATABASE_URL: `postgresql://u:${MARKER}@host/db`,
  PRIVATE_KEY: `-----BEGIN\n${MARKER}\n-----END`,
  EMPTY_ONE: '',
  VERCEL_URL: 'x.vercel.app',
  RAILWAY_ENV_SYNC_TOKEN: TOKEN,
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function files(overrides: Record<string, string | undefined> = {}) {
  const all: Record<string, string | undefined> = {
    'names.json': JSON.stringify(NAMES),
    'railway-target.json': JSON.stringify(IDS),
    ...overrides,
  }
  return (name: string) => {
    const content = all[name]
    if (content === undefined) throw Object.assign(new Error(`ENOENT ${name}`), { code: 'ENOENT' })
    return content
  }
}

function run(opts: {
  env?: Record<string, string | undefined>
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>
  readText?: (name: string) => string
  timeoutMs?: number
}) {
  const log = vi.fn()
  const exit = vi.fn()
  const fetchImpl = vi.fn(opts.fetchImpl ?? (async () => jsonResponse({ data: { variableCollectionUpsert: true } })))
  const done = main({
    env: opts.env ?? BUILD_ENV,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    readText: opts.readText ?? files(),
    log,
    exit,
    timeoutMs: opts.timeoutMs,
  })
  const output = () => log.mock.calls.map((call) => call.join(' ')).join('\n')
  return { done, log, exit, fetchImpl, output }
}

describe('main - success', () => {
  it('posts one request to Railway with the project token and the full mutation', async () => {
    const { done, fetchImpl } = run({})
    await done
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://backboard.railway.com/graphql/v2')
    expect(url).toBe(RAILWAY_ENDPOINT)
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['Project-Access-Token']).toBe(TOKEN)
    expect(headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(init.body as string)
    expect(body.query).toContain('variableCollectionUpsert')
    expect(body.variables.input).toMatchObject({ ...IDS, replace: false, skipDeploys: true })
    // exactly the two non-empty, non-system variables; the multi-line key arrives unchanged
    expect(body.variables.input.variables).toEqual({
      DATABASE_URL: BUILD_ENV.DATABASE_URL,
      PRIVATE_KEY: BUILD_ENV.PRIVATE_KEY,
    })
  })

  it('does not send the token to Railway as a variable', async () => {
    const { done, fetchImpl } = run({})
    await done
    const init = fetchImpl.mock.calls[0][1] as RequestInit
    expect(JSON.parse(init.body as string).variables.input.variables).not.toHaveProperty('RAILWAY_ENV_SYNC_TOKEN')
  })

  it('exits 1 - never 0 - with the stop line, so no Vercel deployment is created', async () => {
    const { done, exit, log } = run({})
    await done
    expect(exit).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(1)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toContain(SUCCESS_LINE)
  })

  it('prints the count and the names of the empty and missing ones, and no value or token', async () => {
    const { done, output } = run({})
    await done
    const text = output()
    expect(text).toMatch(/Перенесено переменных: 2\b/)
    expect(text).toContain('EMPTY_ONE')
    expect(text).toContain('NOT_SET')
    expect(text).not.toContain(MARKER)
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain('BEGIN')
  })

  it('writes nothing through console on its own', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => {}))
    const { done } = run({})
    await done
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })
})

describe('main - failure', () => {
  it('a GraphQL error that echoes the input does not leak the values: raw, JSON or \\u-escaped', async () => {
    const value = BUILD_ENV.PRIVATE_KEY
    const echoes = [
      `Variable "$input" got invalid value ${JSON.stringify(BUILD_ENV)}`,
      `bad value ${value}`,
      `bad value ${JSON.stringify(value)}`,
      `bad value ${JSON.stringify(value).replace(/[A-Z]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}`,
      `bad url ${BUILD_ENV.DATABASE_URL} and token ${TOKEN}`,
    ]
    const { done, exit, output } = run({
      fetchImpl: async () => jsonResponse({ errors: echoes.map((message) => ({ message })), data: null }),
    })
    await done
    expect(exit).toHaveBeenCalledWith(2)
    const text = output()
    expect(text).not.toContain(MARKER)
    expect(text).not.toContain('LEAK-MARKER')
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain('postgresql://')
    expect(text).toMatch(/не выполнен/i)
    expect(text).not.toContain('Перенос завершён')
    expect(text).toContain('[скрыто]')
  })

  it('reports an error message that echoes nothing, so a real problem can be diagnosed', async () => {
    const { done, output } = run({
      fetchImpl: async () => jsonResponse({ errors: [{ message: 'Not Authorized' }] }),
    })
    await done
    expect(output()).toContain('Not Authorized')
  })

  it('GraphQL errors next to data are still a failure', async () => {
    const { done, exit } = run({
      fetchImpl: async () => jsonResponse({ data: { variableCollectionUpsert: true }, errors: [{ message: 'partial' }] }),
    })
    await done
    expect(exit).toHaveBeenCalledWith(2)
  })

  it('an answer that is not an explicit true is a failure', async () => {
    const { done, exit, output } = run({ fetchImpl: async () => jsonResponse({ data: { variableCollectionUpsert: false } }) })
    await done
    expect(exit).toHaveBeenCalledWith(2)
    expect(output()).not.toContain('Перенос завершён')
  })

  it('an HTTP error reports the status and never the body, which might echo the request', async () => {
    const { done, exit, output } = run({
      fetchImpl: async () => new Response(`<html>${BUILD_ENV.PRIVATE_KEY} ${TOKEN}</html>`, { status: 502 }),
    })
    await done
    expect(exit).toHaveBeenCalledWith(2)
    const text = output()
    expect(text).toContain('502')
    expect(text).not.toContain(MARKER)
    expect(text).not.toContain(TOKEN)
  })

  it('a network error reports only its kind, not a message that may carry the token or a value', async () => {
    const { done, exit, output } = run({
      fetchImpl: async () => {
        throw Object.assign(new TypeError(`fetch failed for ${TOKEN} ${BUILD_ENV.DATABASE_URL}`), { cause: { code: 'ECONNRESET' } })
      },
    })
    await done
    expect(exit).toHaveBeenCalledWith(2)
    const text = output()
    expect(text).toContain('ECONNRESET')
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain(MARKER)
  })

  it('a request that does not finish in time is a failure, not a hang', async () => {
    const { done, exit, output } = run({
      timeoutMs: 20,
      // a fetch that only ever ends when its signal fires, as a stuck connection would
      fetchImpl: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    })
    await done
    expect(exit).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(2)
    expect(output()).toContain('TimeoutError')
  })

  it.each([
    ['no token', { ...BUILD_ENV, RAILWAY_ENV_SYNC_TOKEN: undefined }, files()],
    ['an empty token', { ...BUILD_ENV, RAILWAY_ENV_SYNC_TOKEN: '  ' }, files()],
    ['no names.json', BUILD_ENV, files({ 'names.json': undefined })],
    ['no railway-target.json', BUILD_ENV, files({ 'railway-target.json': undefined })],
    ['names.json that is not JSON', BUILD_ENV, files({ 'names.json': `{ ${MARKER}` })],
    ['names.json that is not a list', BUILD_ENV, files({ 'names.json': '{"A":"1"}' })],
    ['a name that is not a variable name', BUILD_ENV, files({ 'names.json': JSON.stringify(['OK', `postgresql://u:${MARKER}@h/db`]) })],
    ['a target without serviceId', BUILD_ENV, files({ 'railway-target.json': JSON.stringify({ projectId: 'p', environmentId: 'e' }) })],
    ['nothing left to send', { RAILWAY_ENV_SYNC_TOKEN: TOKEN }, files({ 'names.json': '["VERCEL_URL","NOT_SET"]' })],
  ])('stops with exit 2 before any request on %s, and prints no value', async (_label, env, readText) => {
    const { done, exit, fetchImpl, output } = run({ env, readText })
    await done
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(exit).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(2)
    const text = output()
    expect(text).not.toContain(MARKER)
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain('Перенос завершён')
  })

  it('an unexpected error in the run still ends with exit 2, and its message is not printed', async () => {
    // reading the token throws; the message carries a value, as an unexpected error's message might
    const env = new Proxy({} as Record<string, string | undefined>, {
      get() {
        throw new Error(`boom ${MARKER}`)
      },
    })
    const { done, exit, output } = run({ env })
    await done
    expect(exit).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(2)
    expect(output()).toContain('непредвиденная ошибка')
    expect(output()).not.toContain(MARKER)
  })

  it('a file reader that throws a message with a value does not put the message into the output', async () => {
    const { done, exit, output } = run({
      readText: () => {
        throw new Error(`boom ${MARKER}`)
      },
    })
    await done
    expect(exit).toHaveBeenCalledWith(2)
    expect(output()).not.toContain(MARKER)
  })
})

describe('syncEnv', () => {
  it('reports the system names it left out, as names', async () => {
    const result = await syncEnv({
      env: BUILD_ENV,
      names: NAMES,
      ids: IDS,
      token: TOKEN,
      fetchImpl: (async () => jsonResponse({ data: { variableCollectionUpsert: true } })) as unknown as typeof fetch,
    })
    expect(result).toMatchObject({ ok: true, pushed: 2, skippedEmpty: ['EMPTY_ONE'], missing: ['NOT_SET'] })
    expect(result.excluded).toEqual(['VERCEL_URL', 'RAILWAY_ENV_SYNC_TOKEN'])
  })
})

// --- as a script ---------------------------------------------------------------------------------

describe('running as a script', () => {
  const dirs: string[] = []
  function tmp() {
    const dir = mkdtempSync(path.join(tmpdir(), 'push-env-'))
    dirs.push(dir)
    return dir
  }
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })
  // a bare environment on purpose: no token, so nothing can reach the network
  const bare: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? '', NODE_ENV: 'test' }
  const exec = (file: string, cwd?: string) => {
    const result = spawnSync(process.execPath, [file], { env: bare, cwd, encoding: 'utf8', timeout: 30_000 })
    return { status: result.status, out: `${result.stdout}${result.stderr}` }
  }

  it('does nothing when it is only imported', async () => {
    vi.resetModules()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const previous = process.exitCode
    await import('../../../scripts/railway/push-env.mjs')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(previous)
  })

  it('runs main and fails with exit 2 when started as a script without its files', () => {
    const { status, out } = exec(SCRIPT, tmpdir())
    expect(status).toBe(2)
    expect(out).toMatch(/не выполнен/i)
    expect(out).not.toContain('Перенос завершён')
  })

  it('still runs when started through a symlink (a skipped run would exit 0 and create a deployment)', () => {
    const dir = tmp()
    const link = path.join(dir, 'link-to-push-env.mjs')
    symlinkSync(SCRIPT, link)
    const { status } = exec(link)
    expect(status).toBe(2)
  })

  it('reads names.json and railway-target.json from its own folder and names the missing token', () => {
    const dir = tmp()
    copyFileSync(SCRIPT, path.join(dir, 'push-env.mjs'))
    writeFileSync(path.join(dir, 'names.json'), JSON.stringify(['A', 'B']))
    writeFileSync(path.join(dir, 'railway-target.json'), JSON.stringify(IDS))
    // started from another folder, the way `node push-env.mjs` is not: the files must still be found
    const { status, out } = exec(path.join(dir, 'push-env.mjs'), tmpdir())
    expect(status).toBe(2)
    expect(out).toContain('RAILWAY_ENV_SYNC_TOKEN')
  })
})
