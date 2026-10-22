/**
 * lib/ui/pending.ts — what an action button says while its request runs (W4), and the buttons of the
 * cabinet that use it: each shows the pending label and is disabled while its request runs.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PENDING_LABEL, actionLabel, isPendingKey } from '@/lib/ui/pending'

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('actionLabel / isPendingKey', () => {
  it('idle label until the request runs, then the pending label of its kind', () => {
    expect(actionLabel('Сохранить', false)).toBe('Сохранить')
    expect(actionLabel('Сохранить', true)).toBe('Сохраняем…')
    expect(actionLabel('Удалить', true, 'delete')).toBe('Удаляем…')
    expect(actionLabel('Отвязать', true, 'unlink')).toBe('Отвязываем…')
  })

  it('every pending label ends with an ellipsis character (not three dots)', () => {
    for (const v of Object.values(PENDING_LABEL)) expect(v.endsWith('…') && !v.endsWith('...')).toBe(true)
  })

  it('only the clicked button of a row is the running one', () => {
    expect(isPendingKey('c1', 'c1')).toBe(true)
    expect(isPendingKey('c1', 'ignore')).toBe(false)
    expect(isPendingKey(null, 'ignore')).toBe(false)
    expect(isPendingKey(undefined, 'c0')).toBe(false)
  })
})

describe('action buttons of the cabinet show the pending state (W4)', () => {
  it.each([
    ['components/point-a-v4/KeyMetricsStrip.tsx', ["actionLabel('Сохранить', save.isPending)", 'aria-busy={save.isPending}']],
    ['components/point-a-v4/AttentionPanel.tsx', ["actionLabel('Сохранить', resolve.isPending)", "isPendingKey(pendingKey, 'ignore')", 'if (resolve.isPending) return']],
    ['components/point-a-v4/BlocksSection.tsx', ['toggling={isPendingKey(pendingKey, `toggle:${b.key}`)}', 'disabled={view.isPending}', 'if (view.isPending) return']],
    ['components/dashboard/GoalsBar.tsx', ["actionLabel('Сохранить', save.isPending)", 'removing={remove.isPending && remove.variables === item.goal.id}', 'if (save.isPending) return']],
    ['components/dashboard/PointADashboardSummary.tsx', ['|| saving) return', "{saving ? 'Сохраняем…' : 'Сохранить'}"]],
    ['components/settings/SettingsClient.tsx', [
      "{saving ? 'Сохраняем…' : 'Сохранить изменения'}", "{saving ? 'Меняем…' : 'Сменить пароль'}",
      "actionLabel('Подтвердить', running === 'disable', 'disable')", "actionLabel('Удалить', removingId === c.id, 'delete')",
      "actionLabel('Отвязать', running === 'unlink', 'unlink')", 'busy={savingKeys.has(`${c.key}:email`)}',
    ]],
    ['components/client/messages/ClientMessages.tsx', ["{sending ? 'Отправляем…' : 'Отправить'}"]],
  ])('%s', (file, needles) => {
    const code = src(file)
    for (const n of needles) expect(code, n).toContain(n)
  })
})
