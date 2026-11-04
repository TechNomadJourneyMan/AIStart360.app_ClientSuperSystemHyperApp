'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, ShieldAlert } from 'lucide-react'
import type { ProfanityCategory } from '@/lib/moderation/profanity'
import { Badge, Field, GigaApiError, Panel, Select, gigaFetch, inputClass, useDebounced } from '@/components/giga-panel/kit'

interface TestResult {
  clean: boolean
  kind: 'name' | 'text'
  filterEnabled: boolean
  matches: Array<{ word: string; category: ProfanityCategory; label: string }>
  masked: string
  dictionary: { block: number; allow: number }
}

/**
 * «Проверка текста»: сервер разбирает текст ровно так, как при сохранении
 * (встроенные правила + свежий словарь), без записи в журнал.
 */
export function TestPanel({ dictionaryVersion }: { dictionaryVersion: number }) {
  const [text, setText] = useState('')
  const [kind, setKind] = useState<'text' | 'name'>('text')
  const [result, setResult] = useState<TestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const debounced = useDebounced(text, 400)
  const seq = useRef(0)

  useEffect(() => {
    if (!debounced.trim()) { setResult(null); setError(null); return }
    const my = ++seq.current
    setChecking(true)
    gigaFetch<{ ok: true; data: TestResult }>('/api/giga-admin/content-filter/test', { method: 'POST', json: { text: debounced, kind } })
      .then((r) => { if (my === seq.current) { setResult(r.data); setError(null) } })
      .catch((e) => { if (my === seq.current) setError(e instanceof GigaApiError ? e.message : 'Не удалось проверить') })
      .finally(() => { if (my === seq.current) setChecking(false) })
  }, [debounced, kind, dictionaryVersion])

  return (
    <Panel title="Проверка текста" description="Введите текст — увидите, пропустит ли его сервер. В журнал ничего не пишется.">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Select<'text' | 'name'>
            label="Тип поля"
            value={kind}
            onChange={setKind}
            options={[{ value: 'text', label: 'Описание / ответ анкеты' }, { value: 'name', label: 'Имя / компания / должность (ссылки запрещены)' }]}
          />
          {checking && <span className="text-[11px] text-slate-500">Проверяем…</span>}
        </div>
        <Field label="Текст">
          <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} rows={4} className={inputClass} placeholder="Например: «Наш продукт — лучший на рынке»" />
        </Field>
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
        {result && !error && (
          <div aria-live="polite" className={result.clean
            ? 'rounded-xl border border-emerald-500/25 bg-emerald-500/[0.08] px-4 py-3'
            : 'rounded-xl border border-red-500/25 bg-red-500/[0.08] px-4 py-3'}
          >
            <p className={`flex items-center gap-2 text-sm font-medium ${result.clean ? 'text-emerald-200' : 'text-red-200'}`}>
              {result.clean ? <CheckCircle2 size={15} /> : <ShieldAlert size={15} />}
              {result.clean ? 'Текст будет сохранён' : 'Текст будет отклонён'}
            </p>
            {!result.clean && (
              <>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {result.matches.map((m, i) => (
                    <Badge key={`${m.word}-${i}`} tone={m.category === 'mat' ? 'red' : m.category === 'insult' ? 'amber' : m.category === 'spam' ? 'violet' : 'blue'}>
                      {m.word} · {m.label}
                    </Badge>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-slate-400">В журнале будет так: <span className="text-slate-300">{result.masked}</span></p>
              </>
            )}
            <p className="mt-2 text-[10px] text-slate-500">
              Словарь: запрещённых {result.dictionary.block}, исключений {result.dictionary.allow}.
              {!result.filterEnabled && ' Фильтр сейчас выключен в настройках — на сайте текст сохранится без проверки.'}
            </p>
          </div>
        )}
      </div>
    </Panel>
  )
}
