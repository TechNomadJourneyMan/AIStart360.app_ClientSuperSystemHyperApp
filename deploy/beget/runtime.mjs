import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { spawn } from 'node:child_process'

const root = '/var/www/aistart360'
const env = { ...process.env, ...parseEnv(readFileSync(`${root}/shared/.env.production`, 'utf8')) }
const required = ['DATABASE_URL', 'DIRECT_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXTAUTH_SECRET', 'GIGA_ADMIN_PASSWORD']
const missing = required.filter(k => !env[k]?.trim() || env[k] === '[SENSITIVE]')
if (missing.length) throw new Error(`Missing configuration: ${missing.join(', ')}`)
delete env.VERCEL
delete env.VERCEL_ENV
delete env.VERCEL_OIDC_TOKEN
Object.assign(env, {
  NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
  WORKFLOW_TARGET_WORLD: 'local',
  WORKFLOW_LOCAL_DATA_DIR: `${root}/shared/workflow`,
  WORKFLOW_LOCAL_BASE_URL: 'http://127.0.0.1:3100',
})
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3100'], {
  cwd: `${root}/current`, env, stdio: 'inherit',
})
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal))
child.on('error', () => process.exit(1))
child.on('exit', code => process.exit(code ?? 1))
