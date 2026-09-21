/**
 * scripts/send-test-emails.ts — QA транзакционных писем.
 *
 * Шлёт ВСЕ виды писем платформы на один указанный адрес — чтобы глазами
 * проверить вёрстку, данные, кнопку и запасную ссылку в реальном почтовике.
 *
 *   npx tsx scripts/send-test-emails.ts --to=user@example.com
 *
 * Флаги: --only=invitation|questionnaire|gri|access  (по умолчанию все)
 *
 * Идемпотентность намеренно отключена (dedupeKey не задаётся), иначе повторный
 * прогон QA молча ничего бы не отправил. Адрес обязателен и ровно один:
 * рассылать «тесты» посторонним нельзя.
 */

import fs from 'node:fs'
import path from 'node:path'

function loadEnv(file: string): void {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let val = m[2].trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    if (process.env[m[1]] === undefined) process.env[m[1]] = val
  }
}
loadEnv(path.resolve(process.cwd(), '.env.local'))
loadEnv(path.resolve(process.cwd(), '.env'))

const arg = (n: string): string | undefined => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}

async function main(): Promise<void> {
  const to = arg('to')
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) throw new Error('Укажите один корректный --to=<адрес>')
  const only = arg('only')

  const { sendTransactionalEmail } = await import('@/lib/email/send')
  const { emailFrom } = await import('@/lib/email/brand')
  const { getSiteUrl } = await import('@/lib/site-url')
  const t = await import('@/lib/email/templates')

  const now = new Date()
  const base = getSiteUrl()
  const company = 'ТОО «Береке Групп»'
  const name = 'Ансар'

  const cases: Array<{ key: string; kind: 'portal_invitation' | 'questionnaire_completed' | 'gri_completed' | 'portal_access_granted'; built: { subject: string; content: unknown } }> = [
    {
      key: 'invitation', kind: 'portal_invitation',
      built: t.buildInvitationEmail({
        name, company, roleLabel: 'SuperExpert', invitedByLabel: 'admin@aistart360.app',
        note: 'Проверьте кабинет SuperExpert и разрешённые действия.',
        invitedAt: now, expiresAt: new Date(now.getTime() + 3600_000),
        url: `${base}/auth/verify?token_hash=DEMO-TOKEN&type=invite&next=%2Fauth%2Freset-password`,
      }),
    },
    {
      key: 'questionnaire', kind: 'questionnaire_completed',
      built: t.buildQuestionnaireCompletedEmail({
        name, company, completedSteps: 12, totalSteps: 12, completedAt: now, url: `${base}/client/point-a`,
      }),
    },
    {
      key: 'gri', kind: 'gri_completed',
      built: t.buildGriCompletedEmail({ name, company, griIndex: 6.8, completedAt: now, url: `${base}/gri` }),
    },
    {
      key: 'access', kind: 'portal_access_granted',
      built: t.buildAccessGrantedEmail({ name, company, roleLabel: 'SuperExpert', grantedAt: now, url: `${base}/super-expert/login` }),
    },
  ]

  console.log('отправитель:', emailFrom())
  console.log('получатель :', to)
  console.log()

  for (const c of cases) {
    if (only && only !== c.key) continue
    const res = await sendTransactionalEmail({
      kind: c.kind,
      to,
      subject: c.built.subject,
      content: c.built.content as never,
      userId: null,
      dedupeKey: null,
      metadata: { qa: true },
    })
    console.log(
      `${c.key.padEnd(14)} ${res.ok ? 'отправлено' : 'ОШИБКА'}`,
      res.providerId ? `id=${res.providerId}` : '',
      res.error ? `— ${res.error}` : '',
    )
  }
}

main().catch((e) => {
  console.error('Ошибка:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
