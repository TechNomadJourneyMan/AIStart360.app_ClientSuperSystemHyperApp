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
import { createGriReportAction, getClientsAction } from "@/app/actions/gri"
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

  useEffect(() => {
    getClientsAction().then(setClients)
  }, [])

  const updateField = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const nextStep = () => setStep(s => Math.min(s + 1, 5))
  const prevStep = () => setStep(s => Math.max(s - 1, 1))

  const handleSubmit = async () => {
    if (!selectedClientId) return
    setIsSubmitting(true)
    
    // Mapping internal names to GriAnswers format if necessary
    const result = await createGriReportAction(selectedClientId, formData as any)
    
    if (result.success) {
      router.push("/pulse")
    } else {
      alert(result.error)
    }
    setIsSubmitting(false)
  }

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
              ) : (
                <Button 
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 gap-2 px-8 shadow-[0_0_20px_rgba(37,99,235,0.4)]"
                >
                  {isSubmitting ? <Loader2 className="animate-spin" /> : <CheckCircle2 size={18} />}
                  Запустить расчет GRI 
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
