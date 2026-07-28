export const dynamic = "force-dynamic"

import type { Metadata } from 'next'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'
import { DocumentUpload } from '@/components/diagnostics/DocumentUpload'

export const metadata: Metadata = { title: 'Точка А — Текущее состояние' }

async function getPointAData(email?: string | null) {
  try {
    const [clientsCount, avgScoreRes, latestReports] = await Promise.all([
      prisma.client.count(),
      prisma.griReport.aggregate({ _avg: { score: true } }),
      prisma.griReport.findMany({
        include: { client: { select: { name: true, id: true } } },
        orderBy: { calculatedAt: 'desc' },
        take: 5,
      }),
    ])
    const client = email
      ? await prisma.client.findFirst({ where: { manager: { email } } })
      : null
    return {
      clientsCount,
      avgScore: avgScoreRes._avg.score === null
        ? null
        : Number(avgScoreRes._avg.score),
      latestReports,
      client,
      unavailable: false,
    }
  } catch (error) {
    console.error('[point-a] live diagnostic data unavailable', error)
    return {
      clientsCount: null,
      avgScore: null,
      latestReports: [],
      client: null,
      unavailable: true,
    }
  }
}

export default async function PointAPage() {
  const session = await auth()
  const pointA = await getPointAData(session?.user?.email)
  const { clientsCount, avgScore, latestReports, client } = pointA

  const firstReport = latestReports[0]
  const domainScores = firstReport
    ? [
        { id: 'product', label: 'Product & Tech', score: firstReport.productScore, max: 100, icon: 'inventory_2' },
        { id: 'trust', label: 'Trust & Reputation', score: firstReport.trustScore, max: 100, icon: 'verified_user' },
        { id: 'business', label: 'Business Model', score: firstReport.businessModelScore, max: 100, icon: 'business_center' },
        { id: 'cash', label: 'Cash & Finance', score: firstReport.cashScore, max: 100, icon: 'payments' },
        { id: 'operations', label: 'Operations', score: firstReport.operationsScore, max: 100, icon: 'settings' },
        { id: 'team', label: 'Team & Culture', score: firstReport.teamScore, max: 100, icon: 'groups' },
        { id: 'founder', label: 'Founder & Strategy', score: firstReport.founderScore, max: 100, icon: 'person' },
      ]
    : []
  const currentScore = firstReport?.score ?? avgScore

  return (
    <div className="space-y-8">
      {/* Header */}
      <section>
        <p className="text-xs font-mono text-primary/70 uppercase tracking-[0.2em] mb-3">
          AI Диагностика · Текущее состояние
        </p>
        <h1 className="font-headline text-3xl lg:text-4xl font-extrabold text-on-surface">
          Точка <span className="text-gradient">А</span>
        </h1>
        <p className="text-on-surface-variant mt-2 text-sm max-w-xl leading-relaxed">
          Объективная оценка текущего состояния бизнеса через призму GRI-матрицы. 
          Загрузите документы для автоматического анализа ИИ-агентом.
        </p>
      </section>

      {/* AI Diagnostic Upload */}
      <section className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-150">
        {pointA.unavailable || !client ? (
          <div role="status" className="rounded-3xl border border-tertiary-container/25 bg-tertiary-container/5 p-6">
            <p className="font-medium text-on-surface">
              {pointA.unavailable
                ? 'Загрузка диагностики временно недоступна'
                : 'Для загрузки не найден связанный клиент'}
            </p>
            <p className="mt-2 text-sm text-on-surface-variant">
              {pointA.unavailable
                ? 'База данных не отвечает. Повторите попытку после восстановления сервиса.'
                : 'Документы нельзя отправить без реального идентификатора клиента. Обратитесь к администратору, чтобы связать аккаунт.'}
            </p>
          </div>
        ) : (
          <div className="bg-surface-container-low rounded-3xl border border-white/[0.04] p-1 overflow-hidden">
            <DocumentUpload clientId={client.id} />
          </div>
        )}
      </section>

      {/* Current State Overview */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { 
            label: 'Общий GRI', 
            value: currentScore === null ? '—' : currentScore.toFixed(0),
            icon: 'radar', 
            good: currentScore !== null && currentScore >= 700,
            note: firstReport
              ? 'Последний расчёт'
              : avgScore !== null
                ? 'Среднее по системе'
                : 'нет подтверждённых данных',
          },
          { label: 'Клиенты', value: clientsCount === null ? '—' : String(clientsCount), icon: 'groups', good: clientsCount !== null, note: clientsCount === null ? 'данные недоступны' : 'активных в базе' },
          {
            label: 'Последние отчёты',
            value: pointA.unavailable ? '—' : String(latestReports.length),
            icon: 'description',
            good: !pointA.unavailable,
            note: pointA.unavailable ? 'архив недоступен' : 'в текущей выборке',
          },
          { label: 'Health Score', value: '—', icon: 'favorite', good: false, note: 'расчёт не подключён' },
        ].map((stat) => (
          <div key={stat.label} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 hover:border-primary/10 transition-colors">
            <div className="flex items-start justify-between mb-3">
              <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{stat.label}</p>
              <span className={`material-symbols-outlined text-base ${stat.good ? 'text-primary/50' : 'text-error/50'}`}>{stat.icon}</span>
            </div>
            <p className="text-2xl font-mono font-bold text-on-surface mb-1">{stat.value}</p>
            <p className={`text-[10px] font-mono uppercase tracking-tighter ${stat.good ? 'text-primary' : 'text-error'}`}>{stat.note}</p>
          </div>
        ))}
      </section>

      {/* Domain Diagnostics */}
      <section>
        <div className="flex justify-between items-end border-b border-outline-variant/10 pb-4 mb-6">
          <div>
            <h2 className="font-headline text-lg font-bold text-on-surface">Диагностика доменов</h2>
            <p className="text-xs text-on-surface-variant mt-1">Текущий уровень готовности по каждому направлению GRI</p>
          </div>
          <div className="text-right">
            <button
              type="button"
              disabled
              aria-label="Открыть подробный отчёт: функция пока недоступна"
              title="Подробный отчёт пока недоступен"
              className="cursor-not-allowed text-xs font-mono font-bold text-on-surface-variant opacity-50"
            >
              Подробный отчёт
            </button>
            <p className="mt-1 text-[10px] text-on-surface-variant">Просмотр пока не подключён</p>
          </div>
        </div>
        
        {domainScores.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {domainScores.map((domain) => {
            const max = domain.max
            const score = domain.score
            const pct = (score / max) * 100
            const isStrong = pct >= 70
            const isCritical = pct < 50

            return (
              <div key={domain.id} className="bg-surface-container-low rounded-2xl border border-white/[0.04] hover:border-primary/10 p-5 transition-all group hover:scale-[1.01]">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl bg-surface-container flex items-center justify-center border border-white/[0.04] group-hover:border-primary/20 transition-colors">
                    <span className="material-symbols-outlined text-lg text-primary">{domain.icon}</span>
                  </div>
                  <span className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full border ${
                    isCritical ? 'text-error border-error/20 bg-error/5' : 
                    isStrong ? 'text-primary border-primary/20 bg-primary/5' : 
                    'text-tertiary-container border-tertiary-container/20 bg-tertiary-container/5'
                  }`}>
                    {isCritical ? 'Критично' : isStrong ? 'High' : 'Normal'}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-on-surface mb-3">{domain.label}</h3>
                <div className="flex items-end justify-between mb-2">
                  <span className="text-3xl font-mono font-bold text-on-surface">{score.toFixed(1)}</span>
                  <span className="text-[10px] text-on-surface-variant font-mono uppercase tracking-widest">/ {max} PTS</span>
                </div>
                <div className="h-1.5 bg-surface-container rounded-full overflow-hidden border border-white/[0.02]">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ${
                      isCritical ? 'bg-error' : isStrong ? 'bg-primary shadow-[0_0_8px_rgba(var(--primary-rgb),0.5)]' : 'bg-tertiary-container'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-outline-variant/20 bg-surface-container-low p-10 text-center">
            <span className="material-symbols-outlined mb-3 block text-4xl text-on-surface-variant/25">radar</span>
            <p className="text-sm font-medium text-on-surface">Нет данных диагностики доменов</p>
            <p className="mt-1 text-xs text-on-surface-variant">
              Доменный профиль появится после первого подтверждённого расчёта.
            </p>
          </div>
        )}
      </section>

      {/* Feed of reports */}
      <section>
        <div className="mb-5">
          <h2 className="font-headline text-lg font-bold text-on-surface">Последние расчёты</h2>
          {latestReports.length > 0 && (
            <p className="mt-1 text-xs text-on-surface-variant">Скачивание архивных отчётов пока не подключено.</p>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3">
          {latestReports.map((report) => (
            <div key={report.id} className="bg-surface-container-low rounded-2xl border border-white/[0.04] p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-surface-container transition-colors group">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-mono font-bold border ${report.score >= 700 ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-error/10 border-error/20 text-error'}`}>
                  {Math.round(report.score / 10)}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-on-surface">{report.client.name}</h3>
                  <p className="text-xs text-on-surface-variant font-mono">
                    {new Date(report.calculatedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  disabled
                  aria-label={`Скачать отчёт ${report.client.name}: функция пока недоступна`}
                  title="Скачивание отчёта пока недоступно"
                  className="flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-full bg-surface-container text-on-surface-variant opacity-45"
                >
                  <span className="material-symbols-outlined text-base">download</span>
                </button>
              </div>
            </div>
          ))}

          {latestReports.length === 0 && (
            <div className="bg-surface-container-low rounded-2xl border border-dashed border-white/10 p-12 text-center group hover:border-primary/30 transition-colors">
              <span className="material-symbols-outlined text-4xl text-on-surface-variant/20 mb-4 block group-hover:text-primary/20 transition-colors">insert_chart</span>
              <p className="text-sm text-on-surface-variant font-medium">
                {pointA.unavailable ? 'Архив отчётов временно недоступен' : 'Нет загруженных отчетов'}
              </p>
              <p className="text-xs text-on-surface-variant/60 mt-1">
                {pointA.unavailable
                  ? 'Повторите после восстановления базы данных'
                  : client
                    ? 'Используйте форму выше для загрузки документации'
                    : 'Сначала свяжите аккаунт с реальным клиентом'}
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
