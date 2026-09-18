import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const serviceDir = join(process.cwd(), 'services/whatsapp-web-bridge')

describe('WhatsApp bridge cloud deployment', () => {
  it('keeps Railway on one always-on replica with a liveness healthcheck', () => {
    const config = JSON.parse(readFileSync(join(serviceDir, 'railway.json'), 'utf8'))

    expect(config.deploy).toMatchObject({
      healthcheckPath: '/health',
      restartPolicyType: 'ALWAYS',
      sleepApplication: false,
      requiredMountPath: '/data',
      numReplicas: 1,
      overlapSeconds: 0,
      drainingSeconds: 30,
    })
  })

  it('never sends local WhatsApp credentials or dotenv files to the image builder', () => {
    const ignore = readFileSync(join(serviceDir, '.dockerignore'), 'utf8')

    expect(ignore).toContain('.data/')
    expect(ignore).toContain('auth_info_baileys/')
    expect(ignore).toContain('auth/')
    expect(ignore).toContain('state/')
    expect(ignore).toContain('webhook-outbox/')
    expect(ignore).toContain('webhook-dead-letter/')
    expect(ignore).toContain('.env')
    expect(ignore).toContain('.env.*')
  })

  it('initializes the mounted volume as root and runs the bridge unprivileged', () => {
    const dockerfile = readFileSync(join(serviceDir, 'Dockerfile'), 'utf8')
    const entrypoint = readFileSync(join(serviceDir, 'docker-entrypoint.sh'), 'utf8')

    expect(dockerfile).toContain('ENTRYPOINT ["./docker-entrypoint.sh"]')
    expect(entrypoint).toContain('chown bridge:bridge /data "$auth_dir" "$state_dir"')
    expect(entrypoint).toContain('exec gosu bridge "$@"')
  })
})
