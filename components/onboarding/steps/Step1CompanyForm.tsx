'use client'

import React, { useEffect, useState } from 'react'
import { Paperclip, FileCheck2, Loader2, X } from 'lucide-react'
import { FieldLabel } from '@/components/onboarding/shared'
import {
  INDUSTRIES,
  REGIONS,
  COMPANY_STAGES,
  BUSINESS_MODELS,
} from '@/components/onboarding/constants/options'
import { createClient } from '@/lib/supabase/client'

/* ─── Types ────────────────────────────────────────────────────────────────── */
interface Step1CompanyFormProps {
  data: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  userId?: string
}

interface StoredFile {
  path: string
  name: string
  size: number
  kind: 'sales_report' | 'crm_export'
  uploaded_at: string
}

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB (Supabase plan cap)
const BUCKET = 'client-documents'

/* ─── Helpers ──────────────────────────────────────────────────────────────── */
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' ? v : 0)
const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : [])
const files = (v: unknown): StoredFile[] =>
  Array.isArray(v) ? (v as StoredFile[]) : []
const fmtMoney = (n: number): string =>
  n > 0 ? new Intl.NumberFormat('ru-RU').format(n) : ''

/* ─── Component ────────────────────────────────────────────────────────────── */
export default function Step1CompanyForm({
  data,
  onChange,
  userId,
}: Step1CompanyFormProps) {
  const toggleRegion = (opt: string) => {
    const current = arr(data.s1_regions)
    onChange(
      's1_regions',
      current.includes(opt) ? current.filter((v) => v !== opt) : [...current, opt],
    )
  }

  // ── Revenue auto-calc: month × 12 → year (on change of month field) ──────
  useEffect(() => {
    const m = num(data.s1_goal_12m_revenue_month)
    const expected = m * 12
    if (num(data.s1_goal_12m_revenue_year) !== expected) {
      onChange('s1_goal_12m_revenue_year', expected)
    }
    // Intentional: only track month changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.s1_goal_12m_revenue_month])

  useEffect(() => {
    const m = num(data.s1_goal_3y_revenue_month)
    const expected = m * 12
    if (num(data.s1_goal_3y_revenue_year) !== expected) {
      onChange('s1_goal_3y_revenue_year', expected)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.s1_goal_3y_revenue_month])

  // ── File uploads (to Supabase Storage 'client-documents' bucket) ─────────
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const [uploadError, setUploadError] = useState<string | null>(null)

  const uploadFiles = async (kind: StoredFile['kind'], fileList: FileList | null) => {
    if (!fileList || !userId) return
    const list = Array.from(fileList)
    const tooBig = list.find((f) => f.size > MAX_FILE_SIZE)
    if (tooBig) {
      setUploadError(`Файл «${tooBig.name}» больше 50 МБ (лимит хранилища)`)
      return
    }
    setUploadError(null)
    setUploading((u) => ({ ...u, [kind]: true }))

    const sb = createClient()
    const saved: StoredFile[] = []
    for (const f of list) {
      const safeName = f.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
      const path = `${userId}/${kind}/${Date.now()}_${safeName}`
      const { error } = await sb.storage
        .from(BUCKET)
        .upload(path, f, { contentType: f.type, upsert: false })
      if (error) {
        setUploadError(`Ошибка загрузки ${f.name}: ${error.message}`)
        continue
      }
      saved.push({
        path,
        name: f.name,
        size: f.size,
        kind,
        uploaded_at: new Date().toISOString(),
      })
    }

    const current = files(data.s1_uploaded_files)
    onChange('s1_uploaded_files', [...current, ...saved])
    setUploading((u) => ({ ...u, [kind]: false }))
  }

  const removeFile = async (p: string) => {
    const current = files(data.s1_uploaded_files)
    const target = current.find((f) => f.path === p)
    if (!target) return
    try {
      const sb = createClient()
      await sb.storage.from(BUCKET).remove([p])
    } catch {
      // silent — metadata cleanup matters more than storage cleanup
    }
    onChange('s1_uploaded_files', current.filter((f) => f.path !== p))
  }

  const uploadedByKind = (kind: StoredFile['kind']) =>
    files(data.s1_uploaded_files).filter((f) => f.kind === kind)

  return (
    <div className="space-y-8">
      {/* ── Основная информация ─────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">apartment</span>
          Основная информация
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <FieldLabel htmlFor="s1_company_name">Название компании</FieldLabel>
            <input
              id="s1_company_name"
              type="text"
              value={str(data.s1_company_name)}
              onChange={(e) => onChange('s1_company_name', e.target.value)}
              placeholder="ООО «Компания»"
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
            />
          </div>
          <div>
            <FieldLabel htmlFor="s1_industry">Отрасль</FieldLabel>
            <select
              id="s1_industry"
              value={str(data.s1_industry)}
              onChange={(e) => onChange('s1_industry', e.target.value)}
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all appearance-none"
            >
              <option value="">— Выберите —</option>
              {INDUSTRIES.map((ind) => (
                <option key={ind} value={ind}>
                  {ind}
                </option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="s1_employee_count">Кол-во сотрудников</FieldLabel>
            <input
              id="s1_employee_count"
              type="number"
              min={0}
              value={num(data.s1_employee_count) || ''}
              onChange={(e) => onChange('s1_employee_count', Number(e.target.value) || 0)}
              placeholder="10"
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
            />
          </div>
          <div>
            <FieldLabel htmlFor="s1_business_model">Бизнес-модель</FieldLabel>
            <select
              id="s1_business_model"
              value={str(data.s1_business_model)}
              onChange={(e) => onChange('s1_business_model', e.target.value)}
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all appearance-none"
            >
              <option value="">— Выберите —</option>
              {BUSINESS_MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="s1_years_on_market">Лет на рынке</FieldLabel>
            <input
              id="s1_years_on_market"
              type="number"
              min={0}
              value={num(data.s1_years_on_market) || ''}
              onChange={(e) => onChange('s1_years_on_market', Number(e.target.value) || 0)}
              placeholder="5"
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
            />
          </div>
          <div>
            <FieldLabel htmlFor="s1_website">Веб-сайт</FieldLabel>
            <input
              id="s1_website"
              type="text"
              value={str(data.s1_website)}
              onChange={(e) => onChange('s1_website', e.target.value)}
              placeholder="https://example.com"
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
            />
          </div>
          <div className="md:col-span-2">
            <FieldLabel htmlFor="s1_social_media">
              Социальные сети компании / владельца
            </FieldLabel>
            <input
              id="s1_social_media"
              type="text"
              value={str(data.s1_social_media)}
              onChange={(e) => onChange('s1_social_media', e.target.value)}
              placeholder="Ссылки на Instagram, Telegram, и т.д."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
            />
          </div>
          {/* Regions multi-select */}
          <div className="md:col-span-2">
            <FieldLabel>Регионы</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {REGIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggleRegion(opt)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                    arr(data.s1_regions).includes(opt)
                      ? 'bg-primary/20 border-primary/50 text-primary'
                      : 'bg-surface-container border-white/[0.08] text-on-surface-variant hover:border-white/20'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Документы (новый блок) ──────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <Paperclip size={16} className="text-primary" />
          Документы компании
        </h3>
        <p className="text-xs text-on-surface-variant mb-3">
          До 50 МБ на файл. Поддерживается несколько файлов. Файлы сохраняются в
          защищённом хранилище.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FileUploadCard
            label="Загрузка данных за 3 года"
            hint="Отчёт по продажам — AI проанализирует и заполнит поля автоматически"
            kind="sales_report"
            disabled={!userId}
            uploading={!!uploading.sales_report}
            items={uploadedByKind('sales_report')}
            onSelect={(fl) => uploadFiles('sales_report', fl)}
            onRemove={removeFile}
          />
          <FileUploadCard
            label="Загрузка данных за 3 года"
            hint="Данные из CRM — AI проанализирует и заполнит поля автоматически"
            kind="crm_export"
            disabled={!userId}
            uploading={!!uploading.crm_export}
            items={uploadedByKind('crm_export')}
            onSelect={(fl) => uploadFiles('crm_export', fl)}
            onRemove={removeFile}
          />
        </div>

        {uploadError && (
          <p className="mt-3 text-xs text-red-400">{uploadError}</p>
        )}
      </section>

      {/* ── Ключевые цели (новый блок с авто-расчётом) ──────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">flag</span>
          Ключевые цели
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Цель на 12 мес */}
          <div className="rounded-xl bg-surface-container border border-white/[0.06] p-4">
            <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-3">
              Цель на 12 месяцев
            </p>
            <div className="space-y-3">
              <div>
                <FieldLabel htmlFor="s1_goal_12m_revenue_month">Выручка / месяц, ₸</FieldLabel>
                <input
                  id="s1_goal_12m_revenue_month"
                  type="number"
                  min={0}
                  value={num(data.s1_goal_12m_revenue_month) || ''}
                  onChange={(e) => onChange('s1_goal_12m_revenue_month', Number(e.target.value) || 0)}
                  placeholder="1 500 000"
                  className="w-full bg-surface-container-high border border-white/[0.08] rounded-lg px-3 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50"
                />
              </div>
              <div>
                <FieldLabel htmlFor="s1_goal_12m_revenue_year">
                  Выручка / год, ₸ (автоматически)
                </FieldLabel>
                <input
                  id="s1_goal_12m_revenue_year"
                  type="text"
                  readOnly
                  value={fmtMoney(num(data.s1_goal_12m_revenue_year))}
                  placeholder="—"
                  className="w-full bg-black/20 border border-white/[0.04] rounded-lg px-3 py-2.5 text-sm text-on-surface-variant cursor-not-allowed"
                />
              </div>
            </div>
          </div>

          {/* Цель через 3 года */}
          <div className="rounded-xl bg-surface-container border border-white/[0.06] p-4">
            <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-3">
              Цель через 3 года
            </p>
            <div className="space-y-3">
              <div>
                <FieldLabel htmlFor="s1_goal_3y_revenue_month">Выручка / месяц, ₸</FieldLabel>
                <input
                  id="s1_goal_3y_revenue_month"
                  type="number"
                  min={0}
                  value={num(data.s1_goal_3y_revenue_month) || ''}
                  onChange={(e) => onChange('s1_goal_3y_revenue_month', Number(e.target.value) || 0)}
                  placeholder="5 000 000"
                  className="w-full bg-surface-container-high border border-white/[0.08] rounded-lg px-3 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50"
                />
              </div>
              <div>
                <FieldLabel htmlFor="s1_goal_3y_revenue_year">
                  Выручка / год, ₸ (автоматически)
                </FieldLabel>
                <input
                  id="s1_goal_3y_revenue_year"
                  type="text"
                  readOnly
                  value={fmtMoney(num(data.s1_goal_3y_revenue_year))}
                  placeholder="—"
                  className="w-full bg-black/20 border border-white/[0.04] rounded-lg px-3 py-2.5 text-sm text-on-surface-variant cursor-not-allowed"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Продукты ──────────────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">inventory_2</span>
          Продукты и конкуренты
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <FieldLabel htmlFor="s1_products_list">Список продуктов / услуг</FieldLabel>
            <textarea
              id="s1_products_list"
              rows={3}
              value={str(data.s1_products_list)}
              onChange={(e) => onChange('s1_products_list', e.target.value)}
              placeholder="Перечислите основные продукты или услуги..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>
          <div>
            <FieldLabel htmlFor="s1_competitors_list">Основные конкуренты</FieldLabel>
            <textarea
              id="s1_competitors_list"
              rows={3}
              value={str(data.s1_competitors_list)}
              onChange={(e) => onChange('s1_competitors_list', e.target.value)}
              placeholder="Перечислите основных конкурентов..."
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all resize-none"
            />
          </div>
        </div>
      </section>

      {/* ── Контакты ──────────────────────────────────────────────────────── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-on-surface mb-4">
          <span className="material-symbols-outlined text-primary text-lg">contact_phone</span>
          Контактное лицо
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <FieldLabel htmlFor="s1_contact_name">ФИО</FieldLabel>
            <input
              id="s1_contact_name"
              type="text"
              value={str(data.s1_contact_name)}
              onChange={(e) => onChange('s1_contact_name', e.target.value)}
              placeholder="Иванов Иван Иванович"
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
            />
          </div>
          <div>
            <FieldLabel htmlFor="s1_contact_position">Должность</FieldLabel>
            <input
              id="s1_contact_position"
              type="text"
              value={str(data.s1_contact_position)}
              onChange={(e) => onChange('s1_contact_position', e.target.value)}
              placeholder="Директор"
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
            />
          </div>
          <div>
            <FieldLabel htmlFor="s1_contact_phone">Телефон</FieldLabel>
            <input
              id="s1_contact_phone"
              type="text"
              value={str(data.s1_contact_phone)}
              onChange={(e) => onChange('s1_contact_phone', e.target.value)}
              placeholder="+7 (777) 123-45-67"
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
            />
          </div>
          <div>
            <FieldLabel htmlFor="s1_contact_email">Email</FieldLabel>
            <input
              id="s1_contact_email"
              type="email"
              value={str(data.s1_contact_email)}
              onChange={(e) => onChange('s1_contact_email', e.target.value)}
              placeholder="info@company.kz"
              className="w-full bg-surface-container border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
            />
          </div>
        </div>
      </section>
    </div>
  )
}

/* ─── File upload card ─────────────────────────────────────────────────────── */
interface FileUploadCardProps {
  label: string
  hint: string
  kind: StoredFile['kind']
  disabled: boolean
  uploading: boolean
  items: StoredFile[]
  onSelect: (fl: FileList | null) => void
  onRemove: (path: string) => void
}

function FileUploadCard({
  label,
  hint,
  kind,
  disabled,
  uploading,
  items,
  onSelect,
  onRemove,
}: FileUploadCardProps) {
  const inputId = `s1_upload_${kind}`
  return (
    <div className="rounded-xl bg-surface-container border border-white/[0.06] p-4">
      <label
        htmlFor={inputId}
        className={`flex items-center gap-3 cursor-pointer rounded-lg border border-dashed border-white/[0.12] hover:border-primary/40 bg-black/10 hover:bg-primary/5 px-4 py-3 transition-all ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        }`}
      >
        {uploading ? (
          <Loader2 size={18} className="text-primary animate-spin flex-shrink-0" />
        ) : (
          <Paperclip size={18} className="text-primary flex-shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-on-surface truncate">{label}</p>
          <p className="text-[11px] text-on-surface-variant truncate">{hint}</p>
        </div>
      </label>
      <input
        id={inputId}
        type="file"
        multiple
        disabled={disabled || uploading}
        className="hidden"
        onChange={(e) => onSelect(e.target.files)}
      />

      {items.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {items.map((f) => (
            <li
              key={f.path}
              className="flex items-center gap-2 text-xs bg-black/20 rounded-md px-2 py-1.5"
            >
              <FileCheck2 size={13} className="text-primary flex-shrink-0" />
              <span className="flex-1 truncate text-on-surface">{f.name}</span>
              <span className="text-on-surface-variant flex-shrink-0">
                {(f.size / 1024 / 1024).toFixed(1)} МБ
              </span>
              <button
                type="button"
                onClick={() => onRemove(f.path)}
                className="text-on-surface-variant/60 hover:text-red-400 flex-shrink-0"
                aria-label="Удалить"
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
