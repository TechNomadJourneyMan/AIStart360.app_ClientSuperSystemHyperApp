'use client'

// Public web-deck on /presentation
// 12 slides · keyboard ←/→ · click dots · arrow buttons · ESC → /
// Mirrors AIStart360_Overview.pptx but optimised for browser

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

// ─── Slide registry ──────────────────────────────────────────
const SLIDES = [
  { id: 1, key: 'cover',     title: 'AIStart360' },
  { id: 2, key: 'problem',   title: 'Проблема' },
  { id: 3, key: 'solution',  title: 'Решение' },
  { id: 4, key: 'audience',  title: 'Для кого' },
  { id: 5, key: 'point-a',   title: 'Точка А' },
  { id: 6, key: 'metrics',   title: '122 метрики' },
  { id: 7, key: 'gri',       title: 'GRI Pulse' },
  { id: 8, key: 'point-b',   title: 'Точка Б + план' },
  { id: 9, key: 'parser',    title: 'AI-парсер' },
  { id: 10, key: 'stack',    title: 'Стек + интеграции' },
  { id: 11, key: 'pricing',  title: 'Тарифы' },
  { id: 12, key: 'next',     title: 'Следующие шаги' },
] as const

type SlideKey = typeof SLIDES[number]['key']

// ─── Slide content components ────────────────────────────────

function SlideShell({ eyebrow, children }: { eyebrow?: string; children: React.ReactNode }) {
  return (
    <div className="w-full h-full flex flex-col">
      {eyebrow && (
        <p className="text-xs font-mono text-primary uppercase tracking-[0.2em] mb-3">{eyebrow}</p>
      )}
      <div className="flex-1 flex flex-col">{children}</div>
    </div>
  )
}

function Cover() {
  return (
    <div className="relative w-full h-full flex flex-col justify-center">
      <div className="absolute -top-20 -right-20 w-[420px] h-[420px] bg-primary/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-20 -left-20 w-[300px] h-[300px] bg-secondary/10 rounded-full blur-3xl pointer-events-none" />
      <div className="relative">
        <p className="text-xs font-mono text-primary uppercase tracking-[0.3em] mb-5">AI-ОПЕРАЦИОНКА · 2026</p>
        <h1 className="font-headline text-7xl lg:text-9xl font-extrabold leading-[0.95] tracking-tight">AIStart360</h1>
        <p className="font-headline text-2xl lg:text-4xl text-primary mt-6 font-bold">Управляй по цифрам, а не по ощущениям</p>
        <p className="text-lg lg:text-xl text-on-surface-variant mt-6 max-w-2xl leading-relaxed">
          Платформа диагностики, метрик и плана роста для собственника малого и среднего бизнеса. AI извлекает цифры из ваших отчётов и держит руку на пульсе.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <span className="px-4 py-2 rounded-xl bg-surface-container border border-white/[0.06] text-sm">122 метрики · 7 GRI · 11 целей · 12 KPI</span>
          <span className="px-4 py-2 rounded-xl bg-surface-container border border-white/[0.06] text-sm">Pilot 30 дней — бесплатно</span>
          <span className="px-4 py-2 rounded-xl bg-primary/10 border border-primary/30 text-sm text-primary font-semibold">aistart360.vercel.app</span>
        </div>
      </div>
    </div>
  )
}

function Problem() {
  const items = [
    { v: '73%', t: 'не знают unit-эконом', d: 'CAC/LTV считают раз в год, в Excel. Маркетинг сжигает прибыль и никто не замечает.' },
    { v: '61%', t: 'консультанты «общие места»', d: 'Аудит делается, отчёт пылится. Действий ноль.' },
    { v: '84%', t: 'решают по ощущениям', d: 'Нет дашборда → нет калибровки. Решения принимаются интуитивно.' },
  ]
  return (
    <SlideShell eyebrow="ПРОБЛЕМА">
      <h2 className="font-headline text-4xl lg:text-5xl font-extrabold mb-10">Собственники не управляют бизнесом по цифрам</h2>
      <div className="grid grid-cols-3 gap-5 flex-1">
        {items.map((p) => (
          <div key={p.v} className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-7 flex flex-col">
            <div className="h-1 w-full bg-error/80 rounded-full mb-6" />
            <p className="font-headline text-6xl font-extrabold text-error">{p.v}</p>
            <p className="text-xl font-bold mt-4">{p.t}</p>
            <p className="text-sm text-on-surface-variant mt-3 leading-relaxed">{p.d}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-on-surface-variant/60 italic mt-6">* опрос 500 собственников SMB · 2025</p>
    </SlideShell>
  )
}

function Solution() {
  const mods = [
    { n: '1', icon: 'monitor_heart', t: 'Диагностика', d: 'Анкета 12 шагов + AI-парсинг P&L, баланса, CRM-выгрузок.' },
    { n: '2', icon: 'bar_chart',     t: 'Метрики',     d: '122 показателя по 7 отделам, привязанных к источникам.' },
    { n: '3', icon: 'route',         t: 'План',         d: 'Точка А → Точка Б. 11 целей, 90-дневный маршрут.' },
    { n: '4', icon: 'bolt',          t: 'Исполнение',   d: 'CRM/CDP/аналитика, Telegram + email алёрты.' },
  ]
  return (
    <SlideShell eyebrow="РЕШЕНИЕ">
      <h2 className="font-headline text-4xl lg:text-5xl font-extrabold mb-5">AIStart360 — операционка собственника</h2>
      <p className="text-lg text-on-surface-variant max-w-3xl mb-10">
        Заполняешь анкету + закидываешь отчёты → AI считает «где ты сейчас», показывает «куда двигаться» и предупреждает когда что-то идёт не так.
      </p>
      <div className="grid grid-cols-4 gap-4 flex-1">
        {mods.map((m) => (
          <div key={m.n} className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-6 flex flex-col">
            <div className="flex items-start justify-between mb-5">
              <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <span className="material-symbols-outlined text-primary">{m.icon}</span>
              </div>
              <span className="font-mono text-2xl text-on-surface-variant/40 font-bold">{m.n}</span>
            </div>
            <h3 className="font-headline text-xl font-bold">{m.t}</h3>
            <p className="text-sm text-on-surface-variant mt-2 leading-relaxed">{m.d}</p>
          </div>
        ))}
      </div>
    </SlideShell>
  )
}

function Audience() {
  const personas = [
    { n: '01', t: 'Собственник 30–45', d: 'Растущий бизнес, 20–250 сотрудников, выручка $300K–$10M.', tags: ['e-com', 'B2B услуги', 'производство', 'ритейл'] },
    { n: '02', t: 'Финансовый директор', d: 'Хочет автоматизировать отчётность и unit-эконом в realtime.', tags: ['CFO в найме', 'Head of Finance', 'аутсорс-CFO'] },
    { n: '03', t: 'Эксперт / консультант', d: 'Использует AIStart360 как платформу для клиентских проектов.', tags: ['финконсалтинг', 'growth advisor', 'ops expert'] },
  ]
  return (
    <SlideShell eyebrow="ДЛЯ КОГО">
      <h2 className="font-headline text-4xl lg:text-5xl font-extrabold mb-10">SMB с выручкой $300K — $10M / год</h2>
      <div className="grid grid-cols-3 gap-5 flex-1">
        {personas.map((p) => (
          <div key={p.n} className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-7 flex flex-col">
            <p className="font-headline text-4xl font-extrabold text-primary">{p.n}</p>
            <h3 className="font-headline text-xl font-bold mt-3">{p.t}</h3>
            <p className="text-sm text-on-surface-variant mt-3 leading-relaxed flex-1">{p.d}</p>
            <div className="flex flex-wrap gap-2 mt-5">
              {p.tags.map((t) => (
                <span key={t} className="text-xs px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 text-primary">{t}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SlideShell>
  )
}

function PointA() {
  const steps = [
    { n: '1', t: 'Анкета 12 шагов', d: 'Финансы, продажи, операции, маркетинг, команда, цели' },
    { n: '2', t: 'Загрузка документов', d: 'P&L, баланс, отчёты, выгрузка из 1С/CRM' },
    { n: '3', t: 'AI-извлечение', d: 'OpenRouter Sonnet парсит → точность 92%' },
    { n: '4', t: 'Расчёт 5 блоков', d: 'Финансы 30% · Продажи 25% · Операции 20% · Маркетинг 15% · Стратегия 10%' },
    { n: '5', t: 'GRI Score 0–100', d: 'Общий балл + health-индекс + стадия зрелости' },
  ]
  const blocks = [
    { n: 'Финансы',   v: 74, c: 'bg-primary' },
    { n: 'Продажи',   v: 82, c: 'bg-primary' },
    { n: 'Операции',  v: 41, c: 'bg-error' },
    { n: 'Маркетинг', v: 52, c: 'bg-tertiary-container' },
    { n: 'Стратегия', v: 67, c: 'bg-primary' },
  ]
  return (
    <SlideShell eyebrow="МОДУЛЬ 1">
      <h2 className="font-headline text-4xl lg:text-5xl font-extrabold mb-8">Точка А — снимок состояния</h2>
      <div className="grid grid-cols-2 gap-6 flex-1">
        <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-6">
          <p className="text-xs font-mono text-primary uppercase tracking-wider mb-5">Как формируется</p>
          <div className="space-y-3.5">
            {steps.map((st) => (
              <div key={st.n} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-primary">{st.n}</span>
                </div>
                <div>
                  <p className="text-sm font-semibold">{st.t}</p>
                  <p className="text-xs text-on-surface-variant">{st.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-6">
          <p className="text-xs font-mono text-primary uppercase tracking-wider mb-5">Что увидит собственник</p>
          <div className="flex items-center gap-5 mb-6">
            <div className="relative w-24 h-24">
              <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
                <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" className="text-primary" strokeDasharray={`${(63 / 100) * 251.2} 251.2`} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold text-primary">63</span>
                <span className="text-[10px] text-on-surface-variant">/100</span>
              </div>
            </div>
            <div>
              <p className="text-tertiary-container font-bold">Health Medium</p>
              <p className="text-sm text-on-surface mt-1">«Уверенный масштаб»</p>
              <p className="text-xs text-on-surface-variant mt-2">Сильные: продажи, продукт</p>
              <p className="text-xs text-on-surface-variant">Слабые: операции, маркетинг</p>
            </div>
          </div>
          <div className="space-y-2.5">
            {blocks.map((b) => (
              <div key={b.n} className="flex items-center gap-3">
                <p className="text-xs text-on-surface w-20 flex-shrink-0">{b.n}</p>
                <div className="flex-1 h-1.5 bg-surface-container rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${b.c}`} style={{ width: `${b.v}%` }} />
                </div>
                <span className="text-xs font-mono w-8 text-right text-on-surface-variant">{b.v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SlideShell>
  )
}

function Metrics() {
  const depts = [
    { icon: 'payments',     name: 'Финансы',   n: 8, kpi: 'Выручка · EBITDA · ROA · Cash Flow' },
    { icon: 'ads_click',    name: 'Маркетинг', n: 9, kpi: 'CAC · CPL · NPS · ER' },
    { icon: 'handshake',    name: 'Продажи',   n: 7, kpi: 'Чек · Win Rate · TTR' },
    { icon: 'settings',     name: 'Операции',  n: 7, kpi: 'SLA · SKU · Брак' },
    { icon: 'groups',       name: 'HR',         n: 6, kpi: 'Текучка · eNPS · OKR' },
    { icon: 'inventory_2',  name: 'Продукт',   n: 5, kpi: 'Доля рынка · Экспорт' },
    { icon: 'person',       name: 'Клиенты',   n: 6, kpi: 'Churn · Retention · ARPU' },
  ]
  return (
    <SlideShell eyebrow="МОДУЛЬ 2">
      <h2 className="font-headline text-4xl lg:text-5xl font-extrabold mb-3">122 метрики с привязкой к источнику</h2>
      <p className="text-on-surface-variant mb-8 max-w-3xl">Каждая метрика знает откуда брать данные: поле анкеты, выгрузка из 1С/CRM, документ, GA или внешний API.</p>
      <div className="grid grid-cols-4 gap-4 flex-1">
        {depts.map((d) => (
          <div key={d.name} className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-5 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <span className="material-symbols-outlined text-primary text-lg">{d.icon}</span>
              </div>
              <span className="font-mono text-2xl text-primary font-bold">{d.n}</span>
            </div>
            <p className="font-semibold mt-1">{d.name}</p>
            <p className="text-xs text-on-surface-variant mt-2 leading-relaxed">{d.kpi}</p>
          </div>
        ))}
        <div className="rounded-2xl border border-primary/30 bg-primary/10 p-5 flex flex-col justify-center">
          <p className="text-xs font-mono text-primary uppercase tracking-wider">ИТОГО</p>
          <p className="font-headline text-5xl font-extrabold text-primary mt-2">122</p>
          <p className="text-xs text-primary/80 mt-1">метрики</p>
        </div>
      </div>
    </SlideShell>
  )
}

function GRI() {
  const items = [
    { n: 'Бизнес-модель',          v: 7.4,  st: 'ok' },
    { n: 'Готовность основателя',  v: 6.7,  st: 'ok' },
    { n: 'Доверие и позиция',      v: 5.17, st: 'weak' },
    { n: 'Стабильность кассы',     v: 5.0,  st: 'weak' },
    { n: 'Продукт и спрос',        v: 4.7,  st: 'weak' },
    { n: 'Команда',                v: 2.55, st: 'critical' },
    { n: 'Операции',               v: 2.14, st: 'critical' },
  ]
  const clr = (st: string) => st === 'critical' ? { bar: 'bg-error', text: 'text-error' }
    : st === 'weak' ? { bar: 'bg-tertiary-container', text: 'text-tertiary-container' }
    : { bar: 'bg-primary', text: 'text-primary' }

  return (
    <SlideShell eyebrow="МОДУЛЬ 3">
      <h2 className="font-headline text-4xl lg:text-5xl font-extrabold mb-3">GRI Pulse — 7 блоков</h2>
      <p className="text-on-surface-variant mb-8 max-w-3xl">Не аудит — маршрут. Видно где «бутылочное горлышко» и куда инвестировать рубль чтобы получить пять.</p>
      <div className="grid grid-cols-3 gap-6 flex-1">
        <div className="col-span-2 rounded-2xl border border-white/[0.06] bg-surface-container-low p-6">
          <div className="space-y-3">
            {items.map((b) => {
              const c = clr(b.st)
              return (
                <div key={b.n} className="flex items-center gap-4">
                  <p className="text-sm text-on-surface w-44 flex-shrink-0">{b.n}</p>
                  <div className="flex-1 h-2 bg-surface-container rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${c.bar}`} style={{ width: `${(b.v / 10) * 100}%` }} />
                  </div>
                  <span className={`text-sm font-mono font-bold w-12 text-right ${c.text}`}>{b.v}/10</span>
                </div>
              )
            })}
          </div>
        </div>
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-6 flex flex-col">
          <p className="text-xs font-mono text-primary uppercase tracking-wider">GRI ИТОГ</p>
          <p className="font-headline text-7xl font-extrabold text-on-surface mt-3">4.7<span className="text-2xl text-on-surface-variant/60">/10</span></p>
          <p className="text-sm text-on-surface-variant mt-5 flex-1">Главный тормоз — Операции и Команда. Без них любые $$ в рекламу = слив.</p>
          <div className="mt-6 pt-5 border-t border-white/[0.06]">
            <p className="text-xs font-mono text-primary uppercase tracking-wider mb-2">Действия первой волны</p>
            <p className="text-sm text-on-surface">Регламенты процессов · KPI команды · BI-отчётность</p>
          </div>
        </div>
      </div>
    </SlideShell>
  )
}

function PointB() {
  const targets = [
    { k: 'LTV/CAC',       cur: '2.2x',   tgt: '≥3x',   p: 73 },
    { k: 'NPS',           cur: '38',     tgt: '50+',   p: 76 },
    { k: 'Retention 30d', cur: '42%',    tgt: '60%+',  p: 70 },
    { k: 'Чек',           cur: '₸180К',  tgt: '₸210К', p: 86 },
    { k: 'Win Rate',      cur: '48%',    tgt: '>50%',  p: 96 },
  ]
  const phases = [
    { p: 'Дни 1–30',  t: 'Стабилизация', c: 'border-error/40 text-error',  items: ['Регламенты опер.', 'KPI команды', 'Парсинг 3 кв.'] },
    { p: 'Дни 31–60', t: 'Атрибуция',     c: 'border-tertiary-container/40 text-tertiary-container', items: ['UTM', 'CAC по каналу', 'NPS-замер'] },
    { p: 'Дни 61–90', t: 'Рычаги',        c: 'border-primary/40 text-primary', items: ['Программа повторки', 'Апсейл', 'Реф-программа'] },
  ]
  return (
    <SlideShell eyebrow="МОДУЛЬ 4">
      <h2 className="font-headline text-4xl lg:text-5xl font-extrabold mb-8">Точка Б — план на 90 дней</h2>
      <div className="grid grid-cols-5 gap-3 mb-6">
        {targets.map((t) => (
          <div key={t.k} className="rounded-xl border border-white/[0.06] bg-surface-container-low p-4">
            <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">{t.k}</p>
            <p className="font-headline text-2xl font-bold text-primary mt-2">{t.tgt}</p>
            <p className="text-[10px] text-on-surface-variant mt-1">сейчас: {t.cur}</p>
            <div className="mt-3 h-1.5 bg-surface-container rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full" style={{ width: `${t.p}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-4 flex-1">
        {phases.map((ph) => (
          <div key={ph.p} className={`rounded-2xl border-2 ${ph.c} border-l-4 bg-surface-container-low p-5 flex flex-col`}>
            <p className={`text-xs font-mono uppercase tracking-wider font-bold ${ph.c.split(' ')[1]}`}>{ph.p}</p>
            <p className="font-headline text-xl font-bold mt-2">{ph.t}</p>
            <ul className="mt-4 space-y-2 flex-1">
              {ph.items.map((it) => (
                <li key={it} className="text-sm text-on-surface-variant flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                  {it}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </SlideShell>
  )
}

function Parser() {
  const stages = [
    { icon: 'upload_file',  t: 'Файл',          d: 'PDF · DOCX · XLSX · CSV · TXT до 50МБ' },
    { icon: 'auto_awesome', t: 'AI-парсер',     d: 'OpenRouter Sonnet · zod-валидация · fallback' },
    { icon: 'route',        t: 'Поля → отделы', d: 'Выручка → Финансы · CAC → Маркетинг · SKU → Операции' },
  ]
  const types = ['P&L отчёт', 'Бухбаланс', 'Marketing report', 'Ops report', 'CRM-export', 'Аудит', 'Прайс-лист', 'Другое']
  return (
    <SlideShell eyebrow="AI-ПАРСЕР">
      <h2 className="font-headline text-4xl lg:text-5xl font-extrabold mb-3">Документы → данные за 8 секунд</h2>
      <p className="text-on-surface-variant mb-10 max-w-3xl">Закидываете файл → AI извлекает 30–60 ключевых полей и мапит в нужные разделы дашборда.</p>
      <div className="grid grid-cols-3 gap-4 mb-8">
        {stages.map((st, i) => (
          <div key={i} className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-6">
            <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
              <span className="material-symbols-outlined text-primary">{st.icon}</span>
            </div>
            <p className="font-headline text-xl font-bold">{st.t}</p>
            <p className="text-sm text-on-surface-variant mt-2 leading-relaxed">{st.d}</p>
          </div>
        ))}
      </div>
      <p className="text-xs font-mono text-primary uppercase tracking-wider mb-3">Поддерживаемые типы</p>
      <div className="flex flex-wrap gap-2 mb-6">
        {types.map((t) => (
          <span key={t} className="px-3 py-1.5 rounded-lg bg-surface-container border border-white/[0.06] text-sm">{t}</span>
        ))}
      </div>
      <div className="rounded-2xl border border-primary/30 bg-primary/10 p-5 flex items-center gap-4">
        <span className="material-symbols-outlined text-primary text-3xl">verified</span>
        <p className="text-sm text-on-surface">
          <span className="text-primary font-semibold">47 полей за 8 секунд, точность 92%</span> · замер на P&L 3 страницы
        </p>
      </div>
    </SlideShell>
  )
}

function Stack() {
  const groups = [
    { t: 'CRM / Продажи', items: ['Bitrix24', 'AmoCRM', '1С'], desc: 'Сделки, чек, цикл закрытия, конверсия' },
    { t: 'Аналитика',     items: ['GA4', 'Yandex.Metrica', 'Meta Graph', 'TikTok'], desc: 'Атрибуция «канал → выручка», CPL, ER' },
    { t: 'Коммуникации',  items: ['Telegram', 'Resend email', 'WhatsApp'], desc: 'Алёрты, weekly digest, NPS-опросы' },
    { t: 'Стек',           items: ['Next.js 14', 'Supabase', 'Prisma', 'OpenRouter'], desc: 'Vercel deploy, pgvector, NextAuth, Inngest' },
  ]
  return (
    <SlideShell eyebrow="СТЕК + ИНТЕГРАЦИИ">
      <h2 className="font-headline text-4xl lg:text-5xl font-extrabold mb-10">Не заменяем — подключаемся</h2>
      <div className="grid grid-cols-2 gap-5 flex-1">
        {groups.map((g) => (
          <div key={g.t} className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-6 flex flex-col">
            <p className="text-xs font-mono text-primary uppercase tracking-wider font-bold mb-4">{g.t}</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {g.items.map((it) => (
                <span key={it} className="px-3 py-1.5 rounded-lg bg-surface-container border border-white/[0.06] text-sm">{it}</span>
              ))}
            </div>
            <p className="text-sm text-on-surface-variant mt-auto">{g.desc}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-on-surface-variant/60 italic mt-6">Open-core: данные клиента — на его инфраструктуре (Supabase self-host опционально)</p>
    </SlideShell>
  )
}

function Pricing() {
  return (
    <SlideShell eyebrow="ТАРИФЫ">
      <h2 className="font-headline text-4xl lg:text-5xl font-extrabold mb-10">Pilot бесплатно · Pro $300–800/мес</h2>
      <div className="grid grid-cols-2 gap-5 flex-1">
        <div className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-7 flex flex-col">
          <p className="text-xs font-mono text-on-surface-variant uppercase tracking-wider">PILOT · 30 ДНЕЙ</p>
          <p className="font-headline text-5xl font-extrabold mt-3">Бесплатно</p>
          <p className="text-on-surface-variant mt-4 flex-1">Полный доступ. Анкета + парсинг 2 кварталов. Точка А, GRI, 11 целей.</p>
          <ul className="space-y-2 mt-6">
            {['122 метрики', 'AI-парсер до 20 документов', 'Telegram + email алёрты', '1 пользователь'].map((it) => (
              <li key={it} className="flex items-center gap-2 text-sm text-on-surface-variant">
                <span className="material-symbols-outlined text-primary text-base">check</span>{it}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-7 flex flex-col relative overflow-hidden">
          <div className="absolute -top-20 -right-20 w-60 h-60 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
          <p className="text-xs font-mono text-primary uppercase tracking-wider relative">PRO · ПОДПИСКА</p>
          <p className="font-headline text-5xl font-extrabold mt-3 relative">$300–800 / мес</p>
          <p className="text-on-surface-variant mt-4 flex-1 relative">Цена зависит от объёма документов и пользователей. Окупаемость ~6 недель.</p>
          <ul className="space-y-2 mt-6 relative">
            {['Всё из Pilot', 'Безлимит парсинга', 'Bitrix24 / AmoCRM / 1С / GA', 'Эксперт-сопровождение', 'До 10 пользователей'].map((it) => (
              <li key={it} className="flex items-center gap-2 text-sm">
                <span className="material-symbols-outlined text-primary text-base">check_circle</span>{it}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-6 rounded-xl border border-primary/30 bg-primary/10 p-4 text-center">
        <p className="text-sm font-bold text-primary">Эффект через 90 дней: +15% чек · −20% CAC · +30% retention 30d</p>
      </div>
    </SlideShell>
  )
}

function Next() {
  const next = [
    { n: '01', t: 'Демо 30 минут',  d: 'Покажем платформу. Ответим на технические вопросы.', when: 'На этой неделе' },
    { n: '02', t: 'Pilot 30 дней',   d: 'Анкета + парсинг 2 кварталов. Получаешь Точку А, GRI и план.', when: 'Старт через 5 дней' },
    { n: '03', t: 'Внедрение',       d: 'Интеграция с CRM/аналитикой, обучение, monthly check-in.', when: 'После пилота' },
  ]
  return (
    <SlideShell eyebrow="СЛЕДУЮЩИЕ ШАГИ">
      <h2 className="font-headline text-4xl lg:text-5xl font-extrabold mb-10">3 шага — через 90 дней по цифрам</h2>
      <div className="space-y-4 flex-1">
        {next.map((n) => (
          <div key={n.n} className="rounded-2xl border border-white/[0.06] bg-surface-container-low p-6 flex items-center gap-6">
            <p className="font-headline text-4xl font-extrabold text-primary w-16">{n.n}</p>
            <div className="flex-1">
              <p className="font-headline text-xl font-bold">{n.t}</p>
              <p className="text-sm text-on-surface-variant mt-1">{n.d}</p>
            </div>
            <span className="px-4 py-2 rounded-xl bg-primary/10 border border-primary/30 text-sm text-primary font-semibold">{n.when}</span>
          </div>
        ))}
      </div>
      <div className="mt-6 flex items-center justify-center gap-4">
        <Link href="/register" className="bg-primary text-on-primary font-semibold px-8 py-3.5 rounded-xl flex items-center gap-2 hover:shadow-xl hover:shadow-primary/30 transition-all">
          <span className="material-symbols-outlined">rocket_launch</span>Запустить пилот
        </Link>
        <Link href="/" className="border border-white/[0.08] px-6 py-3.5 rounded-xl hover:border-primary/40 hover:text-primary transition-colors">На главную</Link>
      </div>
      <p className="text-center text-xs text-on-surface-variant mt-4">hello@aistart360.app · aistart360.vercel.app · Almaty / Tashkent</p>
    </SlideShell>
  )
}

const SLIDE_COMPONENTS: Record<SlideKey, () => JSX.Element> = {
  cover: Cover, problem: Problem, solution: Solution, audience: Audience,
  'point-a': PointA, metrics: Metrics, gri: GRI, 'point-b': PointB,
  parser: Parser, stack: Stack, pricing: Pricing, next: Next,
}

// ─── Page ────────────────────────────────────────────────────
export default function PresentationPage() {
  const [idx, setIdx] = useState(0)
  const total = SLIDES.length

  const go = useCallback((next: number) => {
    setIdx((cur) => Math.max(0, Math.min(total - 1, typeof next === 'number' ? next : cur)))
  }, [total])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); go(idx + 1) }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(idx - 1) }
      else if (e.key === 'Home') { e.preventDefault(); go(0) }
      else if (e.key === 'End') { e.preventDefault(); go(total - 1) }
      else if (e.key === 'Escape') { window.location.href = '/' }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [idx, go, total])

  const current = SLIDES[idx]
  const Component = useMemo(() => SLIDE_COMPONENTS[current.key], [current.key])

  return (
    <div className="min-h-screen bg-surface text-on-surface flex flex-col">

      {/* Top bar */}
      <header className="border-b border-white/[0.04] bg-surface/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">radar</span>
            <span className="font-headline font-extrabold">
              AIStart<span className="text-primary">360</span>
            </span>
            <span className="text-xs text-on-surface-variant/60 ml-2 hidden sm:inline">/ presentation</span>
          </Link>
          <div className="flex items-center gap-4">
            <p className="text-xs font-mono text-on-surface-variant">{idx + 1} / {total} · {current.title}</p>
            <Link href="/" className="text-xs text-on-surface-variant hover:text-primary transition-colors">
              <span className="material-symbols-outlined text-base align-middle">close</span>
            </Link>
          </div>
        </div>
        {/* Progress bar */}
        <div className="h-0.5 bg-surface-container">
          <div className="h-full bg-primary transition-all duration-300" style={{ width: `${((idx + 1) / total) * 100}%` }} />
        </div>
      </header>

      {/* Slide stage */}
      <main className="flex-1 flex items-stretch p-6 lg:p-12">
        <div className="max-w-[1400px] w-full mx-auto rounded-3xl border border-white/[0.04] bg-surface-container-low/30 p-10 lg:p-14 relative overflow-hidden">
          <Component />
        </div>
      </main>

      {/* Bottom nav */}
      <footer className="border-t border-white/[0.04] bg-surface/80 backdrop-blur-xl sticky bottom-0 z-50">
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <button
            onClick={() => go(idx - 1)}
            disabled={idx === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/[0.06] text-sm hover:border-primary/40 hover:text-primary disabled:opacity-30 disabled:hover:border-white/[0.06] disabled:hover:text-on-surface transition-colors"
          >
            <span className="material-symbols-outlined text-base">arrow_back</span>
            Назад
          </button>

          {/* Dots */}
          <div className="flex items-center gap-1.5 overflow-x-auto max-w-[60%]">
            {SLIDES.map((s, i) => (
              <button
                key={s.id}
                onClick={() => go(i)}
                aria-label={`Слайд ${i + 1}: ${s.title}`}
                title={`${i + 1}. ${s.title}`}
                className={`flex-shrink-0 h-2 rounded-full transition-all ${i === idx ? 'w-8 bg-primary' : 'w-2 bg-on-surface-variant/30 hover:bg-on-surface-variant/60'}`}
              />
            ))}
          </div>

          <button
            onClick={() => go(idx + 1)}
            disabled={idx === total - 1}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:shadow-lg hover:shadow-primary/30 disabled:opacity-30 disabled:hover:shadow-none transition-all"
          >
            Дальше
            <span className="material-symbols-outlined text-base">arrow_forward</span>
          </button>
        </div>
      </footer>
    </div>
  )
}
