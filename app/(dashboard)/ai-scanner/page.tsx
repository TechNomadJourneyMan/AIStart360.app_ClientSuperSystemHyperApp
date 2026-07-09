'use client'

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { 
  Calculator, 
  TrendingUp, 
  Users, 
  UserCheck, 
  ArrowRight, 
  ArrowLeft, 
  CheckCircle2,
  Loader2,
  Plus,
  ShieldCheck,
  Zap,
  Target
} from "lucide-react"

import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Card, CardContent } from "@/components/ui/Card"
import { calculateGri, type GriResult } from "@/lib/gri/logic"
import { useRouter } from "next/navigation"

// Simple Label component since shadcn one is missing
const Label = ({ children, htmlFor, className = "" }: { children: React.ReactNode, htmlFor?: string, className?: string }) => (
  <label htmlFor={htmlFor} className={`text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 ${className}`}>
    {children}
  </label>
)

export default function AiScannerPage() {
  const [step, setStep] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [clients, setClients] = useState<any[]>([])
  const [selectedClientId, setSelectedClientId] = useState("")
  const router = useRouter()

  const [formData, setFormData] = useState({
    // Financials
    revenue: 1000000,
    margin: 30,
    cac: 5000,
    ltv: 20000,
    runway: 12,
    
    // Market (using field names from GriAnswers interface)
    industry: "E-Commerce",
    mainOffer: "Direct Sales",
    avgCheck: 1500,
    
    // Sales
    conversionRate: 5,
    hasCrm: true,
    hasScripts: false,
    
    // Ops
    processesDocumented: false,
    delegationReady: false,
    teamSize: 3,
    
    // Owner
    ownerHoursWeekly: 60,
    hasDeputy: false,
    strategicHorizonYears: 1
  })

  const [baseline, setBaseline] = useState<{ has_assessment: boolean; gri_index?: number | null; section_avgs?: Record<string, number>; top_5_limits?: any[] } | null>(null)
  const [loadingBaseline, setLoadingBaseline] = useState(false)
  const [forecast, setForecast] = useState<GriResult | null>(null)

  // Load REAL clients (Supabase) so the forecast is anchored to the same data
  // as the GRI test (user_id-keyed), not the disconnected Prisma client list.
  useEffect(() => {
    fetch('/api/expert/clients', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => setClients((j.data ?? []).map((c: any) => ({ id: c.id, name: c.companyName || c.fullName || c.email || 'Клиент', industry: c.industry || '—' }))))
      .catch(() => setClients([]))
  }, [])

  // When a client is selected, load their REAL GRI from the 62-criteria test.
  useEffect(() => {
    if (!selectedClientId) { setBaseline(null); setForecast(null); return }
    setLoadingBaseline(true)
    fetch(`/api/gri/baseline?userId=${selectedClientId}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => setBaseline(j.ok ? j.data : { has_assessment: false }))
      .catch(() => setBaseline({ has_assessment: false }))
      .finally(() => setLoadingBaseline(false))
  }, [selectedClientId])

  const updateField = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const nextStep = () => setStep(s => Math.min(s + 1, 5))
  const prevStep = () => setStep(s => Math.max(s - 1, 1))

  const handleSubmit = () => {
    if (!selectedClientId) return
    setIsSubmitting(true)
    // Forecast (what-if) GRI from the entered growth drivers, shown against the
    // client's REAL test baseline on the same 0–10 scale. This is a projection
    // tool — it does not persist a separate, disconnected score.
    setForecast(calculateGri(formData as any))
    setStep(6)
    setIsSubmitting(false)
  }

  // Convert the 0–100 calculator scale to the 0–10 GRI-test scale for comparison.
  const to10 = (v: number) => Math.round((v / 10) * 10) / 10
  const baseIndex = baseline?.has_assessment && typeof baseline.gri_index === 'number' ? baseline.gri_index : null

  const steps = [
    { title: "Клиент", icon: Users },
    { title: "Финансы", icon: Calculator },
    { title: "Маркетинг", icon: TrendingUp },
    { title: "Команда", icon: Zap },
    { title: "Собственник", icon: UserCheck }
  ]

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[#050505] text-white p-6 md:p-12 font-sans">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-12 text-center">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-indigo-600 bg-clip-text text-transparent mb-4">
            AI Business Scanner
          </h1>
          <p className="text-gray-400">
            Заполните данные для детального анализа и расчета индекса GRI
          </p>
        </div>

        {/* Steps Progress */}
        <div className="flex justify-between mb-12 relative px-4">
          <div className="absolute top-1/2 left-0 w-full h-0.5 bg-gray-800 -translate-y-1/2 z-0" />
          {steps.map((s, i) => {
            const Icon = s.icon
            const active = step >= i + 1
            return (
              <div key={s.title} className="relative z-10 flex flex-col items-center">
                <div 
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${
                    active ? 'bg-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.6)]' : 'bg-gray-800'
                  }`}
                >
                  <Icon size={18} />
                </div>
                <span className={`text-[10px] uppercase tracking-wider mt-2 ${active ? 'text-blue-400' : 'text-gray-500'}`}>
                  {s.title}
                </span>
              </div>
            )
          })}
        </div>

        {/* Form Container */}
        <Card className="bg-[#0f0f12] border-gray-800 shadow-2xl relative overflow-hidden backdrop-blur-xl">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-600/5 to-transparent pointer-events-none" />
          <CardContent className="p-8">
            <AnimatePresence mode="wait">
              {step === 1 && (
                <motion.div 
                  key="step1"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-6"
                >
                  <h2 className="text-2xl font-semibold mb-6">Выберите клиента</h2>
                  <div className="space-y-4">
                    <Label>Кто проходит диагностику?</Label>
                    <select 
                      value={selectedClientId}
                      onChange={(e) => setSelectedClientId(e.target.value)}
                      className="w-full bg-[#1a1a1f] border border-gray-700 rounded-md p-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    >
                      <option value="">Выберите клиента из списка...</option>
                      {clients.map(c => (
                        <option key={c.id} value={c.id}>{c.name} ({c.industry})</option>
                      ))}
                    </select>
                    {clients.length === 0 && (
                      <p className="text-sm text-yellow-500/80">
                        Похоже, у вас еще нет клиентов. Создайте клиента в разделе "Clients" перед началом.
                      </p>
                    )}

                    {selectedClientId && (
                      <div className="mt-4 rounded-lg border border-blue-600/20 bg-blue-600/5 p-4">
                        <p className="text-[11px] uppercase tracking-wider text-blue-400 mb-2">Текущий GRI клиента (из GRI-теста)</p>
                        {loadingBaseline ? (
                          <p className="text-sm text-gray-400">Загрузка…</p>
                        ) : baseIndex !== null ? (
                          <div className="flex items-baseline gap-3 flex-wrap">
                            <span className="text-3xl font-bold text-white">{baseIndex.toFixed(1)}</span>
                            <span className="text-sm text-gray-400">/ 10</span>
                            <span className="text-xs text-gray-500 ml-2">Прогноз ниже строится от этой реальной базы — данные синхронизированы с тестом.</span>
                          </div>
                        ) : (
                          <p className="text-sm text-yellow-500/80">GRI-тест ещё не пройден этим клиентом — попросите клиента пройти GRI-тест для реальной базы прогноза.</p>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {step === 2 && (
                <motion.div 
                  key="step2"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-6"
                >
                  <h2 className="text-2xl font-semibold mb-6 flex items-center gap-2">
                    <Calculator className="text-blue-500" /> Финансовые показатели
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label>Выручка в месяц (₸)</Label>
                      <Input 
                        type="number" 
                        value={formData.revenue} 
                        onChange={e => updateField('revenue', Number(e.target.value))}
                        className="bg-[#1a1a1f] border-gray-700" 
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Маржинальность (%)</Label>
                      <Input 
                        type="number" 
                        value={formData.margin} 
                        onChange={e => updateField('margin', Number(e.target.value))}
                        className="bg-[#1a1a1f] border-gray-700" 
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Стоимость привлечения (CAC)</Label>
                      <Input 
                        type="number" 
                        value={formData.cac} 
                        onChange={e => updateField('cac', Number(e.target.value))}
                        className="bg-[#1a1a1f] border-gray-700" 
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>LTV клиента</Label>
                      <Input 
                        type="number" 
                        value={formData.ltv} 
                        onChange={e => updateField('ltv', Number(e.target.value))}
                        className="bg-[#1a1a1f] border-gray-700" 
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label>Запас прочности (мес. Runway)</Label>
                      <Input 
                        type="number" 
                        value={formData.runway} 
                        onChange={e => updateField('runway', Number(e.target.value))}
                        className="bg-[#1a1a1f] border-gray-700" 
                      />
                    </div>
                  </div>
                </motion.div>
              )}

              {step === 3 && (
                <motion.div 
                  key="step3"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-6"
                >
                  <h2 className="text-2xl font-semibold mb-6 flex items-center gap-2">
                    <TrendingUp className="text-green-500" /> Продукт и Маркетинг
                  </h2>
                  <div className="grid grid-cols-1 gap-6">
                    <div className="space-y-2">
                      <Label>Конверсия в продажу (%)</Label>
                      <Input 
                        type="number" 
                        value={formData.conversionRate} 
                        onChange={e => updateField('conversionRate', Number(e.target.value))}
                        className="bg-[#1a1a1f] border-gray-700" 
                      />
                    </div>
                    <div className="flex items-center justify-between p-4 bg-[#1a1a1f] rounded-lg border border-gray-700">
                      <div className="space-y-0.5">
                        <Label>Используется ли CRM?</Label>
                        <p className="text-xs text-gray-500">Автоматизация учета сделок</p>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={formData.hasCrm} 
                        onChange={e => updateField('hasCrm', e.target.checked)}
                        className="w-10 h-5 bg-gray-700 rounded-full appearance-none checked:bg-blue-600 transition-colors cursor-pointer"
                      />
                    </div>
                    <div className="flex items-center justify-between p-4 bg-[#1a1a1f] rounded-lg border border-gray-700">
                      <div className="space-y-0.5">
                        <Label>Есть ли скрипты продаж?</Label>
                        <p className="text-xs text-gray-500">Прописанные регламенты звонков</p>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={formData.hasScripts} 
                        onChange={e => updateField('hasScripts', e.target.checked)}
                        className="w-10 h-5 bg-gray-700 rounded-full appearance-none checked:bg-blue-600 transition-colors cursor-pointer"
                      />
                    </div>
                  </div>
                </motion.div>
              )}

              {step === 4 && (
                <motion.div 
                  key="step4"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-6"
                >
                  <h2 className="text-2xl font-semibold mb-6 flex items-center gap-2">
                    <Zap className="text-yellow-500" /> Команда и Масштабирование
                  </h2>
                  <div className="grid grid-cols-1 gap-6">
                    <div className="space-y-2">
                      <Label>Количество сотрудников (чел.)</Label>
                      <Input 
                        type="number" 
                        value={formData.teamSize} 
                        onChange={e => updateField('teamSize', Number(e.target.value))}
                        className="bg-[#1a1a1f] border-gray-700" 
                      />
                    </div>
                    <div className="flex items-center justify-between p-4 bg-[#1a1a1f] rounded-lg border border-gray-700">
                      <div className="space-y-0.5">
                        <Label>Бизнес-процессы оцифрованы?</Label>
                        <p className="text-xs text-gray-500">Есть база знаний или регламенты</p>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={formData.processesDocumented} 
                        onChange={e => updateField('processesDocumented', e.target.checked)}
                        className="w-10 h-5 bg-gray-700 rounded-full appearance-none checked:bg-blue-600 transition-colors cursor-pointer"
                      />
                    </div>
                    <div className="flex items-center justify-between p-4 bg-[#1a1a1f] rounded-lg border border-gray-700">
                      <div className="space-y-0.5">
                        <Label>Готовность к делегированию?</Label>
                        <p className="text-xs text-gray-500">Может ли бизнес работать без вас 1 неделю?</p>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={formData.delegationReady} 
                        onChange={e => updateField('delegationReady', e.target.checked)}
                        className="w-10 h-5 bg-gray-700 rounded-full appearance-none checked:bg-blue-600 transition-colors cursor-pointer"
                      />
                    </div>
                  </div>
                </motion.div>
              )}

              {step === 5 && (
                <motion.div 
                  key="step5"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-6"
                >
                  <h2 className="text-2xl font-semibold mb-6 flex items-center gap-2">
                    <UserCheck className="text-indigo-500" /> Личное участие собственника
                  </h2>
                  <div className="grid grid-cols-1 gap-6">
                    <div className="space-y-2">
                      <Label>Часов в неделю вы тратите на «текучку»?</Label>
                      <Input 
                        type="number" 
                        value={formData.ownerHoursWeekly} 
                        onChange={e => updateField('ownerHoursWeekly', Number(e.target.value))}
                        className="bg-[#1a1a1f] border-gray-700" 
                      />
                    </div>
                    <div className="flex items-center justify-between p-4 bg-[#1a1a1f] rounded-lg border border-gray-700">
                      <div className="space-y-0.5">
                        <Label>Есть ли сильный заместитель (Зам СЕО)?</Label>
                        <p className="text-xs text-gray-500">Человек, принимающий решения</p>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={formData.hasDeputy} 
                        onChange={e => updateField('hasDeputy', e.target.checked)}
                        className="w-10 h-5 bg-gray-700 rounded-full appearance-none checked:bg-blue-600 transition-colors cursor-pointer"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Горизонт стратегического планирования (лет)</Label>
                      <Input 
                        type="number" 
                        value={formData.strategicHorizonYears} 
                        onChange={e => updateField('strategicHorizonYears', Number(e.target.value))}
                        className="bg-[#1a1a1f] border-gray-700" 
                      />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {step === 6 && forecast && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                <h2 className="text-2xl font-semibold">Прогноз GRI</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg border border-gray-700 bg-[#1a1a1f] p-5">
                    <p className="text-[11px] uppercase tracking-wider text-gray-400 mb-2">Текущий (GRI-тест)</p>
                    <p className="text-3xl font-bold text-white">{baseIndex !== null ? baseIndex.toFixed(1) : '—'}<span className="text-sm text-gray-500"> / 10</span></p>
                  </div>
                  <div className="rounded-lg border border-blue-600/30 bg-blue-600/10 p-5">
                    <p className="text-[11px] uppercase tracking-wider text-blue-400 mb-2">Прогноз (калькулятор)</p>
                    <p className="text-3xl font-bold text-blue-300">{to10(forecast.score).toFixed(1)}<span className="text-sm text-gray-500"> / 10</span></p>
                    {baseIndex !== null && (
                      <p className="text-xs mt-1 text-gray-400">Δ {to10(forecast.score) - baseIndex >= 0 ? '+' : ''}{(to10(forecast.score) - baseIndex).toFixed(1)} к базе</p>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  {([['Бизнес-модель', forecast.businessModelScore], ['Денежная стабильность', forecast.cashScore], ['Продукт и спрос', forecast.productScore], ['Операции', forecast.operationsScore], ['Команда', forecast.teamScore], ['Готовность собственника', forecast.founderScore], ['Доверие и позиционирование', forecast.trustScore]] as Array<[string, number | null]>).map(([label, val]) => (
                    <div key={label}>
                      {/* Честный Trust (№6): блок без входных сигналов → «нет данных», не 5.0 */}
                      <div className="flex justify-between text-xs mb-1"><span className="text-gray-400">{label}</span><span className="text-gray-300">{val === null ? 'нет данных' : `${to10(val).toFixed(1)}/10`}</span></div>
                      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden"><div className="h-full bg-blue-600 rounded-full" style={{ width: `${Math.min(100, val ?? 0)}%` }} /></div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-500">Это прогноз (what-if) по введённым драйверам. Реальный GRI измеряется GRI-тестом — обе оценки на шкале 0–10, данные синхронизированы.</p>
              </motion.div>
            )}

            {/* Actions */}
            <div className="flex justify-between mt-12 pt-6 border-t border-gray-800">
              <Button 
                variant="outline" 
                onClick={prevStep}
                disabled={step === 1 || isSubmitting}
                className="gap-2 border-gray-700 hover:bg-gray-800"
              >
                <ArrowLeft size={16} /> Назад
              </Button>

              {step < 5 ? (
                <Button 
                  onClick={nextStep}
                  disabled={step === 1 && !selectedClientId}
                  className="bg-blue-600 hover:bg-blue-700 gap-2 px-8"
                >
                  Далее <ArrowRight size={16} />
                </Button>
              ) : step === 5 ? (
                <Button
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 gap-2 px-8 shadow-[0_0_20px_rgba(37,99,235,0.4)]"
                >
                  {isSubmitting ? <Loader2 className="animate-spin" /> : <CheckCircle2 size={18} />}
                  Рассчитать прогноз
                </Button>
              ) : (
                <Button
                  onClick={() => { setStep(5); setForecast(null) }}
                  className="bg-blue-600 hover:bg-blue-700 gap-2 px-8"
                >
                  <ArrowLeft size={16} /> Изменить параметры
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Info Tips */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-blue-600/5 rounded-lg border border-blue-600/10 flex gap-3 items-start">
            <ShieldCheck className="text-blue-500 flex-shrink-0" size={20} />
            <p className="text-[11px] text-gray-400">Точность расчетов подтверждена методологией GRI Workshop для бизнеса $2M+</p>
          </div>
          <div className="p-4 bg-green-600/5 rounded-lg border border-green-600/10 flex gap-3 items-start">
            <Zap className="text-green-500 flex-shrink-0" size={20} />
            <p className="text-[11px] text-gray-400">Мгновенный бенчмаркинг по 140+ параметрам рынка и конкурентам</p>
          </div>
          <div className="p-4 bg-indigo-600/5 rounded-lg border border-indigo-600/10 flex gap-3 items-start">
            <Target className="text-indigo-500 flex-shrink-0" size={20} />
            <p className="text-[11px] text-gray-400">Адаптивные рекомендации на базе ваших реальных финансовых данных</p>
          </div>
        </div>
      </div>
    </div>
  )
}
