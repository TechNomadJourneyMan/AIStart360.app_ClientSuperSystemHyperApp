/**
 * scripts/railway/push-env.mjs — the one-off script that runs inside a throwaway Vercel build and
 * pushes the project's environment variables into the Railway service.
 *
 * What these tests guard, in order of how bad the failure would be:
 *   - a value (or the Railway token) reaching the build log, in the report or in an error - including
 *     the values Railway sends back when the script checks the write, and any free text of Railway's;
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
  buildVariablesQueryBody,
  formatReport,
  isExcluded,
  main,
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

describe('buildVariablesQueryBody', () => {
  const body = buildVariablesQueryBody(IDS)

  it('is the documented variables query for the service, with the ids as GraphQL variables', () => {
    expect(body.query).toMatch(/^\s*query variables\b/)
    expect(body.query).toContain('variables(')
    expect(body.variables).toMatchObject(IDS)
  })

  it('asks for the stored form, so a reference is not resolved on the way', () => {
    expect(body.variables.unrendered).toBe(true)
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

  it('on failure: says so, never claims the transfer finished, lists the codes and the names', () => {
    const text = formatReport({
      ok: false,
      reason: 'Railway вернул ошибки (2)',
      errorCodes: ['UNAUTHENTICATED', 'без кода'],
      skippedEmpty: ['EMPTY_ONE'],
      missing: ['NOT_SET'],
      excluded: [],
    })
    expect(text).toMatch(/не выполнен/i)
    expect(text).not.toContain('Перенос завершён')
    expect(text).toContain('Коды ошибок Railway (2): UNAUTHENTICATED, без кода')
    expect(text).toContain('EMPTY_ONE')
    expect(text).toContain('NOT_SET')
  })

  it('prints no code line when there are no codes', () => {
    expect(formatReport({ ok: false, reason: 'r', errorCodes: [] })).not.toContain('Коды ошибок')
  })

  it('keeps every line short, so a long reason or code cannot pass for the success line', () => {
    const long = `line one\n${SUCCESS_LINE}\n${'x'.repeat(2000)}`
    const text = formatReport({ ok: false, reason: long, errorCodes: [long] })
    expect(text.split('\n').some((line) => line.startsWith(SUCCESS_LINE))).toBe(false)
    expect(text.split('\n').every((line) => line.length < 400)).toBe(true)
  })

  it('prints how many of the names are on Railway, and which are not', () => {
    const ok = formatReport({ ok: true, pushed: 3, verification: { present: 3, total: 3, absent: [] } })
    expect(ok).toContain('Проверено на Railway: 3 из 3')
    expect(ok).not.toContain('Нет на Railway')
    const bad = formatReport({ ok: false, reason: 'r', verification: { present: 1, total: 3, absent: ['A', 'B'] } })
    expect(bad).toContain('Проверено на Railway: 1 из 3')
    expect(bad).toContain('Нет на Railway (2): A, B')
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

type GraphQLCall = { query: string; variables: Record<string, any> }

/**
 * A fake Railway. The first call of a run is the upsert (a mutation), the second the check that lists
 * the service's variables. The listing carries VALUES, as the real one does - the sent ones and one
 * that only exists on Railway - so any test that reads the output also proves they are not printed.
 */
function railway(
  routes: {
    upsert?: (call: GraphQLCall) => Response | Promise<Response>
    variables?: (call: GraphQLCall, sent: Record<string, string>) => Response | Promise<Response>
  } = {},
) {
  let sent: Record<string, string> = {}
  return async (_url: string, init: RequestInit) => {
    const call = JSON.parse(init.body as string) as GraphQLCall
    if (call.query.trimStart().startsWith('mutation')) {
      sent = call.variables.input.variables
      return routes.upsert ? routes.upsert(call) : jsonResponse({ data: { variableCollectionUpsert: true } })
    }
    if (routes.variables) return routes.variables(call, sent)
    return jsonResponse({ data: { variables: { ...sent, PERSISTENT_SERVER: '1', RAILWAY_ONLY: `${MARKER}-railway-only` } } })
  }
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
  const fetchImpl = vi.fn(opts.fetchImpl ?? railway())
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
  it('posts the upsert to Railway with the project token and the full mutation', async () => {
    const { done, fetchImpl } = run({})
    await done
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

  it('then checks the write with a second request: the variables query, same token, same ids', async () => {
    const { done, fetchImpl } = run({})
    await done
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const [url, init] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit]
    expect(url).toBe(RAILWAY_ENDPOINT)
    expect((init.headers as Record<string, string>)['Project-Access-Token']).toBe(TOKEN)
    const body = JSON.parse(init.body as string)
    expect(body.query).toMatch(/^\s*query variables\b/)
    expect(body.variables).toMatchObject(IDS)
    // the check sends no value
    expect(init.body as string).not.toContain(MARKER)
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

  it('prints the counts and the names, and no value, token or fetched variable', async () => {
    const { done, output } = run({})
    await done
    const text = output()
    expect(text).toMatch(/Перенесено переменных: 2\b/)
    expect(text).toContain('Проверено на Railway: 2 из 2')
    expect(text).not.toContain('Нет на Railway')
    expect(text).toContain('EMPTY_ONE')
    expect(text).toContain('NOT_SET')
    // the listing held PERSISTENT_SERVER and RAILWAY_ONLY, which were not sent: not even their names
    expect(text).not.toContain('PERSISTENT_SERVER')
    expect(text).not.toContain('RAILWAY_ONLY')
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

describe('main - checking the write on Railway', () => {
  it('finds every name sent: the missing list is empty', async () => {
    const result = await syncEnv({
      env: BUILD_ENV, names: NAMES, ids: IDS, token: TOKEN,
      fetchImpl: railway() as unknown as typeof fetch,
    })
    expect(result.ok).toBe(true)
    expect(result.verification).toEqual({ present: 2, total: 2, absent: [] })
  })

  it('lists the name that is not on Railway, fails with exit 2 and does not claim success', async () => {
    const { done, exit, output } = run({
      fetchImpl: railway({
        variables: (_call, sent) => {
          const { PRIVATE_KEY: _gone, ...rest } = sent
          return jsonResponse({ data: { variables: { ...rest, RAILWAY_ONLY: `${MARKER}-railway-only` } } })
        },
      }),
    })
    await done
    expect(exit).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(2)
    const text = output()
    expect(text).toContain('Нет на Railway (1): PRIVATE_KEY')
    expect(text).toContain('Проверено на Railway: 1 из 2')
    expect(text).not.toContain('Перенос завершён')
    expect(text).not.toContain('RAILWAY_ONLY')
    expect(text).not.toContain(MARKER)
  })

  it('a name counts as present only by its exact spelling', async () => {
    const result = await syncEnv({
      env: BUILD_ENV, names: NAMES, ids: IDS, token: TOKEN,
      fetchImpl: railway({
        variables: (_call, sent) => jsonResponse({ data: { variables: Object.fromEntries(Object.keys(sent).map((name) => [name.toLowerCase(), 'x'])) } }),
      }) as unknown as typeof fetch,
    })
    expect(result.ok).toBe(false)
    expect(result.verification?.absent).toEqual(['DATABASE_URL', 'PRIVATE_KEY'])
  })

  it('keeps nothing of the fetched listing in the result: no value, no name that was not sent', async () => {
    const result = await syncEnv({
      env: BUILD_ENV, names: NAMES, ids: IDS, token: TOKEN,
      fetchImpl: railway() as unknown as typeof fetch,
    })
    const dump = JSON.stringify(result)
    expect(dump).not.toContain(MARKER)
    expect(dump).not.toContain('RAILWAY_ONLY')
    expect(dump).not.toContain('PERSISTENT_SERVER')
  })

  it.each([
    ['an HTTP error whose JSON body echoes values', () => jsonResponse({ errors: [{ message: `echo ${BUILD_ENV.PRIVATE_KEY}`, extensions: { code: 'INTERNAL_SERVER_ERROR' } }] }, 500), 'HTTP 500'],
    ['an HTTP error with a body that is not JSON', () => new Response(`<html>${BUILD_ENV.PRIVATE_KEY} ${TOKEN}</html>`, { status: 502 }), 'HTTP 502'],
    ['GraphQL errors', () => jsonResponse({ errors: [{ message: `echo ${BUILD_ENV.DATABASE_URL}`, extensions: { code: 'NOT_AUTHORIZED' } }], data: null }), 'NOT_AUTHORIZED'],
    ['an answer without the variables object', () => jsonResponse({ data: {} }), 'без списка переменных'],
    ['an answer whose variables is null', () => jsonResponse({ data: { variables: null } }), 'без списка переменных'],
    ['an answer whose variables is a list', () => jsonResponse({ data: { variables: [MARKER] } }), 'без списка переменных'],
  ])('a failing check - %s - is exit 2, says the write was done, and prints nothing from the answer', async (_label, answer, expected) => {
    const { done, exit, output, fetchImpl } = run({ fetchImpl: railway({ variables: answer }) })
    await done
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(exit).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(2)
    const text = output()
    expect(text).toContain('запись выполнена, но проверить её на Railway не удалось')
    expect(text).toContain(expected)
    expect(text).not.toContain('Перенос завершён')
    expect(text).not.toContain(MARKER)
    expect(text).not.toContain('LEAK')
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain('echo')
  })

  it('a check that throws at the network level reports only the kind of error', async () => {
    const { done, exit, output } = run({
      fetchImpl: railway({
        variables: () => {
          throw Object.assign(new TypeError(`fetch failed ${TOKEN} ${BUILD_ENV.DATABASE_URL}`), { cause: { code: 'ECONNRESET' } })
        },
      }),
    })
    await done
    expect(exit).toHaveBeenCalledWith(2)
    const text = output()
    expect(text).toContain('ECONNRESET')
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain(MARKER)
  })
})

describe('main - failure', () => {
  it('prints no message of Railway\'s at all: nothing an error echoes - whole, cut, or re-wrapped - reaches the log', async () => {
    const pem = BUILD_ENV.PRIVATE_KEY
    const echoes = [
      `Variable "$input" got invalid value ${JSON.stringify(BUILD_ENV)}`,
      `bad value ${pem}`,
      `bad value ${JSON.stringify(pem)}`,
      // whitespace-normalised: the PEM's newlines became spaces, which no exact match would catch
      `bad value ${pem.replace(/\s+/g, ' ')}`,
      `cut after the first characters: ${BUILD_ENV.DATABASE_URL.slice(0, 24)}`,
      `bad url ${BUILD_ENV.DATABASE_URL} and token ${TOKEN}`,
    ]
    const { done, exit, output, fetchImpl } = run({
      fetchImpl: railway({
        upsert: () => jsonResponse({ errors: echoes.map((message) => ({ message, extensions: { code: 'BAD_USER_INPUT' } })), data: null }),
      }),
    })
    await done
    expect(exit).toHaveBeenCalledWith(2)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const text = output()
    for (const fragment of [MARKER, 'LEAK', TOKEN, 'postgresql', 'BEGIN', 'invalid value', 'bad value', 'bad url', 'cut after']) {
      expect(text).not.toContain(fragment)
    }
    expect(text).toMatch(/не выполнен/i)
    expect(text).not.toContain('Перенос завершён')
    // what is printed: the number of errors and each code
    expect(text).toContain('Railway вернул ошибки (6)')
    expect(text).toContain('Коды ошибок Railway (6): BAD_USER_INPUT, BAD_USER_INPUT')
  })

  it('prints the error codes, which are the diagnosis', async () => {
    const { done, output } = run({
      fetchImpl: railway({
        upsert: () => jsonResponse({ errors: [{ message: 'Not Authorized', extensions: { code: 'UNAUTHENTICATED' } }] }),
      }),
    })
    await done
    const text = output()
    expect(text).toContain('UNAUTHENTICATED')
    expect(text).not.toContain('Not Authorized')
  })

  it('an error without a usable code is «без кода»: a code that is free text is not trusted either', async () => {
    const { done, output } = run({
      fetchImpl: railway({
        upsert: () =>
          jsonResponse({
            errors: [
              { message: 'no extensions at all' },
              { message: 'm', extensions: {} },
              { message: 'm', extensions: { code: `bad value ${BUILD_ENV.PRIVATE_KEY}` } },
              { message: 'm', extensions: { code: 42 } },
            ],
          }),
      }),
    })
    await done
    const text = output()
    expect(text).toContain('Коды ошибок Railway (4): без кода, без кода, без кода, без кода')
    expect(text).not.toContain('no extensions')
    expect(text).not.toContain('LEAK')
    expect(text).not.toContain('BEGIN')
  })

  it('an HTTP error with a JSON body reports the status and the codes, not the messages', async () => {
    const { done, exit, output } = run({
      fetchImpl: railway({
        upsert: () => jsonResponse({ errors: [{ message: `denied for ${BUILD_ENV.PRIVATE_KEY}`, extensions: { code: 'UNAUTHENTICATED' } }] }, 401),
      }),
    })
    await done
    expect(exit).toHaveBeenCalledWith(2)
    const text = output()
    expect(text).toContain('HTTP 401')
    expect(text).toContain('UNAUTHENTICATED')
    expect(text).not.toContain('denied')
    expect(text).not.toContain(MARKER)
  })

  it('a very long list of errors is cut to a screenful of codes, with the true count', async () => {
    const { done, output } = run({
      fetchImpl: railway({ upsert: () => jsonResponse({ errors: Array.from({ length: 500 }, () => ({ message: 'm', extensions: { code: 'E' } })) }) }),
    })
    await done
    const text = output()
    expect(text).toContain('Railway вернул ошибки (500)')
    expect(text).toContain('Коды ошибок Railway (500):')
    expect(text.split('\n').every((line) => line.length < 400)).toBe(true)
  })

  it('GraphQL errors next to data are still a failure', async () => {
    const { done, exit, fetchImpl } = run({
      fetchImpl: async () => jsonResponse({ data: { variableCollectionUpsert: true }, errors: [{ message: 'partial', extensions: { code: 'PARTIAL' } }] }),
    })
    await done
    expect(exit).toHaveBeenCalledWith(2)
    expect(fetchImpl).toHaveBeenCalledTimes(1) // no check after a write that Railway reported as failed
  })

  it('an answer that is not an explicit true is a failure', async () => {
    const { done, exit, output, fetchImpl } = run({ fetchImpl: async () => jsonResponse({ data: { variableCollectionUpsert: false } }) })
    await done
    expect(exit).toHaveBeenCalledWith(2)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
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
      fetchImpl: railway() as unknown as typeof fetch,
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
