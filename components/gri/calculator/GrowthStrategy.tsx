'use client'

// components/gri/calculator/GrowthStrategy.tsx — извлечённый из GRICalculator
// блок «Стратегия роста». Единственный триггер LLM — кнопка ниже; при движении
// ползунков запросы не отправляются. niche/size — только для отображения.
import { useCallback, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'

import { Card, CardContent } from './ui/card'
import { Button } from './ui/button'
import { renderMarkdown } from './markdown'
import { translations } from '@/lib/gri-calculator/translations'

export interface GrowthStrategyProps {
  scores: Record<string, number>
  niche: string
  size: string
}

const t = translations.ru

export default function GrowthStrategy({ scores, niche, size }: GrowthStrategyProps) {
  const [strategyText, setStrategyText] = useState('')
  const [strategyLoading, setStrategyLoading] = useState(false)

  const nicheLabel = t[`niche_${niche}`] ?? niche
  const sizeLabel = t[`size_${size}`] ?? size

  const generateStrategy = useCallback(async () => {
    setStrategyLoading(true)
    setStrategyText('')
    try {
      const res = await fetch('/api/gri/ai-strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        // niche/size намеренно не отправляются — роут их игнорирует.
        body: JSON.stringify({ scores, lang: 'ru' }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        toast.error(typeof data.error === 'string' ? data.error : t.strategyError)
        return
      }
      setStrategyText(data.strategy)
    } catch {
      toast.error(t.strategyError)
    } finally {
      setStrategyLoading(false)
    }
  }, [scores])

  return (
    <div className="space-y-5">
      <AnimatePresence>
        {!strategyText && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center gap-2">
            <Button
              onClick={generateStrategy}
              disabled={strategyLoading}
              className="split-button-main gap-2 bg-gradient-to-r from-purple-600 to-purple-500 text-white px-6 py-5 text-sm font-medium"
            >
              {strategyLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {strategyLoading ? t.generatingStrategy : t.generateStrategy}
            </Button>
            <p className="text-[0.65rem] text-white/40">
              {nicheLabel} · {sizeLabel}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {strategyText && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}>
            <Card className="glass-card strategy-card-glow rounded-xl py-5">
              <CardContent className="p-0 px-5 sm:px-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-purple-500/15">
                      <Sparkles className="w-4 h-4 text-purple-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-white/90">{t.strategyTitle}</h3>
                      <p className="text-[0.65rem] text-white/40">{t.strategyDesc}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={generateStrategy}
                      disabled={strategyLoading}
                      className="h-10 gap-1.5 text-xs px-3"
                    >
                      {strategyLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                      {t.generateStrategy}
                    </Button>
                    <Button variant="ghost" size="sm" aria-label="Очистить" onClick={() => setStrategyText('')} className="h-10 w-10 p-0">
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                <div
                  className="strategy-content text-sm max-h-96 overflow-y-auto gri-slider-scroll pr-2"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(strategyText) }}
                />
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
