/**
 * scripts/invite-staff.ts — пригласить сотрудника с ролью и отправить письмо.
 *
 * Делает ровно то же, что панель, только из терминала — когда нужно выдать
 * первую роль (например, первого SuperExpert), а в панель ещё некому зайти.
 *
 *   npx tsx scripts/invite-staff.ts --email=user@example.com --role=super_expert
 *
 * Флаги:
 *   --email=<адрес>      кому (обязательно)
 *   --role=<staff-role>  super_expert | admin | crm_manager | content_manager | analyst | support
 *                        (без флага приглашение уходит как обычному пользователю)
 *   --name="Имя"         имя в письме
 *   --company="ТОО ..."  компания в письме
 *   --note="текст"       личное сообщение в письме
 *   --grant-now          выдать роль СРАЗУ, не дожидаясь принятия приглашения
 *   --dry-run            ничего не менять и не отправлять — только показать план
 *
 * Скрипт НЕ создаёт и НЕ меняет пароли: если аккаунта ещё нет, человек задаёт
 * пароль сам по ссылке из письма. Дубликат пользователя не создаётся.
 *
 * Переменные окружения: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * RESEND_API_KEY, AUTH_URL (или NEXT_PUBLIC_APP_URL).
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

const arg = (name: string): string | undefined => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`)

async function main(): Promise<void> {
  const { createServiceClient } = await import('@/lib/supabase-service')
  const { sendPlatformInvite, normalizeEmail } = await import('@/lib/admin/invites')
  const { isStaffRole, STAFF_ROLE_LABELS } = await import('@/lib/admin/rbac')

  const email = normalizeEmail(arg('email') ?? '')
  if (!email) throw new Error('Укажите --email=<корректный адрес>')

  const roleArg = arg('role')
  if (roleArg && !isStaffRole(roleArg)) throw new Error(`Неизвестная роль: ${roleArg}`)
  const role = roleArg && isStaffRole(roleArg) ? roleArg : null
  const dryRun = flag('dry-run')
  const grantNow = flag('grant-now')

  console.log('— Приглашение сотрудника —')
  console.log('  адрес :', email)
  console.log('  роль  :', role ? `${STAFF_ROLE_LABELS[role]} (${role})` : 'обычный пользователь')
  console.log('  режим :', dryRun ? 'dry-run (ничего не меняем)' : 'боевой')

  const sb = createServiceClient()
  const { data: existing } = await sb.from('profiles').select('id, email, status, full_name').ilike('email', email).maybeSingle()
  const profile = existing as { id: string; status: string; full_name: string | null } | null
  console.log('  аккаунт:', profile ? `уже существует (${profile.id}, статус ${profile.status})` : 'будет создан по ссылке из письма')

  if (dryRun) {
    console.log('\ndry-run: письмо не отправлено, ничего не изменено.')
    return
  }

  // Роль сразу — только если аккаунт уже есть. Иначе она проставится, когда
  // человек примет приглашение (lib/admin/invites.ts → acceptInvitation).
  if (role && profile && grantNow) {
    const now = new Date().toISOString()
    if (profile.status !== 'approved') {
      await sb.from('profiles').update({ status: 'approved', approved_at: now }).eq('id', profile.id)
      console.log('  профиль переведён в «одобрен»')
    }
    const { error } = await sb
      .from('staff_roles')
      .upsert({ user_id: profile.id, role, granted_by: 'script:invite-staff', updated_at: now }, { onConflict: 'user_id' })
    if (error) throw new Error(`Не удалось выдать роль: ${error.message}`)
    console.log('  роль выдана немедленно')
  }

  const result = await sendPlatformInvite({
    email,
    staffRole: role,
    name: arg('name') ?? profile?.full_name ?? null,
    company: arg('company') ?? null,
    note: arg('note') ?? null,
    invitedById: 'script:invite-staff',
    invitedByLabel: arg('from') ?? null,
    next: role === 'super_expert' && profile ? '/super-expert' : undefined,
  })

  console.log('\nРезультат:', result.outcome, '—', result.message)
  if (result.outcome === 'failed') process.exitCode = 1
}

main().catch((e) => {
  console.error('Ошибка:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
