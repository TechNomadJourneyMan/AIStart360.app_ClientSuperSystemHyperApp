'use client'

import { useState } from 'react'

const REPORTS = [
  { id: 'r1', name: 'GRI Full Report Q4 2025',       type: 'pdf',  size: '2.4 MB', date: '24 Mar 2026', status: 'ready',   category: 'GRI'       },
  { id: 'r2', name: 'Financial Health Analysis H2',  type: 'xlsx', size: '1.1 MB', date: '22 Mar 2026', status: 'ready',   category: 'Financial' },
  { id: 'r3', name: 'Growth Roadmap 2026',           type: 'pdf',  size: '3.8 MB', date: '20 Mar 2026', status: 'review',  category: 'Growth'    },
  { id: 'r4', name: 'Market Expansion Research',     type: 'pdf',  size: '5.2 MB', date: '18 Mar 2026', status: 'ready',   category: 'Market'    },
  { id: 'r5', name: 'Q1 2026 Preliminary Data',      type: 'xlsx', size: '890 KB', date: 'In progress', status: 'pending', category: 'Data'      },
]

const STATUS_STYLES = {
  ready:   { text: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/20', label: 'Готов' },
  review:  { text: 'text-tertiary-container', bg: 'bg-tertiary-container/10', border: 'border-tertiary-container/20', label: 'На проверке' },
  pending: { text: 'text-on-surface-variant', bg: 'bg-surface-container', border: 'border-white/[0.06]', label: 'В ожидании' },
}

const TYPE_ICONS = { pdf: 'picture_as_pdf', xlsx: 'table_chart' }

export default function ExpertReportsPage() {
  const [dragging, setDragging] = useState(false)
  const [filter, setFilter] = useState('Все')
  const categories = ['Все', 'GRI', 'Financial', 'Growth', 'Market', 'Data']

  const filtered = filter === 'Все' ? REPORTS : REPORTS.filter(r => r.category === filter)

  return (
    <div className="space-y-8">
      <section>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">Expert Portal</p>
        <h1 className="font-headline text-3xl font-extrabold text-on-surface">Отчёты</h1>
        <p className="text-on-surface-variant mt-2 text-sm">Ваши аналитические отчёты и загруженные данные</p>
      </section>

      {/* Upload zone */}
      <section
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false) }}
        className={`
          rounded-2xl border-2 border-dashed p-8 text-center transition-all cursor-pointer
          ${dragging
            ? 'border-primary bg-primary/5'
            : 'border-white/[0.08] hover:border-primary/30 hover:bg-white/[0.02]'}
        `}
      >
        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <span className="material-symbols-outlined text-2xl text-primary">upload_file</span>
        </div>
        <p className="text-sm font-medium text-on-surface mb-1">
          {dragging ? 'Отпустите файл для загрузки' : 'Перетащите файл или нажмите для выбора'}
        </p>
        <p className="text-xs text-on-surface-variant">PDF, XLSX, CSV · Maximum 50 MB</p>
        <button className="mt-4 text-xs font-mono text-primary bg-primary/10 border border-primary/20 hover:bg-primary/20 px-5 py-2 rounded-xl transition-colors">
          Выбрать файл
        </button>
      </section>

      {/* Reports list */}
      <section>
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-headline text-lg font-bold text-on-surface">Мои отчёты</h2>
          <div className="flex gap-2">
            {categories.map((c) => (
              <button key={c} onClick={() => setFilter(c)}
                className={`text-xs font-mono px-3 py-1.5 rounded-full border transition-colors ${
                  filter === c ? 'bg-primary/10 text-primary border-primary/20' : 'text-on-surface-variant border-white/[0.06] hover:border-white/[0.12] hover:text-on-surface'
                }`}>
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.04]">
                {['Отчёт', 'Категория', 'Размер', 'Дата', 'Статус', ''].map((h) => (
                  <th key={h} className="text-left text-[10px] font-mono text-on-surface-variant uppercase tracking-widest px-5 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const s = STATUS_STYLES[r.status as keyof typeof STATUS_STYLES]
                return (
                  <tr key={r.id} className="border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${r.type === 'pdf' ? 'bg-error/10' : 'bg-primary/10'}`}>
                          <span className={`material-symbols-outlined text-base ${r.type === 'pdf' ? 'text-error' : 'text-primary'}`}>
                            {TYPE_ICONS[r.type as keyof typeof TYPE_ICONS]}
                          </span>
                        </div>
                        <span className="text-sm font-medium text-on-surface">{r.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs font-mono bg-surface-container text-on-surface-variant px-2 py-0.5 rounded-md">{r.category}</span>
                    </td>
                    <td className="px-5 py-3.5 text-sm font-mono text-on-surface-variant">{r.size}</td>
                    <td className="px-5 py-3.5 text-sm text-on-surface-variant">{r.date}</td>
                    <td className="px-5 py-3.5">
                      <span className={`text-[10px] font-mono uppercase px-2.5 py-1 rounded-full border ${s.bg} ${s.text} ${s.border}`}>{s.label}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      {r.status === 'ready' && (
                        <button className="flex items-center gap-1 text-xs text-primary hover:underline font-mono">
                          <span className="material-symbols-outlined text-sm">download</span>
                          Скачать
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {filtered.length === 0 && (
            <div className="text-center py-16">
              <span className="material-symbols-outlined text-4xl text-on-surface-variant/20 block mb-3">description</span>
              <p className="text-sm text-on-surface-variant">Отчёты не найдены</p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
