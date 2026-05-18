export const dynamic = 'force-dynamic'

/**
 * Точка А — снимок текущего состояния бизнеса.
 *
 * Rebuilt to mirror the mockup AIStart_PointA.html:
 *   - Sticky topbar: breadcrumb + anketa-fill status pill + actions
 *   - Hero layout: 3 cards (current → 12mo → 3yr) + Goal inputs + GRI CTA
 *   - Data actions row: 2 big CTAs (заполнить анкету / загрузить файлы)
 *   - Key metrics: 6 KPI cards with status colors + zone summary
 *   - Diagnostics: 5 blocks (Финансы/Продажи/Операции/Маркетинг/Стратегия)
 *   - AI Questions: clarifying questions block
 *   - File area: drag-drop uploader
 *
 * Reuses existing components: HeroGoalsBlock, AiQuestionsBlock,
 * MedicalAuditPanel (medical vertical only), FileArea.
 */

import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { auth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { FileArea } from '@/components/point-a/FileArea'
import { HeroGoalsBlock } from '@/components/dashboard/HeroGoalsBlock'
import { AiQuestionsBlock } from '@/components/dashboard/AiQuestionsBlock'
import { MedicalAuditPanel } from '@/components/medical/MedicalAuditPanel'
import { readBlockScores } from '@/lib/diagnostics-shape'

export const metadata: Metadata = { title: 'Точка А — Текущее состояние' }

interface DomainScore {
  id: string
  label: string
  score: number
  max: number
  icon: string
}

const DOMAIN_META: Record<string, { label: string; icon: string }> = {
  finance:    { label: 'Финансы',    icon: 'payments' },
  sales:      { label: 'Продажи',    icon: 'trending_up' },
  operations: { label: 'Операции',   icon: 'settings' },
  marketing:  { label: 'Маркетинг',  icon: 'campaign' },
  strategy:   { label: 'Стратегия',  icon: 'flag' },
}

export default async function PointAPage() {
  const session = await auth()
  const cookieStore = await cookies()
  const staffUserId = cookieStore.get('aistart360_user_id')?.value ?? null

  let supabaseUserId: string | null = null
  let vertical: string | null = null
  try {
    const supabase = await createClient()
    const { data: { user: sbUser } } = await supabase.auth.getUser()
    supabaseUserId = sbUser?.id ?? null
  } catch { /* not logged in via Supabase */ }

  const clientId = staffUserId ?? supabaseUserId ?? session?.user?.id ?? null

  // ── Fetch: vertical + diagnostics + survey + docs ──
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const H = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }

  let docsCount = 0
  let overallScore = 0
  let domainScores: DomainScore[] = []
  let anketaFilledCount = 0
  let anketaTotal = 8

  if (clientId) {
    try {
      const [profileRes, docsRes, diagRes, surveyRes] = await Promise.all([
        fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${clientId}&select=vertical`, { headers: H, cache: 'no-store' }),
        fetch(`${supabaseUrl}/rest/v1/documents?user_id=eq.${clientId}&select=id`, { headers: H, cache: 'no-store' }),
        fetch(`${supabaseUrl}/rest/v1/diagnostics?user_id=eq.${clientId}&order=calculated_at.desc&limit=1`, { headers: H, cache: 'no-store' }),
        fetch(`${supabaseUrl}/rest/v1/survey_answers?user_id=eq.${clientId}&select=question_key,answer&limit=200`, { headers: H, cache: 'no-store' }),
      ])

      if (profileRes.ok) {
        const rows = await profileRes.json() as Array<{ vertical: string }>
        vertical = rows[0]?.vertical ?? null
      }
      if (docsRes.ok) {
        const rows = await docsRes.json() as Array<{ id: string }>
        docsCount = rows.length
      }
      if (diagRes.ok) {
        const rows = await diagRes.json() as Array<Record<string, unknown>>
        const d = rows[0]
        if (d) {
          overallScore = (d.overall_score as number) ?? 0
          // Schema stores 5 separate JSONB columns. readBlockScores normalizes
          // them into a unified map regardless of which shape is present.
          const blockScores = readBlockScores(d)
          for (const [id, meta] of Object.entries(DOMAIN_META)) {
            const bs = blockScores[id as keyof typeof blockScores]
            if (bs) {
              domainScores.push({
                id, label: meta.label, icon: meta.icon,
                score: Math.round(bs.score ?? 0),
                max: bs.max ?? 10,
              })
            }
          }
        }
      }

      // Anketa fill: count distinct non-empty answers.
      // Medical vertical = 8 fields; generic = 12 (rough).
      if (surveyRes.ok) {
        const rows = await surveyRes.json() as Array<{ question_key: string; answer: { value?: string } | null }>
        const filled = new Set<string>()
        const prefix = vertical === 'medical' ? 'medical_' : ''
        for (const r of rows) {
          if (prefix && !r.question_key.startsWith(prefix)) continue
          const v = (r.answer?.value ?? '').toString().trim()
          if (v.length > 0) filled.add(r.question_key)
        }
        anketaFilledCount = filled.size
      }
      anketaTotal = vertical === 'medical' ? 8 : 12
    } catch { /* silent */ }
  }

  const anketaPct = anketaTotal > 0 ? Math.min(100, Math.round((anketaFilledCount / anketaTotal) * 100)) : 0
  const pillTone =
    anketaPct >= 80 ? 'bg-primary/15 text-primary border-primary/30' :
    anketaPct >= 50 ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' :
    'bg-error/15 text-error border-error/30'

  return (
    <div className="space-y-6">
      {/* ── Sticky topbar: breadcrumb + status pill + actions ── */}
      <header className="sticky top-0 z-10 -mx-6 px-6 py-3 bg-surface/85 backdrop-blur-md border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-on-surface-variant min-w-0">
            <span>Контур 1</span>
            <span className="opacity-40">›</span>
            <span className="text-on-surface font-semibold truncate">Точка А</span>
          </div>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-semibold border ${pillTone}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
            Данные заполнены · {anketaPct}% ({anketaFilledCount}/{anketaTotal})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/client/onboarding"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.08] bg-surface-container hover:border-primary/30 text-xs text-on-surface-variant hover:text-on-surface transition-all"
          >
            <span className="material-symbols-outlined text-[14px]">edit_note</span>
            Внести данные
          </Link>
          <Link
            href="/gri"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-on-primary hover:bg-primary/90 text-xs font-semibold transition-all"
          >
            <span className="material-symbols-outlined text-[14px]">verified</span>
            Подтвердить Точку А
          </Link>
        </div>
      </header>

      {/* ── Hero: 3 cards + goal inputs + GRI CTA ── */}
      <HeroGoalsBlock />

      {/* ── Data actions: 2 big CTAs ── */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Link
          href="/client/onboarding"
          className="group flex items-center gap-4 p-4 rounded-2xl bg-surface-container-low border border-white/[0.06] hover:border-primary/30 hover:bg-surface-container transition-all"
        >
          <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-2xl text-primary">edit_document</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-on-surface">Внести данные</h3>
              <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${pillTone}`}>
                {anketaPct}%
              </span>
            </div>
            <p className="text-[11px] text-on-surface-variant mt-0.5">Открыть анкету компании · {anketaTotal} блоков</p>
          </div>
          <span className="material-symbols-outlined text-on-surface-variant group-hover:text-primary group-hover:translate-x-1 transition-all">arrow_forward</span>
        </Link>
        <Link
          href="/client/onboarding/documents"
          className="group flex items-center gap-4 p-4 rounded-2xl bg-surface-container-low border border-white/[0.06] hover:border-primary/30 hover:bg-surface-container transition-all"
        >
          <div className="w-12 h-12 rounded-xl bg-blue-500/15 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-2xl text-blue-300">upload_file</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-on-surface">Загрузить файлы</h3>
              <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30">
                {docsCount}
              </span>
            </div>
            <p className="text-[11px] text-on-surface-variant mt-0.5">Отчёты, P&L, база клиентов · xlsx, csv, pdf</p>
          </div>
          <span className="material-symbols-outlined text-on-surface-variant group-hover:text-primary group-hover:translate-x-1 transition-all">arrow_forward</span>
        </Link>
      </section>

      {/* ── Diagnostics blocks (5 categories) ── */}
      {domainScores.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between border-b border-outline-variant/10 pb-3 mb-4">
            <div>
              <h2 className="font-headline text-lg font-bold text-on-surface">Диагностика по блокам</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">Текущий уровень по каждому направлению · Общий балл {overallScore}/100</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {domainScores.map((d) => {
              const pct = d.max > 0 ? (d.score / d.max) * 100 : 0
              const tone = pct >= 70 ? 'green' : pct >= 50 ? 'yellow' : 'red'
              const toneBorder = tone === 'red' ? 'border-l-error' : tone === 'yellow' ? 'border-l-amber-400' : 'border-l-primary'
              const toneFill = tone === 'red' ? 'bg-error' : tone === 'yellow' ? 'bg-amber-400' : 'bg-primary'
              const toneText = tone === 'red' ? 'text-error' : tone === 'yellow' ? 'text-amber-300' : 'text-primary'
              const toneLabel = tone === 'red' ? 'Критично' : tone === 'yellow' ? 'Средне' : 'Сильно'
              return (
                <div
                  key={d.id}
                  className={`bg-surface-container-low border border-white/[0.06] border-l-[3px] ${toneBorder} rounded-2xl p-4`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-9 h-9 rounded-xl bg-surface-container flex items-center justify-center">
                      <span className={`material-symbols-outlined text-lg ${toneText}`}>{d.icon}</span>
                    </div>
                    <span className={`text-[9px] font-mono font-bold uppercase px-2 py-0.5 rounded-full bg-current/10 ${toneText}`}>
                      {toneLabel}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-on-surface mb-2">{d.label}</h3>
                  <div className="flex items-end justify-between mb-2">
                    <span className={`text-2xl font-mono font-bold ${toneText}`}>{d.score}</span>
                    <span className="text-[10px] text-on-surface-variant font-mono">/ {d.max}</span>
                  </div>
                  <div className="h-1.5 bg-surface-container rounded-full overflow-hidden">
                    <div className={`h-full ${toneFill} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Medical audit (full) — only for medical vertical ── */}
      {vertical === 'medical' && (
        <section>
          <div className="flex items-baseline justify-between border-b border-outline-variant/10 pb-3 mb-4">
            <h2 className="font-headline text-lg font-bold text-on-surface">AI-аудит клиники</h2>
            <span className="text-xs text-on-surface-variant">RFM · Связки · Карта потерь</span>
          </div>
          <MedicalAuditPanel />
        </section>
      )}

      {/* ── AI Questions ── */}
      <section>
        <AiQuestionsBlock />
      </section>

      {/* ── File area ── */}
      <section className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300">
        <FileArea userId={clientId ?? ''} />
      </section>
    </div>
  )
}
