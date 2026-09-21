'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { Button, EmptyState, Field, GigaApiError, Panel, gigaFetch, inputClass } from '../kit'
import { useWorkspace } from '../WorkspaceContext'
import { SURVEY_LABELS } from '@/lib/survey-labels'

/**
 * Поиск по ОТВЕТАМ анкеты: «кто жалуется на найм», «у кого выручка выше N».
 *
 * Обычный поиск в списке ищет по имени и компании — сегментировать под
 * предложение им нельзя. Здесь ищем внутри ответов и показываем, что именно
 * совпало, чтобы не открывать каждую анкету ради проверки.
 */

interface Match { key: string; label: string; value: string }
interface Hit { id: string; name: string; email: string | null; matches: Match[] }

const NUMERIC_KEYS = Object.keys(SURVEY_LABELS)
  .filter((k) => /revenue|profit|count|employee|margin|checks|clients/i.test(k))
  .slice(0, 40)

export function AnswerSearch() {
  const { base } = useWorkspace()
  const [q, setQ] = useState('')
  const [key, setKey] = useState('')
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  const [busy, setBusy] = useState(false)
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [error, setError] = useState('')

  const run = async () => {
    if (!q.trim() && !key) {
      setError('Введите текст или выберите вопрос с числом')
      return
    }
    setError('')
    setBusy(true)
    try {
      const p = new URLSearchParams()
      if (q.trim()) p.set('q', q.trim())
      if (key) p.set('key', key)
      if (min.trim()) p.set('min', min.trim())
      if (max.trim()) p.set('max', max.trim())
      const res = await gigaFetch<{ data: Hit[]; total: number }>(`/api/giga-admin/surveys/search?${p.toString()}`)
      setHits(res.data)
    } catch (e) {
      setError(e instanceof GigaApiError ? e.message : 'Поиск не выполнен')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      className="mb-4"
      title={<span className="flex items-center gap-2"><Search size={14} className="text-blue-300" /> Поиск по ответам</span>}
      description="Ищет внутри анкет, а не по названиям клиентов. Текст и число можно совмещать."
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Текст в ответе" hint="Например: найм, текучка, маркетплейс.">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void run() }}
            maxLength={120}
            className={inputClass}
            placeholder="найм"
          />
        </Field>
        <Field label="Вопрос с числом (необязательно)">
          <select value={key} onChange={(e) => setKey(e.target.value)} className={inputClass}>
            <option value="">Не важно</option>
            {NUMERIC_KEYS.map((k) => <option key={k} value={k}>{SURVEY_LABELS[k]}</option>)}
          </select>
        </Field>
        <Field label="Не меньше">
          <input value={min} onChange={(e) => setMin(e.target.value)} inputMode="numeric" className={inputClass} placeholder="100000000" />
        </Field>
        <Field label="Не больше">
          <input value={max} onChange={(e) => setMax(e.target.value)} inputMode="numeric" className={inputClass} placeholder="—" />
        </Field>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-[11px] text-red-300">{error}</p>
        <Button variant="primary" icon={<Search size={13} />} loading={busy} onClick={() => void run()}>Найти</Button>
      </div>

      {hits && (
        hits.length ? (
          <div className="mt-3 border-t border-white/[0.06] pt-3">
            <p className="mb-2 text-[11px] text-slate-500">Найдено клиентов: {hits.length}</p>
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {hits.map((h) => (
                <li key={h.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <Link href={`${base}/users/${h.id}`} className="text-sm text-slate-100 hover:text-blue-300">{h.name}</Link>
                  <ul className="mt-1 space-y-0.5">
                    {h.matches.map((m) => (
                      <li key={m.key} className="text-[11px] text-slate-500">
                        <span className="text-slate-400">{m.label}:</span> {m.value}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="mt-3 border-t border-white/[0.06] pt-3">
            <EmptyState title="Никто не подошёл" text="Попробуйте другое слово или уберите числовой фильтр." />
          </div>
        )
      )}
    </Panel>
  )
}
