/**
 * Agent permission model (docs/platform/05-agents.md).
 *
 * Every tool an agent can call requires one permission. The effective decision
 * for (agent, permission) is the MOST restrictive of:
 *   1. the code ceiling for the permission (PERMISSION_CEILING) — no database
 *      row and no admin can make a dangerous permission fully automatic;
 *   2. the admin grant in agent_permission_grants, when present;
 *   3. otherwise the agent definition's default (code, reviewed in PRs).
 * A permission the definition does not mention is DENY.
 */

export const PERMISSIONS = [
  'READ_CLIENT_DATA',
  'WRITE_CLIENT_DATA',
  'READ_FILES',
  'PROCESS_FILES',
  'CALL_LLM',
  'UPDATE_METRICS',
  'CREATE_FINDINGS',
  'CREATE_REPORT',
  'RUN_INTEGRATION',
  'SEND_TELEGRAM',
  'SEND_EMAIL',
  'EXECUTE_WORKFLOW',
  'MODIFY_SYSTEM',
  'DELETE_DATA',
] as const

export type Permission = (typeof PERMISSIONS)[number]

export type Decision = 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY'

const RESTRICTIVENESS: Record<Decision, number> = { ALLOW: 0, REQUIRE_APPROVAL: 1, DENY: 2 }

export const PERMISSION_LABELS: Record<Permission, string> = {
  READ_CLIENT_DATA: 'Чтение данных клиента',
  WRITE_CLIENT_DATA: 'Изменение данных клиента',
  READ_FILES: 'Чтение файлов',
  PROCESS_FILES: 'Обработка файлов',
  CALL_LLM: 'Вызов языковой модели',
  UPDATE_METRICS: 'Обновление метрик',
  CREATE_FINDINGS: 'Создание выводов диагностики',
  CREATE_REPORT: 'Создание отчётов',
  RUN_INTEGRATION: 'Запуск интеграций',
  SEND_TELEGRAM: 'Отправка в Telegram (персоналу)',
  SEND_EMAIL: 'Отправка email',
  EXECUTE_WORKFLOW: 'Запуск других агентов и процессов',
  MODIFY_SYSTEM: 'Изменение настроек платформы',
  DELETE_DATA: 'Удаление данных',
}

/**
 * The loosest decision a permission may ever have. Actions that change client
 * data, reach people outside the team, change the platform or destroy data
 * always need a human.
 */
export const PERMISSION_CEILING: Record<Permission, Decision> = {
  READ_CLIENT_DATA: 'ALLOW',
  WRITE_CLIENT_DATA: 'REQUIRE_APPROVAL',
  READ_FILES: 'ALLOW',
  PROCESS_FILES: 'ALLOW',
  CALL_LLM: 'ALLOW',
  UPDATE_METRICS: 'ALLOW',
  CREATE_FINDINGS: 'ALLOW',
  CREATE_REPORT: 'ALLOW',
  RUN_INTEGRATION: 'ALLOW',
  SEND_TELEGRAM: 'ALLOW',
  SEND_EMAIL: 'REQUIRE_APPROVAL',
  EXECUTE_WORKFLOW: 'ALLOW',
  MODIFY_SYSTEM: 'REQUIRE_APPROVAL',
  DELETE_DATA: 'REQUIRE_APPROVAL',
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value)
}

export function mostRestrictive(...decisions: Array<Decision | undefined | null>): Decision {
  let out: Decision = 'ALLOW'
  for (const d of decisions) {
    if (d && RESTRICTIVENESS[d] > RESTRICTIVENESS[out]) out = d
  }
  return out
}

/**
 * Effective decision. `defaults` is the agent definition's map; `grants` are
 * admin rows. An admin grant may loosen a default only up to the ceiling.
 */
export function resolveDecision(
  permission: Permission,
  defaults: Partial<Record<Permission, Decision>>,
  grants: Partial<Record<Permission, Decision>> = {},
): Decision {
  const declared = defaults[permission]
  if (!declared) return 'DENY'
  const chosen = grants[permission] ?? declared
  return mostRestrictive(chosen, PERMISSION_CEILING[permission])
}

/** Full effective matrix for an agent — used by the admin UI and the runtime. */
export function effectivePermissions(
  defaults: Partial<Record<Permission, Decision>>,
  grants: Partial<Record<Permission, Decision>> = {},
): Record<Permission, Decision> {
  const out = {} as Record<Permission, Decision>
  for (const p of PERMISSIONS) out[p] = resolveDecision(p, defaults, grants)
  return out
}
