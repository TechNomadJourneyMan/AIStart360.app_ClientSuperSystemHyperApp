'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Building2, Save } from 'lucide-react'
import { Button, Field, GigaApiError, Modal, Tabs, gigaFetch, inputClass } from '../kit'
import { SurveyTab } from './SurveyTab'
import type { User360Profile } from './types'

/**
 * «Добавить данные» — окно, где сотрудник дополняет карточку клиента.
 *
 * Зачем: сотрудник часто знает о клиенте больше, чем тот успел внести сам, и
 * раньше внести это можно было только войдя в кабинет клиента — то есть от его
 * имени. Здесь правка подписана: в журнале видно, кто и что изменил.
 *
 * Анкета редактируется тем же компонентом, что и на вкладке «Анкета», а не
 * второй копией формы: иначе правила валидации и история изменений разъехались
 * бы между двумя местами.
 */

type TabKey = 'company' | 'survey'

const STAGES = [
  { value: '', label: 'Не указана' },
  { value: 'Startup', label: 'Startup — запуск' },
  { value: 'Growth', label: 'Growth — рост' },
  { value: 'Scale', label: 'Scale — масштабирование' },
  { value: 'Mature', label: 'Mature — зрелость' },
] as const

const MODELS = [
  { value: '', label: 'Не указана' },
  { value: 'B2B', label: 'B2B' },
  { value: 'B2C', label: 'B2C' },
  { value: 'B2B2C', label: 'B2B2C' },
  { value: 'Mixed', label: 'Смешанная' },
] as const

export function DataEntryModal({ open, onClose, data, canEditSurvey, onChanged }: {
  open: boolean
  onClose: () => void
  data: User360Profile
  canEditSurvey: boolean
  onChanged: () => void
}) {
  const c = data.company
  const p = data.profile
  const [tab, setTab] = useState<TabKey>('company')
  const [busy, setBusy] = useState(false)

  const [name, setName] = useState(c?.name ?? p.organization ?? '')
  const [industry, setIndustry] = useState(c?.industry ?? '')
  const [stage, setStage] = useState<string>(c?.stage ?? '')
  const [model, setModel] = useState<string>(c?.business_model ?? '')
  const [employees, setEmployees] = useState(c?.employee_count != null ? String(c.employee_count) : '')
  const [regions, setRegions] = useState((c?.regions ?? []).join(', '))
  const [contactName, setContactName] = useState(p.full_name ?? '')
  const [position, setPosition] = useState(p.position ?? '')
  const [phone, setPhone] = useState(p.phone ?? '')
  const [reason, setReason] = useState('')

  const employeesInvalid = employees.trim() !== '' && !/^\d{1,7}$/.test(employees.trim())

  const save = async () => {
    if (employeesInvalid) return
    if (!name.trim()) {
      toast.error('Укажите название компании')
      return
    }
    setBusy(true)
    try {
      await gigaFetch(`/api/giga-admin/users/${p.id}/company`, {
        method: 'PATCH',
        json: {
          company: {
            name: name.trim(),
            industry: industry.trim() || null,
            stage: stage || null,
            business_model: model || null,
            employee_count: employees.trim() ? Number(employees.trim()) : null,
            regions: regions.split(',').map((r) => r.trim()).filter(Boolean),
            contact_name: contactName.trim() || null,
            contact_position: position.trim() || null,
            contact_phone: phone.trim() || null,
          },
          profile: {
            full_name: contactName.trim() || null,
            organization: name.trim(),
            position: position.trim() || null,
            phone: phone.trim() || null,
          },
          reason: reason.trim() || undefined,
        },
      })
      toast.success('Данные компании сохранены')
      onChanged()
    } catch (e) {
      toast.error(e instanceof GigaApiError ? e.message : 'Не удалось сохранить')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={<span className="flex items-center gap-2"><Building2 size={15} className="text-blue-300" /> Добавить данные — {c?.name || p.full_name || p.email}</span>}
      footer={tab === 'company' ? (
        <>
          <Button variant="ghost" onClick={onClose}>Закрыть</Button>
          <Button variant="primary" icon={<Save size={13} />} loading={busy} onClick={() => void save()}>Сохранить</Button>
        </>
      ) : <Button variant="ghost" onClick={onClose}>Закрыть</Button>}
    >
      <Tabs<TabKey>
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'company', label: 'Компания' },
          { key: 'survey', label: 'Анкета', hidden: !canEditSurvey },
        ]}
      />

      {tab === 'company' ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Название компании" hint="Обязательное поле — по нему клиент виден в списках.">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} className={inputClass} placeholder="ТОО «Пример»" />
          </Field>
          <Field label="Отрасль">
            <input value={industry} onChange={(e) => setIndustry(e.target.value)} maxLength={120} className={inputClass} placeholder="Телеком, ритейл, услуги…" />
          </Field>
          <Field label="Стадия бизнеса">
            <select value={stage} onChange={(e) => setStage(e.target.value)} className={inputClass}>
              {STAGES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Модель">
            <select value={model} onChange={(e) => setModel(e.target.value)} className={inputClass}>
              {MODELS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Сотрудников" hint={employeesInvalid ? undefined : 'Только число.'}>
            <input value={employees} onChange={(e) => setEmployees(e.target.value)} inputMode="numeric" className={inputClass} placeholder="25" />
            {employeesInvalid && <p className="mt-1 text-[11px] text-red-300">Введите число без пробелов и букв</p>}
          </Field>
          <Field label="Регионы" hint="Через запятую.">
            <input value={regions} onChange={(e) => setRegions(e.target.value)} className={inputClass} placeholder="Алматы, Астана" />
          </Field>
          <Field label="Контактное лицо">
            <input value={contactName} onChange={(e) => setContactName(e.target.value)} maxLength={160} className={inputClass} placeholder="Имя и фамилия" />
          </Field>
          <Field label="Должность">
            <input value={position} onChange={(e) => setPosition(e.target.value)} maxLength={160} className={inputClass} placeholder="Коммерческий директор" />
          </Field>
          <Field label="Телефон">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={60} className={inputClass} placeholder="+7 700 000 00 00" />
          </Field>
          <Field label="Причина правки" hint="Попадёт в журнал рядом с вашим именем.">
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className={inputClass} placeholder="Уточнили на созвоне" />
          </Field>
        </div>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          <SurveyTab userId={p.id} canEdit={canEditSurvey} onChanged={onChanged} />
        </div>
      )}
    </Modal>
  )
}
