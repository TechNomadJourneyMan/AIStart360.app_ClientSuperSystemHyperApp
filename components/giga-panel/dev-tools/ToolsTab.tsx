'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Bell, Mail, ShieldCheck } from 'lucide-react'
import { checkProfanity, maskWord, PROFANITY_CATEGORY_LABELS } from '@/lib/moderation/profanity'
import { SETTINGS, SETTING_GROUPS, SETTING_KEYS, type SettingKey } from '@/lib/settings/registry'
import { TEST_EMAIL_TEMPLATES, type TestEmailTemplate } from '@/lib/devtools/tools'
import { Badge, Button, ErrorState, Field, GigaApiError, Panel, Select, cx, fmtDateTime, gigaFetch, inputClass, useGigaQuery } from '../kit'
import { useStaff } from '../StaffContext'

const TG_STATUS: Record<string, string> = {
  sent: 'Telegram: отправлено',
  failed: 'Telegram: ошибка',
  not_linked: 'Telegram не привязан к вашему аккаунту',
  bot_not_configured: 'Бот персонала не настроен',
}

function formatValue(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'вкл' : 'выкл'
  if (v == null || v === '') return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Проверочные инструменты: уведомление и письмо себе, фильтр контента, снимок настроек. */
export function ToolsTab() {
  const { me } = useStaff()
  const [busy, setBusy] = useState<string | null>(null)
  const [template, setTemplate] = useState<TestEmailTemplate>('client_notification')
  const [text, setText] = useState('')
  const [kind, setKind] = useState<'text' | 'name'>('text')
  const result = useMemo(() => (text.trim() ? checkProfanity(text, { kind }) : null), [text, kind])

  const sendNotification = async () => {
    setBusy('notify')
    try {
      const res = await gigaFetch<{ inApp: boolean; telegram: { status: string; error?: string } }>('/api/giga-admin/dev-tools/test-notification', { method: 'POST', json: {} })
      const parts = [res.inApp ? 'В кабинете: создано' : 'В кабинете: ошибка', TG_STATUS[res.telegram.status] ?? res.telegram.status]
      if (res.inApp) toast.success(parts.join(' · '))
      else toast.warning(parts.join(' · '))
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось отправить')
    } finally {
      setBusy(null)
    }
  }

  const sendEmail = async () => {
    setBusy('email')
    try {
      const res = await gigaFetch<{ to: string; skipped: boolean }>('/api/giga-admin/dev-tools/test-email', { method: 'POST', json: { template } })
      toast.success(res.skipped ? 'Отправка пропущена (тестовый режим окружения)' : `Письмо отправлено на ${res.to}`)
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось отправить письмо')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Тестовое уведомление себе" description="Запись в ленту уведомлений вашего аккаунта и сообщение в ваш Telegram, если он привязан. Другие сотрудники его не получат.">
          <Button variant="primary" icon={<Bell size={14} />} loading={busy === 'notify'} onClick={sendNotification}>Отправить себе</Button>
        </Panel>
        <Panel title="Тестовое письмо себе" description={`Шаблон письма платформы с демо-данными, тема с пометкой «[ТЕСТ]». Получатель — только ваш адрес${me?.email ? ` (${me.email})` : ''}. Не больше 10 в час.`}>
          <div className="flex flex-wrap items-center gap-2">
            <Select label="Шаблон" value={template} onChange={setTemplate} options={TEST_EMAIL_TEMPLATES.map((t) => ({ value: t.key, label: t.label }))} />
            <Button variant="primary" icon={<Mail size={14} />} loading={busy === 'email'} onClick={sendEmail}>Отправить письмо</Button>
          </div>
        </Panel>
      </div>

      <Panel
        title="Проверка фильтра контента"
        description="Проверяет текст встроенными правилами фильтра (мат, оскорбления, спам) прямо в браузере — ничего не сохраняется и не журналируется. Словарь из «Фильтр контента» здесь не учитывается."
        actions={<Link href="/admin-giga-panel/content-filter" className="text-[11px] text-blue-300 hover:underline">Фильтр контента →</Link>}
      >
        <div className="grid gap-3 lg:grid-cols-[1fr_16rem]">
          <Field label="Текст">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={20000} placeholder="Введите текст для проверки…" className={cx(inputClass, 'resize-y')} />
          </Field>
          <div className="space-y-3">
            <Field label="Тип поля" hint="«Имя / компания» дополнительно запрещает ссылки и @-ники">
              <Select label="Тип поля" value={kind} onChange={setKind} options={[{ value: 'text', label: 'Свободный текст' }, { value: 'name', label: 'Имя / компания' }] as const} />
            </Field>
            {result && (
              result.clean
                ? <p className="flex items-center gap-1.5 text-xs text-emerald-300"><ShieldCheck size={14} /> Нарушений нет — текст сохранится</p>
                : (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-red-300">Текст будет отклонён</p>
                    <div className="flex flex-wrap gap-1.5">
                      {result.categories.map((c) => <Badge key={c} tone="red">{PROFANITY_CATEGORY_LABELS[c]}</Badge>)}
                    </div>
                    <p className="text-[11px] text-slate-400">Срабатывания: {result.matches.map((m) => maskWord(m.word)).join(', ')}</p>
                  </div>
                )
            )}
          </div>
        </div>
      </Panel>

      <SettingsSnapshot />
    </div>
  )
}

function SettingsSnapshot() {
  const { data, error, loading, reload } = useGigaQuery<{ values: Record<string, unknown>; meta: Record<string, { updated_at: string; updated_by: string | null }> }>('/api/giga-admin/dev-tools/settings')
  const groups = useMemo(() => {
    const by = new Map<string, SettingKey[]>()
    for (const k of SETTING_KEYS) {
      const g = SETTINGS[k].group as string
      by.set(g, [...(by.get(g) ?? []), k])
    }
    return Array.from(by.entries())
  }, [])

  return (
    <Panel
      title="Снимок настроек платформы"
      description="Текущие значения всех флагов и режимов (только чтение). «по умолчанию» — значение в базе не задано."
      actions={
        <>
          <Button size="sm" loading={loading} onClick={() => reload()}>Обновить</Button>
          <Link href="/admin-giga-panel/settings" className="text-[11px] text-blue-300 hover:underline">Настройки →</Link>
        </>
      }
    >
      <ErrorState error={error} onRetry={reload} />
      {data && (
        <div className="space-y-4">
          {groups.map(([g, keys]) => (
            <div key={g}>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{(SETTING_GROUPS as Record<string, { label: string }>)[g]?.label ?? g}</p>
              <div className="grid gap-x-6 md:grid-cols-2">
                {keys.map((k) => {
                  const meta = data.meta[k]
                  return (
                    <div key={k} className="flex items-start justify-between gap-3 border-b border-white/[0.04] py-1.5">
                      <div className="min-w-0">
                        <p className="truncate text-[11px] text-slate-300" title={SETTINGS[k].help}>{SETTINGS[k].label}</p>
                        <p className="font-mono text-[10px] text-slate-600">{k}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="max-w-[14rem] break-all font-mono text-[11px] text-slate-100">{formatValue(data.values[k])}</p>
                        <p className="text-[10px] text-slate-600">{meta ? fmtDateTime(meta.updated_at) : 'по умолчанию'}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}
