/**
 * CompanyDataCard — section card for /point-a showing the company profile
 * (survey progress + 12m/3y targets + collapsible 7-block survey overview).
 *
 * Data sources (all on the server, service-key reads to bypass RLS like
 * GRIAssessmentBlock does):
 *   - `survey_answers` table       → completion %, block-level fill, name/vertical/city
 *   - `companies` table            → target_revenue_12m_kzt / target_revenue_3y_kzt
 *
 * The 7 "blocks" here roughly correspond to the 12-step wizard collapsed into
 * 7 thematic groups; we use SURVEY_STEP_LABELS keys 1..12.
 */

import Link from 'next/link'
import { SURVEY_STEP_LABELS } from '@/lib/survey-labels'
import { completedStepsFromRows } from '@/lib/survey/steps'
import CompanyDataFooter from './CompanyDataFooter'

interface SurveyAnswerRow {
  step: number | null
  question_key: string
  answer: { value?: unknown } | null
}

interface CompanyRow {
  id: string
  target_revenue_12m_kzt: string | number | null
  target_revenue_3y_kzt: string | number | null
}

const TOTAL_STEPS = 12

// Thematic grouping: 12 wizard steps mapped to 7 анкета blocks.
const BLOCKS: Array<{ id: string; title: string; steps: number[]; icon: string }> = [
  { id: 'profile', title: 'Профиль компании', steps: [1], icon: 'business' },
  { id: 'finance', title: 'Финансы 2023', steps: [9], icon: 'payments' },
  { id: 'goals', title: 'Цели и стратегия', steps: [2, 6], icon: 'flag' },
  { id: 'product', title: 'Продукт и позиционирование', steps: [3], icon: 'inventory_2' },
  { id: 'org', title: 'Оргструктура', steps: [4, 11], icon: 'group' },
  { id: 'management', title: 'Управление и метрики', steps: [7, 8, 12], icon: 'tune' },
  { id: 'base', title: 'База клиентов', steps: [5, 10], icon: 'contacts' },
]

function pickStringAnswer(rows: SurveyAnswerRow[], key: string): string | null {
  const row = rows.find((r) => r.question_key === key)
  const v = row?.answer?.value
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function formatKzt(value: string | number | null | undefined): string {
  if (value == null) return '—'
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n) || n <= 0) return '—'
  // 1 234 567 890 ₸ → compact
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')} млрд ₸`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')} млн ₸`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)} тыс ₸`
  return `${Math.round(n)} ₸`
}

function monthlyFromTotal(value: string | number | null | undefined, months: number): string {
  if (value == null) return '—'
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n) || n <= 0 || months <= 0) return '—'
  return formatKzt(n / months)
}

function completionBadge(pct: number): { label: string; tone: string } {
  if (pct >= 80) return { label: `${pct}% заполнено`, tone: 'text-primary border-primary/30 bg-primary/10' }
  if (pct >= 40) return { label: `${pct}% заполнено`, tone: 'text-amber-400 border-amber-400/30 bg-amber-400/10' }
  return { label: `${pct}% заполнено`, tone: 'text-error border-error/30 bg-error/10' }
}

export default async function CompanyDataCard({ userId }: { userId: string }) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !serviceKey) return null

  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }

  let surveyRows: SurveyAnswerRow[] = []
  let company: CompanyRow | null = null

  try {
    const [surveyRes, companyRes] = await Promise.all([
      fetch(
        `${supabaseUrl}/rest/v1/survey_answers?user_id=eq.${userId}&select=step,question_key,answer`,
        { headers, cache: 'no-store' },
      ),
      fetch(
        `${supabaseUrl}/rest/v1/companies?user_id=eq.${userId}&select=id,target_revenue_12m_kzt,target_revenue_3y_kzt&limit=1`,
        { headers, cache: 'no-store' },
      ),
    ])
    if (surveyRes.ok) surveyRows = (await surveyRes.json()) as SurveyAnswerRow[]
    if (companyRes.ok) {
      const arr = (await companyRes.json()) as CompanyRow[]
      company = Array.isArray(arr) && arr[0] ? arr[0] : null
    }
  } catch (err) {
    console.error('[point-a/v2/CompanyDataCard] fetch error', err)
  }

  // ── Survey progress ─────────────────────────────────────────────────────
  // Step ownership comes from the question key, not the stored `step` column
  // (see lib/survey/steps.ts — the column was corrupted by re-saves).
  const completedSteps = new Set<number>(completedStepsFromRows(surveyRows))
  const pct = Math.round((completedSteps.size / TOTAL_STEPS) * 100)
  const badge = completionBadge(pct)

  // Determine which BLOCKS are missing (any of their steps not completed).
  const missingBlocks = BLOCKS.filter((b) => b.steps.some((s) => !completedSteps.has(s)))
  const missingNames = missingBlocks.slice(0, 3).map((b) => b.title.toLowerCase())

  // ── Sub-tile data ──────────────────────────────────────────────────────
  const companyName =
    pickStringAnswer(surveyRows, 's1_company_name') ||
    pickStringAnswer(surveyRows, 's1_brand') ||
    '—'
  const vertical =
    pickStringAnswer(surveyRows, 's1_industry') ||
    pickStringAnswer(surveyRows, 's1_niche') ||
    '—'
  const city =
    pickStringAnswer(surveyRows, 's1_city') ||
    pickStringAnswer(surveyRows, 's1_geo') ||
    '—'

  const target12m = company?.target_revenue_12m_kzt ?? null
  const target3y = company?.target_revenue_3y_kzt ?? null

  // ── Block fill stats for the collapsible footer ────────────────────────
  const blockStats = BLOCKS.map((b) => {
    const filled = b.steps.filter((s) => completedSteps.has(s)).length
    const total = b.steps.length
    const blockPct = Math.round((filled / total) * 100)
    return { ...b, filled, total, pct: blockPct }
  })

  return (
    <section>
      <div className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 sm:p-7 shadow-card">
        {/* ── Header row ─────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center border border-white/[0.06] flex-shrink-0">
              <span className="material-symbols-outlined text-2xl text-primary">corporate_fare</span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-headline text-2xl sm:text-3xl font-extrabold text-on-surface tracking-tight">
                  Данные компании
                </h2>
                <span className="text-[10px] font-mono text-primary/70 uppercase tracking-[0.18em] px-2 py-0.5 rounded-md border border-primary/15 bg-primary/[0.04]">
                  Анкета · 7 блоков
                </span>
              </div>
              <p className="text-sm text-on-surface-variant mt-1.5 leading-relaxed">
                Профиль компании, финансы, цели, продукт, оргструктура, управление, база — данные из анкеты в реальном времени
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span
              className={`text-[10px] font-mono font-bold uppercase tracking-widest px-2.5 py-1 rounded-md border ${badge.tone}`}
            >
              {badge.label}
            </span>
            <a
              href="/client/onboarding"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-white font-bold text-sm hover:brightness-110 focus:ring-2 transition-all"
              style={{
                background: 'linear-gradient(90deg, #e87a35, #dc524b)',
                boxShadow: '0 0 20px -8px rgba(232,122,53,0.55)',
              }}
            >
              <span className="material-symbols-outlined text-base">edit_note</span>
              Дополнить анкету
            </a>
          </div>
        </div>

        {/* ── Progress bar ──────────────────────────────────────────────── */}
        <div className="mb-5">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">
              Полнота анкеты
            </span>
            <span className="text-sm font-mono font-bold text-on-surface tabular-nums">{pct}%</span>
          </div>
          <div className="h-2 bg-surface-container rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                pct >= 80 ? 'bg-primary' : pct >= 40 ? 'bg-amber-400' : 'bg-error'
              }`}
              style={{ width: `${Math.max(pct, 2)}%` }}
            />
          </div>
          {missingNames.length > 0 && (
            <p className="text-[11px] text-on-surface-variant/70 mt-2 flex flex-wrap gap-x-1.5 items-center">
              <span className="font-mono uppercase tracking-widest text-[9px] text-on-surface-variant/50">
                Нет:
              </span>
              <span>{missingNames.join(', ')}</span>
              <Link
                href="/client/onboarding"
                className="ml-1 text-primary hover:text-primary/80 font-mono transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 rounded"
              >
                Дополнить →
              </Link>
            </p>
          )}
        </div>

        {/* ── 3 sub-tiles ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          {/* Компания */}
          <div className="bg-surface-container rounded-xl border border-white/[0.04] p-3.5 hover:border-primary/15 transition-colors">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="material-symbols-outlined text-[14px] text-primary/70">business</span>
              <span className="text-[9px] font-mono text-on-surface-variant uppercase tracking-[0.2em]">
                Компания
              </span>
            </div>
            <p className="text-sm font-bold text-on-surface truncate" title={companyName}>
              {companyName}
            </p>
            <p className="text-[11px] text-on-surface-variant mt-1 truncate" title={`${vertical} · ${city}`}>
              {vertical} · {city}
            </p>
          </div>

          {/* Цель 12 мес */}
          <Link
            href="/point-b"
            className="bg-surface-container rounded-xl border border-white/[0.04] p-3.5 hover:border-primary/30 hover:bg-surface-container-high transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 group"
            title="Перейти к Точке Б — целям роста"
          >
            <div className="flex items-center gap-1.5 mb-2">
              <span className="material-symbols-outlined text-[14px] text-primary/70">flag</span>
              <span className="text-[9px] font-mono text-on-surface-variant uppercase tracking-[0.2em]">
                Цель 12 мес
              </span>
              <span className="material-symbols-outlined text-[12px] text-on-surface-variant/40 ml-auto group-hover:text-primary transition-colors">
                arrow_outward
              </span>
            </div>
            <p className="text-sm font-mono font-bold text-on-surface tabular-nums">
              {formatKzt(target12m)}
            </p>
            <p className="text-[11px] text-on-surface-variant mt-1 font-mono">
              ~{monthlyFromTotal(target12m, 12)}/мес
            </p>
          </Link>

          {/* Цель 3 года */}
          <Link
            href="/point-b"
            className="bg-surface-container rounded-xl border border-white/[0.04] p-3.5 hover:border-primary/30 hover:bg-surface-container-high transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 group"
            title="Перейти к Точке Б — целям роста"
          >
            <div className="flex items-center gap-1.5 mb-2">
              <span className="material-symbols-outlined text-[14px] text-primary/70">trending_up</span>
              <span className="text-[9px] font-mono text-on-surface-variant uppercase tracking-[0.2em]">
                Цель 3 года
              </span>
              <span className="material-symbols-outlined text-[12px] text-on-surface-variant/40 ml-auto group-hover:text-primary transition-colors">
                arrow_outward
              </span>
            </div>
            <p className="text-sm font-mono font-bold text-on-surface tabular-nums">
              {formatKzt(target3y)}
            </p>
            <p className="text-[11px] text-on-surface-variant mt-1 font-mono">
              ~{monthlyFromTotal(target3y, 36)}/мес
            </p>
          </Link>
        </div>

        {/* ── Collapsible footer ────────────────────────────────────────── */}
        <CompanyDataFooter
          blocks={blockStats.map((b) => ({
            id: b.id,
            title: b.title,
            icon: b.icon,
            pct: b.pct,
            stepLabels: b.steps.map((s) => SURVEY_STEP_LABELS[s] || `Шаг ${s}`),
          }))}
        />
      </div>
    </section>
  )
}
