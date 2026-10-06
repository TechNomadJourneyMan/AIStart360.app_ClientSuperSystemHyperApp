'use client'

/**
 * «Провайдеры и ключи» — dialogs: provider (create / edit), API key (add /
 * rotate, with «Проверить»), model (add / edit) and budgets. Each dialog sends
 * its own request through gigaFetch and reports back with `onDone`.
 *
 * Key input: type=password, never prefilled, cleared after every submit and on
 * close; the secret lives only in this component's state until it is sent.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Lock, ShieldCheck } from 'lucide-react'
import { Button, ConfirmDialog, Field, GigaApiError, Modal, cx, gigaFetch, inputClass } from '../kit'
import {
  API,
  CAPABILITIES,
  CAPABILITY_HINT,
  CAPABILITY_LABEL,
  buildBudgetsPayload,
  buildModelPayload,
  buildProviderPayload,
  budgetsDraftFrom,
  capabilityAvailability,
  labelError,
  modelDraftFrom,
  providerDraftFrom,
  providerFieldOfError,
  secretError,
  type BudgetChange,
  type BudgetsDraft,
  type FieldErrors,
  type ModelDraft,
  type ModelField,
  type ProviderDraft,
  type ProviderField,
} from './model'
import type { BudgetsDto, CredentialDto, ModelDto, ProviderDto, VerifyResultDto } from './types'
import { VerifyOutcome } from './views'

const errMsg = (e: unknown) => (e instanceof GigaApiError || e instanceof Error ? e.message : 'Не удалось выполнить действие')

function FieldError({ text }: { text?: string | null }) {
  if (!text) return null
  return <span role="alert" className="mt-1 block text-[11px] text-red-300">{text}</span>
}

function FormError({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <p role="alert" className="mb-3 flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
      <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {text}
    </p>
  )
}

function Check({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('flex items-start gap-2 text-xs text-slate-300', disabled && 'opacity-60')}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-white/20 bg-white/5 accent-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40" />
      <span>{label}{hint && <span className="block text-[10px] text-slate-600">{hint}</span>}</span>
    </label>
  )
}

const errClass = (bad: boolean) => cx(inputClass, bad && 'border-red-500/40')

// ─── Provider ────────────────────────────────────────────────────────────────

export function ProviderDialog({ open, provider, onClose, onDone }: {
  open: boolean
  /** null = create. */
  provider: ProviderDto | null
  onClose: () => void
  onDone: (message: string) => void
}) {
  const mode = provider ? 'edit' : 'create'
  const [d, setD] = useState<ProviderDraft>(() => providerDraftFrom(provider))
  const [errors, setErrors] = useState<FieldErrors<ProviderField>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) { setD(providerDraftFrom(provider)); setErrors({}); setFormError(null) }
  }, [open, provider])

  const set = <K extends ProviderField>(k: K, v: ProviderDraft[K]) => {
    setD((x) => ({ ...x, [k]: v }))
    setErrors((e) => ({ ...e, [k]: undefined }))
  }

  async function submit() {
    const { payload, errors: errs } = buildProviderPayload(d, mode)
    setErrors(errs)
    setFormError(null)
    if (!payload) return
    setSaving(true)
    try {
      if (provider) await gigaFetch(`${API}/${provider.id}`, { method: 'PATCH', json: payload })
      else await gigaFetch(API, { method: 'POST', json: payload })
      onDone(provider ? `Провайдер «${d.name.trim()}» сохранён` : `Провайдер «${d.name.trim()}» добавлен. Теперь добавьте ключ и модели.`)
    } catch (e) {
      const msg = errMsg(e)
      const field = providerFieldOfError(msg)
      if (field) setErrors((x) => ({ ...x, [field]: msg }))
      else setFormError(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      wide
      title={provider ? `Провайдер «${provider.name}»` : 'Новый провайдер'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Отмена</Button>
          <Button variant="primary" loading={saving} onClick={() => void submit()}>{provider ? 'Сохранить' : 'Добавить провайдера'}</Button>
        </>
      }
    >
      <FormError text={formError} />
      <p className="mb-4 text-[11px] text-slate-500">Ключи API здесь не вводятся — после сохранения добавьте ключ в карточке провайдера. Адрес проверяется: только https и внешний домен.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Название" hint="Как провайдер будет называться в панели">
          <input value={d.name} onChange={(e) => set('name', e.target.value)} className={errClass(!!errors.name)} placeholder="Alem Plus" maxLength={80} />
          <FieldError text={errors.name} />
        </Field>
        <Field label="Ключ (идентификатор)" hint={provider ? 'Ключ провайдера не меняется' : 'латиница в нижнем регистре, цифры, _ и -'}>
          <input value={d.key} onChange={(e) => set('key', e.target.value)} disabled={!!provider} className={cx(errClass(!!errors.key), 'font-mono', provider && 'opacity-60')} placeholder="alem" maxLength={40} />
          <FieldError text={errors.key} />
        </Field>
        <Field label="Тип">
          <select value={d.kind} onChange={(e) => set('kind', e.target.value as ProviderDraft['kind'])} className={cx(errClass(!!errors.kind), 'bg-[#0b1128]')}>
            <option value="openai_compatible">OpenAI-совместимый</option>
            <option value="openrouter" disabled={d.key.trim().toLowerCase() !== 'openrouter'}>OpenRouter (только для ключа openrouter)</option>
          </select>
          <FieldError text={errors.kind} />
        </Field>
        <Field label="Base URL" hint="Например, https://llm.alem.ai/v1">
          <input value={d.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} className={cx(errClass(!!errors.baseUrl), 'font-mono')} inputMode="url" maxLength={300} />
          <FieldError text={errors.baseUrl} />
        </Field>
        <Field label="Путь chat">
          <input value={d.chatPath} onChange={(e) => set('chatPath', e.target.value)} className={cx(errClass(!!errors.chatPath), 'font-mono')} />
          <FieldError text={errors.chatPath} />
        </Field>
        <Field label="Путь embeddings">
          <input value={d.embeddingsPath} onChange={(e) => set('embeddingsPath', e.target.value)} className={cx(errClass(!!errors.embeddingsPath), 'font-mono')} />
          <FieldError text={errors.embeddingsPath} />
        </Field>
        <Field label="Путь rerank" hint="Пусто — провайдер не делает rerank">
          <input value={d.rerankPath} onChange={(e) => set('rerankPath', e.target.value)} className={cx(errClass(!!errors.rerankPath), 'font-mono')} placeholder="/rerank" />
          <FieldError text={errors.rerankPath} />
        </Field>
        <Field label="Режим OCR">
          <select value={d.ocrMode} onChange={(e) => set('ocrMode', e.target.value as ProviderDraft['ocrMode'])} className={cx(inputClass, 'bg-[#0b1128]')}>
            <option value="">нет</option>
            <option value="chat_vision">через vision-модель чата (chat_vision)</option>
          </select>
        </Field>
        <Field label="Дневной бюджет, USD" hint="Пусто — без собственного лимита (действуют лимиты платформы и компании)">
          <input value={d.dailyBudget} onChange={(e) => set('dailyBudget', e.target.value)} className={cx(errClass(!!errors.dailyBudget), 'font-mono')} inputMode="decimal" placeholder="например, 10" />
          <FieldError text={errors.dailyBudget} />
        </Field>
        <div className="space-y-2 pt-5">
          <Check checked={d.supportsResponseFormat} onChange={(v) => set('supportsResponseFormat', v)} label="Поддерживает response_format (JSON-ответ)" hint="Если нет — формат JSON запрашивается текстом в промпте" />
          <Check checked={d.enabled} onChange={(v) => set('enabled', v)} label="Провайдер включён" />
        </div>
      </div>
      <div className="mt-3 grid gap-3">
        <Field label="Дополнительные заголовки (несекретные)" hint="По одному в строке: «Имя: значение». Authorization и ключи сюда не вписывайте — для них раздел «Ключи».">
          <textarea value={d.headersText} onChange={(e) => set('headersText', e.target.value)} rows={3} className={cx(errClass(!!errors.headersText), 'font-mono text-xs')} placeholder="X-Title: AIStart360" />
          <FieldError text={errors.headersText} />
        </Field>
        <Field label="Заметка о приватности" hint="Что провайдер делает с данными по договору: хранение, обучение, регион">
          <textarea value={d.privacyNote} onChange={(e) => set('privacyNote', e.target.value)} rows={2} maxLength={500} className={errClass(!!errors.privacyNote)} />
          <FieldError text={errors.privacyNote} />
        </Field>
      </div>
    </Modal>
  )
}

// ─── API key ─────────────────────────────────────────────────────────────────

export function CredentialDialog({ open, provider, credential, onClose, onDone }: {
  open: boolean
  provider: Pick<ProviderDto, 'id' | 'name'> | null
  /** null = add a new key; set = rotate its secret. */
  credential: CredentialDto | null
  onClose: () => void
  /** Called after the key is saved (the dialog stays open for «Проверить»). */
  onDone: (message: string) => void
}) {
  const rotate = !!credential
  const [label, setLabel] = useState('')
  const [secret, setSecret] = useState('')
  const [errors, setErrors] = useState<{ label?: string | null; secret?: string | null }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<CredentialDto | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [verify, setVerify] = useState<VerifyResultDto | null>(null)
  const [verifyError, setVerifyError] = useState<string | null>(null)

  useEffect(() => {
    // Never prefilled; nothing survives closing the dialog.
    setLabel(''); setSecret(''); setErrors({}); setFormError(null); setSaved(null); setVerify(null); setVerifyError(null)
  }, [open, credential])

  async function submit() {
    const errs = { label: rotate ? null : labelError(label), secret: secretError(secret) }
    setErrors(errs)
    setFormError(null)
    if (errs.label || errs.secret || !provider) return
    const value = secret.trim()
    setSaving(true)
    try {
      const r = rotate
        ? await gigaFetch<{ credential: CredentialDto }>(`${API}/credentials/${credential!.id}/rotate`, { method: 'POST', json: { secret: value } })
        : await gigaFetch<{ credential: CredentialDto }>(`${API}/${provider.id}/credentials`, { method: 'POST', json: { label: label.trim(), secret: value } })
      setSaved(r.credential)
      onDone(rotate ? `Ключ «${r.credential.label}» заменён: ${r.credential.masked}` : `Ключ «${r.credential.label}» сохранён: ${r.credential.masked}`)
    } catch (e) {
      setFormError(errMsg(e))
    } finally {
      setSecret('')
      setSaving(false)
    }
  }

  async function runVerify() {
    if (!saved) return
    setVerifying(true)
    setVerifyError(null)
    try {
      const r = await gigaFetch<{ result: VerifyResultDto }>(`${API}/credentials/${saved.id}/verify`, { method: 'POST' })
      setVerify(r.result)
      setSaved(r.result.credential)
      onDone(r.result.ok ? `Ключ «${saved.label}» проверен — работает` : `Ключ «${saved.label}» не прошёл проверку`)
    } catch (e) {
      setVerifyError(errMsg(e))
    } finally {
      setVerifying(false)
    }
  }

  const title = rotate ? `Сменить ключ «${credential!.label}»` : `Новый ключ — ${provider?.name ?? ''}`
  return (
    <Modal
      open={open}
      onClose={saving || verifying ? () => {} : onClose}
      title={title}
      footer={saved ? (
        <>
          <Button variant="secondary" icon={<ShieldCheck size={13} />} loading={verifying} onClick={() => void runVerify()}>Проверить</Button>
          <Button variant="primary" onClick={onClose} disabled={verifying}>Готово</Button>
        </>
      ) : (
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Отмена</Button>
          <Button variant="primary" loading={saving} onClick={() => void submit()}>{rotate ? 'Заменить ключ' : 'Сохранить ключ'}</Button>
        </>
      )}
    >
      {saved ? (
        <div className="space-y-3">
          <p role="status" className="flex items-start gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            <Lock size={13} className="mt-0.5 shrink-0" />
            <span>Ключ «{saved.label}» сохранён в зашифрованном виде: <span className="font-mono">{saved.masked}</span>. Полностью он больше не показывается.</span>
          </p>
          <p className="text-[11px] text-slate-500">«Проверить» делает минимальный реальный запрос с этим ключом (чат на 1 токен, один эмбеддинг или список моделей) и сохраняет результат.</p>
          {verify && <VerifyOutcome result={verify} />}
          {verifyError && <FormError text={verifyError} />}
        </div>
      ) : (
        <form
          onSubmit={(e) => { e.preventDefault(); void submit() }}
          autoComplete="off"
          className="space-y-3"
        >
          <FormError text={formError} />
          <p className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[11px] text-amber-200">
            <Lock size={12} className="mt-0.5 shrink-0" />
            <span>Ключ хранится только в зашифрованном виде (AES-256-GCM) и после сохранения больше не показывается — в панели видны лишь последние 4 символа (••••abcd). В журнал аудита и логи он не попадает.</span>
          </p>
          {rotate ? (
            <p className="text-xs text-slate-400">Текущий ключ: <span className="font-mono text-slate-200">{credential!.masked}</span>. Название, модели и маршруты останутся прежними.</p>
          ) : (
            <Field label="Название ключа" hint="Например, «Основной» или «Резервный (бухгалтерия)»">
              <input value={label} onChange={(e) => { setLabel(e.target.value); setErrors((x) => ({ ...x, label: null })) }} className={errClass(!!errors.label)} maxLength={80} autoComplete="off" />
              <FieldError text={errors.label} />
            </Field>
          )}
          <Field label={rotate ? 'Новый ключ API' : 'Ключ API'}>
            <input
              type="password"
              name="ai-provider-secret"
              value={secret}
              onChange={(e) => { setSecret(e.target.value); setErrors((x) => ({ ...x, secret: null })) }}
              className={cx(errClass(!!errors.secret), 'font-mono')}
              autoComplete="new-password"
              spellCheck={false}
              placeholder="вставьте ключ"
            />
            <FieldError text={errors.secret} />
          </Field>
        </form>
      )}
    </Modal>
  )
}

// ─── Model ───────────────────────────────────────────────────────────────────

export function ModelDialog({ open, provider, model, onClose, onDone }: {
  open: boolean
  provider: ProviderDto | null
  /** null = add. */
  model: ModelDto | null
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [d, setD] = useState<ModelDraft>(() => modelDraftFrom(model))
  const [errors, setErrors] = useState<FieldErrors<ModelField>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) { setD(modelDraftFrom(model)); setErrors({}); setFormError(null) }
  }, [open, model])

  if (!provider) return null
  const availability = capabilityAvailability(provider)
  const set = <K extends ModelField>(k: K, v: ModelDraft[K]) => {
    setD((x) => ({ ...x, [k]: v }))
    setErrors((e) => ({ ...e, [k]: undefined }))
  }

  async function submit() {
    const { payload, errors: errs } = buildModelPayload(d, provider!)
    setErrors(errs)
    setFormError(null)
    if (!payload) return
    setSaving(true)
    try {
      await gigaFetch(`${API}/models`, { method: 'POST', json: payload })
      onDone(model ? `Модель ${d.modelId.trim()} сохранена` : `Модель ${d.modelId.trim()} добавлена`)
    } catch (e) {
      const msg = errMsg(e)
      if (/^modelId/.test(msg)) setErrors((x) => ({ ...x, modelId: msg }))
      else if (/^price(In|Out)PerMtok/.test(msg)) setErrors((x) => ({ ...x, [msg.startsWith('priceIn') ? 'priceIn' : 'priceOut']: msg }))
      else if (/rerank|OCR/.test(msg)) setErrors((x) => ({ ...x, capability: msg }))
      else setFormError(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title={model ? `Модель ${model.model_id}` : `Новая модель — ${provider.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Отмена</Button>
          <Button variant="primary" loading={saving} onClick={() => void submit()}>{model ? 'Сохранить' : 'Добавить модель'}</Button>
        </>
      }
    >
      <FormError text={formError} />
      <div className="space-y-3">
        <Field label="ID модели у провайдера" hint={model ? 'Чтобы сменить id или возможность, добавьте новую модель и удалите эту' : 'Точно как в API провайдера, например alemllm'}>
          <input value={d.modelId} onChange={(e) => set('modelId', e.target.value)} disabled={!!model} className={cx(errClass(!!errors.modelId), 'font-mono', model && 'opacity-60')} maxLength={200} />
          <FieldError text={errors.modelId} />
        </Field>
        <Field label="Возможность">
          <select value={d.capability} onChange={(e) => set('capability', e.target.value as ModelDraft['capability'])} disabled={!!model} className={cx(errClass(!!errors.capability), 'bg-[#0b1128]', model && 'opacity-60')}>
            {CAPABILITIES.map((c) => (
              <option key={c} value={c} disabled={!!availability[c]}>
                {CAPABILITY_LABEL[c]} — {availability[c] ?? CAPABILITY_HINT[c]}
              </option>
            ))}
          </select>
          <FieldError text={errors.capability} />
        </Field>
        <Field label="Подпись (необязательно)">
          <input value={d.label} onChange={(e) => set('label', e.target.value)} className={errClass(!!errors.label)} maxLength={120} />
          <FieldError text={errors.label} />
        </Field>
        <Field label="Ключ" hint="Без привязки берётся первый включённый ключ провайдера">
          <select value={d.credentialId} onChange={(e) => set('credentialId', e.target.value)} className={cx(inputClass, 'bg-[#0b1128]')}>
            <option value="">любой включённый ключ провайдера</option>
            {provider.credentials.map((c) => <option key={c.id} value={c.id}>{c.label} {c.masked}{c.enabled ? '' : ' (выключен)'}</option>)}
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Цена входа, USD за 1M токенов" hint="Пусто — стоимость берётся у провайдера или оценивается">
            <input value={d.priceIn} onChange={(e) => set('priceIn', e.target.value)} className={cx(errClass(!!errors.priceIn), 'font-mono')} inputMode="decimal" />
            <FieldError text={errors.priceIn} />
          </Field>
          <Field label="Цена выхода, USD за 1M токенов">
            <input value={d.priceOut} onChange={(e) => set('priceOut', e.target.value)} className={cx(errClass(!!errors.priceOut), 'font-mono')} inputMode="decimal" />
            <FieldError text={errors.priceOut} />
          </Field>
        </div>
        <Check checked={d.enabled} onChange={(v) => set('enabled', v)} label="Модель включена" hint="Выключенная модель не используется маршрутами — работает встроенный вариант" />
      </div>
    </Modal>
  )
}

// ─── Budgets ─────────────────────────────────────────────────────────────────

export function BudgetsDialog({ open, budgets, onClose, onDone }: {
  open: boolean
  budgets: BudgetsDto | null
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [d, setD] = useState<BudgetsDraft | null>(budgets ? budgetsDraftFrom(budgets) : null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [confirm, setConfirm] = useState<{ payload: Record<string, unknown>; changes: BudgetChange[] } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open && budgets) { setD(budgetsDraftFrom(budgets)); setErrors({}); setConfirm(null); setFormError(null) }
  }, [open, budgets])

  if (!budgets || !d) return null

  function review() {
    const r = buildBudgetsPayload(d!, budgets!)
    setErrors(r.errors)
    setFormError(null)
    if (Object.keys(r.errors).length) return
    if (!r.payload) { setFormError('Ничего не изменилось'); return }
    setConfirm({ payload: r.payload, changes: r.changes })
  }

  async function save() {
    if (!confirm) return
    setSaving(true)
    try {
      await gigaFetch(`${API}/budgets`, { method: 'PUT', json: confirm.payload })
      setConfirm(null)
      onDone('Бюджеты сохранены')
    } catch (e) {
      setConfirm(null)
      setFormError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const money = (key: string, value: string, onChange: (v: string) => void, placeholder: string) => (
    <>
      <input value={value} onChange={(e) => { onChange(e.target.value); setErrors((x) => ({ ...x, [key]: '' })) }} className={cx(errClass(!!errors[key]), 'font-mono')} inputMode="decimal" placeholder={placeholder} />
      <FieldError text={errors[key]} />
    </>
  )

  return (
    <>
      <Modal
        open={open && !confirm}
        onClose={onClose}
        wide
        title="Дневные бюджеты ИИ, USD"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>Отмена</Button>
            <Button variant="primary" onClick={review}>Далее</Button>
          </>
        }
      >
        <FormError text={formError} />
        <p className="mb-4 text-[11px] text-slate-500">Пустое поле — значение по умолчанию: для платформы и компании берётся из env, у провайдера собственного лимита нет. 0 запрещает вызовы. Вызов, который превысил бы лимит, останавливается с ошибкой BUDGET_EXCEEDED.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Платформа в сутки" hint={`Сейчас ${budgets.platform.dailyUsd} (${budgets.platform.source === 'db' ? 'БД' : 'env'})`}>
            {money('platform', d.platform, (v) => setD({ ...d, platform: v }), `из env: ${budgets.platform.source === 'env' ? budgets.platform.dailyUsd : '—'}`)}
          </Field>
          <Field label="Одна компания в сутки" hint={`Сейчас ${budgets.company.dailyUsd} (${budgets.company.source === 'db' ? 'БД' : 'env'})`}>
            {money('company', d.company, (v) => setD({ ...d, company: v }), `из env: ${budgets.company.source === 'env' ? budgets.company.dailyUsd : '—'}`)}
          </Field>
          {budgets.providers.map((p) => (
            <Field key={p.key} label={`${p.name} в сутки`} hint={`провайдер ${p.key}`}>
              {money(`provider:${p.key}`, d.providers[p.key] ?? '', (v) => setD({ ...d, providers: { ...d.providers, [p.key]: v } }), 'без лимита')}
            </Field>
          ))}
        </div>
      </Modal>
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => void save()}
        loading={saving}
        tone="primary"
        title="Изменить бюджеты?"
        confirmLabel="Сохранить бюджеты"
        text="Новые лимиты начнут действовать в течение минуты на всех серверах. Изменение запишется в журнал аудита."
      >
        <ul className="space-y-1 text-xs">
          {confirm?.changes.map((c) => (
            <li key={c.label} className="flex flex-wrap justify-between gap-2 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-1.5">
              <span className="text-slate-300">{c.label}</span>
              <span className="font-mono text-slate-400">{c.from} → <span className="text-slate-100">{c.to}</span></span>
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </>
  )
}
