'use client'

// components/gri/calculator/FinancialAnalyst.tsx — извлечённый из GRICalculator
// блок «Финансовый аналитик». Файлы (PDF/XLSX/XLS/CSV) реально парсятся на
// сервере: клиент отправляет multipart-форму на /api/gri/financial-analyst,
// НЕ читает файл сам и НЕ имитирует стадии парсинга. Всё на русском.
import { useCallback, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BarChart3,
  FileUp,
  Paperclip,
  X,
  Loader2,
  CheckCircle2,
  DollarSign,
  TrendingUp,
  TrendingDown,
  ArrowLeftRight,
  FileText,
} from 'lucide-react'
import { toast } from 'sonner'

import { Card, CardContent } from './ui/card'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
import { getScoreColor } from '@/lib/gri-calculator/gri-data'

export interface FinancialAnalystProps {
  scores: Record<string, number>
  onApplyScores: (next: Record<string, number>) => void
}

interface FinancialAnalysisResult {
  gri_updates: {
    cash_stability: { score: number; justification: string }
    business_model: { score: number; justification: string }
  }
  extracted_metrics: {
    revenue_trend: string
    gross_margin: string
    net_profit_margin: string
  }
  mckinsey_insights: string[]
}

// Локальные русские строки (компонент двуязычие не поддерживает).
const L = {
  financialAnalyst: 'Финансовый Аналитик',
  financialAnalystDesc: 'Загрузите финансовый отчёт или вставьте данные для AI-анализа',
  dropzoneTitle: 'Загрузите финансовый отчёт',
  dropzoneSubtitle: 'Перетащите PDF, Excel или CSV сюда',
  dropzoneOr: 'или',
  dropzoneBrowse: 'выберите файл',
  dropzoneOrPaste: 'или вставьте данные вручную',
  pasteFinancialData: 'Вставьте финансовые данные (P&L, Cash Flow, баланс)...',
  analyzeFinances: 'Анализировать финансы',
  analyzingFinances: 'Анализ...',
  stageUpload: 'Загружаю и извлекаю данные из файла...',
  stageAnalyze: 'AI анализирует отчёт...',
  stageDone: 'Готово',
  analysisError: 'Ошибка анализа. Проверьте данные и попробуйте снова.',
  parseError: 'Не удалось прочитать файл',
  fileAnalyzed: 'Файл проанализирован',
  analysisTitle: 'AI Финансовый Анализ',
  analysisDesc: 'Результаты анализа на основе ваших финансовых данных',
  scoreUpdate: 'Обновление оценки',
  financialStability: 'Финансовая Устойчивость',
  businessModelScore: 'Бизнес-модель',
  extractedMetrics: 'Извлечённые Метрики',
  revenueTrend: 'Динамика Выручки',
  grossMargin: 'Валовая Маржа',
  netProfitMargin: 'Чистая Маржа',
  insights: 'Инсайты McKinsey',
  noData: 'Нет данных',
  applyToScores: 'Применить к оценкам',
  applied: 'Оценки обновлены. Совет: сохраните результат как сессию во вкладке «Оценка», чтобы отслеживать динамику.',
} as const

type FileStage = 'idle' | 'upload' | 'analyze' | 'done'

export default function FinancialAnalyst({ scores, onApplyScores }: FinancialAnalystProps) {
  const [financialData, setFinancialData] = useState('')
  const [financialAnalysis, setFinancialAnalysis] = useState<FinancialAnalysisResult | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [fileStage, setFileStage] = useState<FileStage>('idle')
  const [showPasteMode, setShowPasteMode] = useState(false)
  const [dropzoneDragging, setDropzoneDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const processFileUpload = useCallback(
    async (file: File) => {
      setFinancialAnalysis(null)
      setFileStage('upload')
      const fd = new FormData()
      fd.append('file', file)
      fd.append('scores', JSON.stringify(scores))
      fd.append('lang', 'ru')
      try {
        const res = await fetch('/api/gri/financial-analyst', {
          method: 'POST',
          credentials: 'include',
          body: fd,
        })
        setFileStage('analyze')
        const data = await res.json()
        if (!res.ok || data.error) {
          toast.error(typeof data.error === 'string' ? data.error : L.parseError)
          setFileStage('idle')
          return
        }
        setFinancialAnalysis(data as FinancialAnalysisResult)
        setFileStage('done')
        toast.success(L.fileAnalyzed)
        setTimeout(() => setFileStage('idle'), 500)
      } catch {
        toast.error(L.parseError)
        setFileStage('idle')
      }
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
    [scores],
  )

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) void processFileUpload(file)
    },
    [processFileUpload],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDropzoneDragging(false)
      const file = e.dataTransfer.files?.[0]
      if (
        file &&
        (file.name.endsWith('.pdf') ||
          file.name.endsWith('.xlsx') ||
          file.name.endsWith('.xls') ||
          file.name.endsWith('.csv'))
      ) {
        void processFileUpload(file)
      }
    },
    [processFileUpload],
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDropzoneDragging(true)
  }, [])
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDropzoneDragging(false)
  }, [])

  const analyzeFinances = useCallback(async () => {
    if (!financialData.trim()) return
    setAnalyzing(true)
    setFinancialAnalysis(null)
    try {
      const res = await fetch('/api/gri/financial-analyst', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ financialData: financialData.trim(), scores, lang: 'ru' }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        toast.error(typeof data.error === 'string' ? data.error : L.analysisError)
        return
      }
      setFinancialAnalysis(data as FinancialAnalysisResult)
    } catch {
      toast.error(L.analysisError)
    } finally {
      setAnalyzing(false)
    }
  }, [financialData, scores])

  const applyFinancialAnalysis = useCallback(() => {
    if (!financialAnalysis) return
    const csScore = Math.max(1, Math.min(10, financialAnalysis.gri_updates.cash_stability.score))
    const bmScore = Math.max(1, Math.min(10, financialAnalysis.gri_updates.business_model.score))
    onApplyScores({ ...scores, 'Cash Stability': csScore, 'Business Model': bmScore })
    toast.success(L.applied)
    setFinancialAnalysis(null)
    setFinancialData('')
  }, [financialAnalysis, scores, onApplyScores])

  const parsing = fileStage !== 'idle'
  const metricValue = (v: string) => (v === 'Нет данных' || v === 'No data' ? L.noData : v)

  return (
    <div className="space-y-5">
      <Card className="glass-card financial-card-glow rounded-xl py-5">
        <CardContent className="p-0 px-5 sm:px-6">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-cyan-500/15">
              <BarChart3 className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white/90">{L.financialAnalyst}</h3>
              <p className="text-[0.65rem] text-white/40">{L.financialAnalystDesc}</p>
            </div>
          </div>

          <div className="mt-4">
            {!showPasteMode && !parsing && (
              <div
                className={`smart-dropzone p-6 flex flex-col items-center justify-center min-h-[140px] ${dropzoneDragging ? 'dragging' : ''}`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
              >
                <FileUp className="w-8 h-8 text-cyan-400/50 mb-3" />
                <p className="text-sm font-medium text-white/70 mb-1">{L.dropzoneTitle}</p>
                <p className="text-xs text-white/35 mb-3">{L.dropzoneSubtitle}</p>
                <div className="flex items-center gap-3 text-xs text-white/40">
                  <span>{L.dropzoneOr}</span>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-cyan-400 hover:text-cyan-300 font-medium underline underline-offset-2 transition-colors"
                  >
                    {L.dropzoneBrowse}
                  </button>
                  <span>{L.dropzoneOr}</span>
                  <button
                    onClick={() => setShowPasteMode(true)}
                    className="text-cyan-400 hover:text-cyan-300 font-medium underline underline-offset-2 transition-colors"
                  >
                    {L.dropzoneOrPaste}
                  </button>
                </div>
                <input ref={fileInputRef} type="file" accept=".pdf,.xlsx,.xls,.csv" className="hidden" onChange={handleFileUpload} />
              </div>
            )}

            {showPasteMode && !parsing && (
              <div className="relative">
                <Textarea
                  value={financialData}
                  onChange={(e) => setFinancialData(e.target.value)}
                  placeholder={L.pasteFinancialData}
                  className="min-h-[120px] max-h-[240px] pr-20"
                />
                <div className="absolute top-2 right-2 flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => { setShowPasteMode(false); setFinancialData('') }} className="h-9 px-3 text-xs">
                    <X className="w-3 h-3" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()} className="h-9 px-3 text-xs">
                    <Paperclip className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <input ref={fileInputRef} type="file" accept=".pdf,.xlsx,.xls,.csv" className="hidden" onChange={handleFileUpload} />
              </div>
            )}

            {parsing && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 rounded-xl"
                style={{ background: 'rgba(6, 182, 212, 0.06)', border: '1px solid rgba(6, 182, 212, 0.15)' }}
              >
                <div className="space-y-2">
                  {([
                    { key: 'upload', label: L.stageUpload },
                    { key: 'analyze', label: L.stageAnalyze },
                    { key: 'done', label: L.stageDone },
                  ] as { key: FileStage; label: string }[]).map(({ key, label }) => {
                    const order: FileStage[] = ['upload', 'analyze', 'done']
                    const isActive = fileStage === key
                    const isDone = order.indexOf(fileStage) > order.indexOf(key)
                    return (
                      <div key={key} className="flex items-center gap-2" style={{ opacity: isDone ? 0.5 : isActive ? 1 : 0.25 }}>
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${isDone ? 'bg-emerald-500/20' : isActive ? 'bg-cyan-500/20' : 'bg-white/[0.05]'}`}>
                          {isDone ? (
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Loader2 className={`w-3 h-3 ${isActive ? 'animate-spin text-cyan-400' : 'text-white/20'}`} />
                          )}
                        </div>
                        <span className={`text-xs ${isActive ? 'text-white/80' : 'text-white/40'}`}>{label}</span>
                      </div>
                    )
                  })}
                </div>
              </motion.div>
            )}
          </div>

          {showPasteMode && !parsing && (
            <div className="flex items-center gap-3 mt-3">
              <Button
                onClick={analyzeFinances}
                disabled={analyzing || !financialData.trim()}
                className="gap-2 bg-gradient-to-r from-cyan-600 to-cyan-500 text-white px-4 py-2 text-xs rounded-lg"
              >
                {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                {analyzing ? L.analyzingFinances : L.analyzeFinances}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <AnimatePresence>
        {financialAnalysis && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}>
            <Card className="glass-card financial-results-glow rounded-xl py-5">
              <CardContent className="p-0 px-5 sm:px-6">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-cyan-500/15">
                      <DollarSign className="w-4 h-4 text-cyan-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-white/90">{L.analysisTitle}</h3>
                      <p className="text-[0.65rem] text-white/40">{L.analysisDesc}</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" aria-label="Очистить" onClick={() => { setFinancialAnalysis(null); setFinancialData('') }} className="h-10 w-10 p-0">
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="space-y-4">
                    <h4 className="text-xs font-semibold text-cyan-400/90 uppercase tracking-wider flex items-center gap-1.5">
                      <ArrowLeftRight className="w-3 h-3" />
                      {L.scoreUpdate}
                    </h4>
                    <div className="rounded-lg p-3" style={{ background: 'rgba(6, 182, 212, 0.06)', border: '1px solid rgba(6, 182, 212, 0.12)' }}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-white/70">{L.financialStability}</span>
                        <span className="text-lg font-bold font-mono tabular-nums" style={{ color: getScoreColor(financialAnalysis.gri_updates.cash_stability.score) }}>
                          {financialAnalysis.gri_updates.cash_stability.score}/10
                        </span>
                      </div>
                      <p className="text-[0.7rem] text-white/50 leading-relaxed">{financialAnalysis.gri_updates.cash_stability.justification}</p>
                    </div>
                    <div className="rounded-lg p-3" style={{ background: 'rgba(168, 85, 247, 0.06)', border: '1px solid rgba(168, 85, 247, 0.12)' }}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-white/70">{L.businessModelScore}</span>
                        <span className="text-lg font-bold font-mono tabular-nums" style={{ color: getScoreColor(financialAnalysis.gri_updates.business_model.score) }}>
                          {financialAnalysis.gri_updates.business_model.score}/10
                        </span>
                      </div>
                      <p className="text-[0.7rem] text-white/50 leading-relaxed">{financialAnalysis.gri_updates.business_model.justification}</p>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-xs font-semibold text-cyan-400/90 uppercase tracking-wider flex items-center gap-1.5 mb-3">
                        <TrendingUp className="w-3 h-3" />
                        {L.extractedMetrics}
                      </h4>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { label: L.revenueTrend, val: financialAnalysis.extracted_metrics.revenue_trend },
                          { label: L.grossMargin, val: financialAnalysis.extracted_metrics.gross_margin },
                          { label: L.netProfitMargin, val: financialAnalysis.extracted_metrics.net_profit_margin },
                        ].map((m, i) => (
                          <div key={i} className="rounded-lg p-2.5 text-center bg-white/[0.03] border border-white/[0.06]">
                            <p className="text-[0.6rem] text-white/40 mb-1">{m.label}</p>
                            <p className="text-sm font-semibold text-white/80 font-mono">{metricValue(m.val)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-cyan-400/90 uppercase tracking-wider flex items-center gap-1.5 mb-3">
                        <TrendingDown className="w-3 h-3" />
                        {L.insights}
                      </h4>
                      <div className="space-y-2">
                        {financialAnalysis.mckinsey_insights.map((insight, i) => (
                          <div key={i} className="rounded-lg p-3 flex items-start gap-2.5" style={{ background: 'rgba(245, 158, 11, 0.06)', border: '1px solid rgba(245, 158, 11, 0.12)' }}>
                            <div className="flex-shrink-0 w-5 h-5 rounded-md flex items-center justify-center mt-0.5 bg-amber-500/15">
                              <span className="text-[0.6rem] font-bold text-amber-400">{i + 1}</span>
                            </div>
                            <p className="text-xs text-white/70 leading-relaxed">{insight}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-5 pt-4 border-t border-white/[0.06]">
                  <Button onClick={applyFinancialAnalysis} className="gap-2 bg-gradient-to-r from-cyan-600 to-blue-600 text-white px-5 py-2.5 text-xs rounded-lg">
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                    {L.applyToScores}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
