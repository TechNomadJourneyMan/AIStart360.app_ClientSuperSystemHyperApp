"use client"

import React, { useState, useMemo, useCallback, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts"
import { toast } from "sonner"
import {
  AlertTriangle,
  TrendingUp,
  Target,
  Globe,
  CheckCircle2,
  ArrowUpRight,
  Save,
  Sparkles,
  X,
  ChevronDown,
  ChevronUp,
  Loader2,
  BarChart3,
  DollarSign,
  TrendingDown,
  FileText,
  ArrowLeftRight,
  Download,
  ExternalLink,
  Link2,
  History,
  FileUp,
  Clock,
  AlertCircle,
  ClipboardList,
  Presentation,
  Database,
  Paperclip,
} from "lucide-react"

import { Card, CardContent } from "./ui/card"
import { Button } from "./ui/button"
import { Badge } from "./ui/badge"
import { Slider } from "./ui/slider"
import { Switch } from "./ui/switch"
import { Checkbox } from "./ui/checkbox"
import { Label } from "./ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select"
import {
  Tooltip as ShadTooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "./ui/tooltip"
import { Textarea } from "./ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"
import { Input } from "./ui/input"

import {
  translations,
  categoryTranslations,
  type Language,
} from "@/lib/gri-calculator/translations"
import {
  CATEGORIES,
  DEFAULT_SCORES,
  TARGET_GRI,
  SUB_FACTORS,
  SCORE_EXPLANATIONS,
  CATEGORY_TIPS,
  getBlendedBenchmark,
  getScoreColor,
  getScoreZoneClass,
  CROSS_IMPACTS,
  EFFORT_DATA,
  MICRO_INSIGHTS,
  type GRIHistoryEntry,
} from "@/lib/gri-calculator/gri-data"

// ─────────────────────────────────────────────────────
// Custom Radar Tooltip
// ─────────────────────────────────────────────────────

function CustomRadarTooltip({
  active,
  payload,
  label,
  lang,
}: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
  lang: Language
}) {
  if (!active || !payload || !label) return null
  const catName = categoryTranslations[label]?.[lang] ?? label

  return (
    <div className="gri-chart-tooltip">
      <p className="text-sm font-semibold text-white/90 mb-1">{catName}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-xs text-white/70">
          <span
            className="inline-block w-2 h-2 rounded-full mr-1.5"
            style={{ backgroundColor: entry.color }}
          />
          {entry.name}: <span className="font-semibold text-white">{entry.value}</span> / 10
        </p>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────
// Animated number component
// ─────────────────────────────────────────────────────

function AnimatedGRI({ value }: { value: number }) {
  const [displayValue, setDisplayValue] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDisplayValue(value)
    }, 50)
    return () => clearTimeout(timer)
  }, [value])

  return (
    <motion.span
      key={displayValue}
      initial={{ opacity: 0.5, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="font-mono tabular-nums"
    >
      {displayValue.toFixed(1)}
    </motion.span>
  )
}

// ─────────────────────────────────────────────────────
// Simple markdown renderer
// ─────────────────────────────────────────────────────

function renderMarkdown(text: string): string {
  // Escape HTML entities FIRST so any markup in the (AI-generated) strategy text
  // cannot inject active content when rendered via dangerouslySetInnerHTML. The
  // markdown tags added below are the only HTML in the output (XSS hardening).
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h3>$1</h3>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^- (.+)$/gm, '<li class="strategy-action-item">$1</li>')
    .replace(/(<li>.*?<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    .replace(/\n\n([\s\S]+?)(?=\n\n|\n|$)/g, "<p>$1</p>")
    .replace(/^(?!<[hulo])((?!<).+)$/gm, (match) => {
      if (match.startsWith("<")) return match
      return `<p>${match}</p>`
    })
  return html
}

function computeGRI(scores: Record<string, number>): number {
  const values = CATEGORIES.map((c) => scores[c])
  return values.reduce((a, b) => a + b, 0) / values.length
}

// ─────────────────────────────────────────────────────
// Main GRI Calculator Component
// ─────────────────────────────────────────────────────

export default function GRICalculator() {
  const [lang, setLang] = useState<Language>("ru")
  const [scores, setScores] = useState<Record<string, number>>(DEFAULT_SCORES)

  // Planning mode
  const [planningMode, setPlanningMode] = useState(false)
  const [baseScores, setBaseScores] = useState<Record<string, number>>(DEFAULT_SCORES)
  const [plannedScores, setPlannedScores] = useState<Record<string, number>>(DEFAULT_SCORES)

  // History comparison
  const [comparePrevious, setComparePrevious] = useState(false)
  const [previousScores, setPreviousScores] = useState<Record<string, number> | null>(null)

  // Assessment-derived canonical GRI (preferred when sliders match synced averages)
  const [assessmentGri, setAssessmentGri] = useState<number | null>(null)

  // Inline Accordion
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null)
  const [accordionChecked, setAccordionChecked] = useState<Record<string, Record<string, boolean>>>({})

  // AI Strategy
  const [strategyText, setStrategyText] = useState<string>("")
  const [strategyLoading, setStrategyLoading] = useState(false)

  // Financial Analyst
  const [financialData, setFinancialData] = useState<string>("")
  const [financialAnalysis, setFinancialAnalysis] = useState<{
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
  } | null>(null)
  const [financialLoading, setFinancialLoading] = useState(false)

  // Niche & Company Size
  const [selectedNiche, setSelectedNiche] = useState("general")
  const [selectedSize, setSelectedSize] = useState("small")

  // Dynamic Insights toggle
  const [dynamicInsights, setDynamicInsights] = useState(false)
  const dynamicInsightsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Dialogs
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [sessionName, setSessionName] = useState("")
  const [publishDialogOpen, setPublishDialogOpen] = useState(false)
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false)
  const [griHistory, setGriHistory] = useState<GRIHistoryEntry[]>([])

  // File upload
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileParsing, setFileParsing] = useState(false)

  // Smart Dropzone
  const [dropzoneDragging, setDropzoneDragging] = useState(false)
  const [parsingStage, setParsingStage] = useState<number>(0)
  const [showMetricChips, setShowMetricChips] = useState(false)
  const [showPasteMode, setShowPasteMode] = useState(false)
  const parsingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const autoUpdatedSlidersRef = useRef<Set<string>>(new Set())
  const t = translations[lang]

  // ── Load history on mount ──
  useEffect(() => {
    try {
      const stored = localStorage.getItem("gri_history")
      if (stored) {
        const history: GRIHistoryEntry[] = JSON.parse(stored)
        if (history.length >= 2) {
          setPreviousScores(history[history.length - 2].scores)
        }
      }
    } catch {
      // ignore
    }
  }, [])

  // ── Auto-sync from GRI Assessment (aistart_gri_assessment_v1) ──
  useEffect(() => {
    // Section ID → Calculator category label (Calculator uses
    // "Founder Ready" instead of "Owner Readiness" — match the actual key).
    const SECTION_TO_CATEGORY: Record<string, string> = {
      "product-demand": "Product & Demand",
      "trust-positioning": "Trust & Positioning",
      "business-model": "Business Model",
      "cash-stability": "Cash Stability",
      "operations": "Operations",
      "team": "Team",
      "owner-readiness": "Founder Ready",
    }

    const applyUpdates = (updates: Record<string, number>, griIndex?: number) => {
      if (Object.keys(updates).length > 0) {
        setScores((prev) => ({ ...prev, ...updates }))
        setBaseScores((prev) => ({ ...prev, ...updates }))
        setPlannedScores((prev) => ({ ...prev, ...updates }))
      }
      if (typeof griIndex === "number" && griIndex > 0) {
        setAssessmentGri(griIndex)
      }
    }

    const syncFromLocalStorage = () => {
      try {
        const raw = localStorage.getItem("aistart_gri_assessment_v1")
        if (!raw) return
        const parsed = JSON.parse(raw) as {
          scores?: Record<string, Record<string, number>>
          griIndex?: number
        }
        const assessmentScores = parsed?.scores
        if (!assessmentScores || typeof assessmentScores !== "object") return

        const updates: Record<string, number> = {}
        for (const [sectionId, categoryKey] of Object.entries(SECTION_TO_CATEGORY)) {
          const map = assessmentScores[sectionId]
          if (!map || typeof map !== "object") continue
          const values = Object.values(map).filter(
            (v): v is number => typeof v === "number",
          )
          if (!values.length) continue
          const avg = values.reduce((a, b) => a + b, 0) / values.length
          const clamped = Math.max(0, Math.min(10, Math.round(avg)))
          updates[categoryKey] = clamped
        }
        applyUpdates(updates, parsed?.griIndex)
      } catch {
        // ignore — assessment data is optional
      }
    }

    // Server is the authoritative source — pull current GRI assessment from
    // /api/v1/gri/assessment so the calculator's sliders + score match the
    // dashboard widget and the standalone assessment results page.
    const syncFromServer = async () => {
      try {
        const res = await fetch("/api/v1/gri/assessment", { credentials: "include" })
        const json = await res.json()
        const current = json?.data?.current
        if (!current) {
          // No server row yet — fall back to localStorage so legacy users
          // don't lose their work.
          syncFromLocalStorage()
          return
        }
        const sectionAvgs = (current.section_avgs ?? {}) as Record<string, number>
        const updates: Record<string, number> = {}
        for (const [sectionId, categoryKey] of Object.entries(SECTION_TO_CATEGORY)) {
          const v = sectionAvgs[sectionId]
          if (typeof v !== "number" || v <= 0) continue
          updates[categoryKey] = Math.max(0, Math.min(10, Math.round(v)))
        }
        applyUpdates(updates, typeof current.gri_index === "number" ? current.gri_index : undefined)
      } catch {
        // network / auth failure — degrade gracefully to localStorage.
        syncFromLocalStorage()
      }
    }

    const syncFromAssessment = () => {
      void syncFromServer()
    }

    // Initial sync on mount
    syncFromAssessment()

    // Listen for cross-tab updates via storage event
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "aistart_gri_assessment_v1") syncFromAssessment()
    }
    // Same-tab updates fire a custom event from GRIAssessment.tsx
    const handleCustom = () => syncFromAssessment()

    window.addEventListener("storage", handleStorage)
    window.addEventListener("gri:assessment-updated", handleCustom as EventListener)

    return () => {
      window.removeEventListener("storage", handleStorage)
      window.removeEventListener("gri:assessment-updated", handleCustom as EventListener)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const benchmarkScores = useMemo(
    () => getBlendedBenchmark(selectedNiche, selectedSize),
    [selectedNiche, selectedSize]
  )

  const activeScores = planningMode ? plannedScores : scores
  const griScore = useMemo(() => computeGRI(activeScores), [activeScores])
  const plannedGRI = useMemo(() => (planningMode ? computeGRI(plannedScores) : 0), [planningMode, plannedScores])

  const slidersMatchBase = useMemo(
    () => !planningMode && CATEGORIES.every((c) => scores[c] === baseScores[c]),
    [planningMode, scores, baseScores]
  )
  const displayGri = assessmentGri != null && slidersMatchBase ? assessmentGri : griScore
  const redZones = useMemo(() => CATEGORIES.filter((c) => activeScores[c] < 5), [activeScores])
  const hasRedZones = redZones.length > 0

  const crossImpactWarnings = useMemo(() => {
    if (!planningMode) return new Set<string>()
    const warnings = new Set<string>()
    for (const cat of CATEGORIES) {
      const delta = plannedScores[cat] - baseScores[cat]
      if (delta >= 3) {
        const impacted = CROSS_IMPACTS[cat] || []
        impacted.forEach((imp) => {
          if (baseScores[imp] < 5) warnings.add(imp)
        })
      }
    }
    return warnings
  }, [planningMode, plannedScores, baseScores])

  const chartData = useMemo(() => {
    return CATEGORIES.map((cat) => ({
      category: cat,
      label: categoryTranslations[cat][lang],
      current: activeScores[cat],
      benchmark: benchmarkScores[cat],
      ...(planningMode ? { base: baseScores[cat], planned: plannedScores[cat] } : {}),
      ...(comparePrevious && previousScores ? { previous: previousScores[cat] } : {}),
    }))
  }, [activeScores, benchmarkScores, planningMode, baseScores, plannedScores, comparePrevious, previousScores, lang])

  const togglePlanningMode = useCallback(
    (checked: boolean) => {
      if (checked) {
        setBaseScores({ ...scores })
        setPlannedScores({ ...scores })
      }
      setPlanningMode(checked)
    },
    [scores]
  )

  const handleSliderChange = useCallback(
    (category: string, value: number[]) => {
      if (planningMode) {
        setPlannedScores((prev) => ({ ...prev, [category]: value[0] }))
      } else {
        setScores((prev) => ({ ...prev, [category]: value[0] }))
      }
    },
    [planningMode]
  )

  const toggleAccordion = useCallback(
    (category: string) => {
      if (expandedCategory === category) {
        setExpandedCategory(null)
      } else {
        setExpandedCategory(category)
        const currentVal = activeScores[category]
        const factors = SUB_FACTORS[category] || []
        const checkedCount = Math.round((currentVal / 10) * factors.length)
        const initial: Record<string, boolean> = {}
        factors.forEach((f, i) => {
          initial[f.id] = i < checkedCount
        })
        setAccordionChecked((prev) => ({ ...prev, [category]: initial }))
      }
    },
    [expandedCategory, activeScores]
  )

  const handleAccordionCheck = useCallback(
    (category: string, factorId: string, checked: boolean) => {
      setAccordionChecked((prev) => {
        const catChecks = { ...(prev[category] || {}) }
        catChecks[factorId] = checked
        const newChecked = { ...prev, [category]: catChecks }
        const factors = SUB_FACTORS[category] || []
        const count = factors.filter((f) => catChecks[f.id]).length
        const newScore = Math.max(1, Math.round((count / factors.length) * 10))
        if (planningMode) {
          setPlannedScores((p) => ({ ...p, [category]: newScore }))
        } else {
          setScores((p) => ({ ...p, [category]: newScore }))
        }
        return newChecked
      })
    },
    [planningMode]
  )

  const openSaveDialog = useCallback(() => {
    const now = new Date()
    const defaultName = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
    setSessionName(defaultName)
    setSaveDialogOpen(true)
  }, [])

  const saveSession = useCallback(() => {
    try {
      const stored = localStorage.getItem("gri_history")
      const history: GRIHistoryEntry[] = stored ? JSON.parse(stored) : []
      history.push({ date: new Date().toISOString(), name: sessionName || t.sessionName, scores: { ...activeScores } })
      if (history.length > 10) history.splice(0, history.length - 10)
      localStorage.setItem("gri_history", JSON.stringify(history))
      toast.success(t.sessionSaved)
      setSaveDialogOpen(false)
    } catch {
      toast.error("Failed to save session")
    }
  }, [activeScores, sessionName, t.sessionSaved, t.sessionName])

  const toggleComparePrevious = useCallback(
    (checked: boolean) => {
      if (checked) {
        try {
          const stored = localStorage.getItem("gri_history")
          if (stored) {
            const history: GRIHistoryEntry[] = JSON.parse(stored)
            if (history.length >= 2) {
              setPreviousScores(history[history.length - 2].scores)
            } else {
              toast.info(t.noHistory)
              return
            }
          } else {
            toast.info(t.noHistory)
            return
          }
        } catch {
          toast.info(t.noHistory)
          return
        }
      }
      setComparePrevious(checked)
    },
    [t.noHistory]
  )

  const generateStrategy = useCallback(async () => {
    setStrategyLoading(true)
    setStrategyText("")
    try {
      const res = await fetch("/api/gri/ai-strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scores: activeScores, lang }),
      })
      const data = await res.json()
      if (data.error) toast.error(t.strategyError)
      else setStrategyText(data.strategy)
    } catch {
      toast.error(t.strategyError)
    } finally {
      setStrategyLoading(false)
    }
  }, [activeScores, lang, t.strategyError])

  useEffect(() => {
    if (!dynamicInsights || strategyLoading) return
    if (dynamicInsightsTimerRef.current) clearTimeout(dynamicInsightsTimerRef.current)
    dynamicInsightsTimerRef.current = setTimeout(() => {
      generateStrategy()
    }, 500)
    return () => {
      if (dynamicInsightsTimerRef.current) clearTimeout(dynamicInsightsTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeScores, dynamicInsights])

  const analyzeFinances = useCallback(async () => {
    if (!financialData.trim()) return
    setFinancialLoading(true)
    setFinancialAnalysis(null)
    setShowMetricChips(false)
    try {
      const res = await fetch("/api/gri/financial-analyst", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ financialData: financialData.trim(), scores: activeScores, lang }),
      })
      const data = await res.json()
      if (data.error) toast.error(t.analysisError)
      else setFinancialAnalysis(data)
    } catch {
      toast.error(t.analysisError)
    } finally {
      setFinancialLoading(false)
    }
  }, [financialData, activeScores, lang, t.analysisError])

  const autoUpdateScores = useCallback(
    (data: typeof financialAnalysis) => {
      if (!data) return
      const csScore = Math.max(1, Math.min(10, data.gri_updates.cash_stability.score))
      const bmScore = Math.max(1, Math.min(10, data.gri_updates.business_model.score))
      autoUpdatedSlidersRef.current = new Set(["Cash Stability", "Business Model"])
      if (planningMode) {
        setPlannedScores((prev) => ({ ...prev, "Cash Stability": csScore, "Business Model": bmScore }))
      } else {
        setScores((prev) => ({ ...prev, "Cash Stability": csScore, "Business Model": bmScore }))
      }
    },
    [planningMode]
  )

  const applyFinancialAnalysis = useCallback(() => {
    if (!financialAnalysis) return
    autoUpdateScores(financialAnalysis)
    toast.success(t.applied)
    setFinancialAnalysis(null)
    setFinancialData("")
    setShowMetricChips(false)
  }, [financialAnalysis, autoUpdateScores, t.applied])

  const runParsingStages = useCallback(() => {
    setParsingStage(1)
    if (parsingTimerRef.current) clearTimeout(parsingTimerRef.current)
    setTimeout(() => setParsingStage(2), 700)
    setTimeout(() => setParsingStage(3), 1400)
    setTimeout(() => setParsingStage(4), 2100)
  }, [])

  const processFileUpload = useCallback(
    async (file: File) => {
      setFileParsing(true)
      setShowMetricChips(false)
      setShowPasteMode(false)
      runParsingStages()
      try {
        if (file.type === "text/csv" || file.name.endsWith(".csv")) {
          const text = await file.text()
          await new Promise((r) => setTimeout(r, 2500))
          setFinancialData(text)
          setFileParsing(false)
          setParsingStage(0)
          toast.success(lang === "ru" ? "Файл загружен" : "File loaded")
        } else {
          const res = await fetch("/api/gri/financial-analyst", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              financialData: `[File: ${file.name}]`,
              fileName: file.name,
              scores: activeScores,
              lang,
            }),
          })
          const data = await res.json()
          if (data.error) {
            toast.error(t.parseError)
          } else {
            setFinancialAnalysis(data)
            autoUpdateScores(data)
            setShowMetricChips(true)
            toast.success(lang === "ru" ? "Файл проанализирован" : "File analyzed")
          }
          setFileParsing(false)
          setParsingStage(0)
        }
      } catch {
        toast.error(t.parseError)
        setFileParsing(false)
        setParsingStage(0)
      }
      if (fileInputRef.current) fileInputRef.current.value = ""
    },
    [activeScores, lang, t.parseError, autoUpdateScores, runParsingStages]
  )

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) processFileUpload(file)
    },
    [processFileUpload]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDropzoneDragging(false)
      const file = e.dataTransfer.files?.[0]
      if (
        file &&
        (file.name.endsWith(".pdf") ||
          file.name.endsWith(".xlsx") ||
          file.name.endsWith(".xls") ||
          file.name.endsWith(".csv"))
      ) {
        processFileUpload(file)
      }
    },
    [processFileUpload]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDropzoneDragging(true)
  }, [])
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDropzoneDragging(false)
  }, [])

  const confirmMetricChips = useCallback(() => {
    if (financialAnalysis) {
      autoUpdateScores(financialAnalysis)
      toast.success(t.metricsConfirmed)
      setShowMetricChips(false)
      setFinancialAnalysis(null)
      setFinancialData("")
    }
  }, [financialAnalysis, autoUpdateScores, t.metricsConfirmed])

  const generateActionPlan = useCallback(async () => {
    setStrategyLoading(true)
    setStrategyText("")
    try {
      const res = await fetch("/api/gri/ai-strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scores: activeScores, lang, format: "action_plan" }),
      })
      const data = await res.json()
      if (data.error) toast.error(t.strategyError)
      else {
        setStrategyText(data.strategy)
        toast.success(t.actionPlanGenerated)
      }
    } catch {
      toast.error(t.strategyError)
    } finally {
      setStrategyLoading(false)
    }
  }, [activeScores, lang, t.strategyError, t.actionPlanGenerated])

  const handlePitchDeck = useCallback(() => {
    const content = [
      `AIStart360 — GRI Pitch Deck`,
      `================================`,
      ``,
      `Date: ${new Date().toLocaleString(lang === "ru" ? "ru-RU" : "en-US")}`,
      `Niche: ${t[`niche_${selectedNiche}`]} | Size: ${t[`size_${selectedSize}`]}`,
      ``,
      `GRI SCORE: ${griScore.toFixed(1)} / 10`,
      `Target: ${TARGET_GRI} / 10`,
      ``,
      `CATEGORY BREAKDOWN:`,
      `─────────────────────`,
      ...CATEGORIES.map((cat) => {
        const s = activeScores[cat]
        const emoji = s < 5 ? "[!]" : s <= 7 ? "[~]" : "[OK]"
        return `  ${emoji} ${categoryTranslations[cat][lang]}: ${s}/10 ${s < 5 ? "(RED ZONE)" : ""}`
      }),
      ``,
      `RED ZONES: ${redZones.length > 0 ? redZones.map((z) => categoryTranslations[z][lang]).join(", ") : "None"}`,
    ].join("\n")
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `GRI_PitchDeck_${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(t.pitchDeckGenerated)
  }, [lang, selectedNiche, selectedSize, t, griScore, activeScores, redZones])

  const handleSaveProfile = useCallback(() => openSaveDialog(), [openSaveDialog])

  const handleDownloadPDF = useCallback(() => {
    const content = [
      `AIStart360 — GRI Calculator Report`,
      `Date: ${new Date().toLocaleString(lang === "ru" ? "ru-RU" : "en-US")}`,
      ``,
      `GRI Score: ${griScore.toFixed(1)} / 10`,
      ``,
      `Category Scores:`,
      ...CATEGORIES.map((cat) => `  ${categoryTranslations[cat][lang]}: ${activeScores[cat]}/10`),
    ].join("\n")
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `GRI_Report_${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(lang === "ru" ? "Отчет скачан" : "Report downloaded")
  }, [lang, griScore, activeScores])

  const handleDownloadJSON = useCallback(() => {
    const exportData = {
      scores: activeScores,
      date: new Date().toISOString(),
      griScore: griScore.toFixed(1),
      niche: selectedNiche,
      companySize: selectedSize,
    }
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `GRI_Data_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(lang === "ru" ? "JSON экспортирован" : "JSON exported")
  }, [activeScores, griScore, selectedNiche, selectedSize])

  const handlePublish = useCallback(() => {
    // Copy the REAL page URL — there is no server-side snapshot backend for the
    // calculator, so we must not hand out a fabricated /preview/<id> link that
    // 404s. A working link to this page is honest. (Audit TR-2, 2026-07-02.)
    const realUrl = typeof window !== 'undefined' ? window.location.href : 'https://aistart360.app/gri'
    navigator.clipboard
      .writeText(realUrl)
      .then(() => {
        toast.success(t.publishLink)
        setPublishDialogOpen(false)
      })
      .catch(() => toast.error(lang === 'ru' ? 'Не удалось скопировать ссылку' : 'Failed to copy link'))
  }, [t.publishLink, lang])

  const openGRIHistory = useCallback(() => {
    try {
      const stored = localStorage.getItem("gri_history")
      const history: GRIHistoryEntry[] = stored ? JSON.parse(stored) : []
      setGriHistory(history)
      setHistoryDialogOpen(true)
    } catch {
      setGriHistory([])
      setHistoryDialogOpen(true)
    }
  }, [])

  const toggleLanguage = useCallback(() => {
    setLang((prev) => (prev === "ru" ? "en" : "ru"))
  }, [])

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
  }
  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" as const } },
  }

  const parsingSteps = [t.parsingStep1, t.parsingStep2, t.parsingStep3, t.parsingStep4]

  const renderBudget = (level: number) => {
    if (level <= 1) return "$"
    if (level <= 2) return "$$"
    return "$$$"
  }

  return (
    <TooltipProvider>
      <div className="gri-calc flex flex-col rounded-2xl overflow-hidden border border-white/[0.06]" style={{ background: "#0a0a0a" }}>
        {/* ── Header ── */}
        <motion.header
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="sticky top-0 z-40 flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.06]"
          style={{ background: "rgba(10, 10, 10, 0.85)", backdropFilter: "blur(16px)" }}
        >
          <div className="flex items-center gap-3">
            <a href="/dashboard" className="flex items-center" aria-label="AIStart360 — на главную">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.svg"
                alt="AIStart360"
                width={140}
                height={28}
                className="h-7 w-auto"
              />
            </a>
            <Badge variant="outline" className="text-[0.6rem] sm:text-xs text-white/40 border-white/10 hidden sm:flex">
              GRI Calculator
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-10 gap-1.5 text-xs px-3">
                  <Download className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{t.download}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleDownloadPDF} className="cursor-pointer gap-2">
                  <FileText className="w-4 h-4" /> {t.downloadPDF}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDownloadJSON} className="cursor-pointer gap-2">
                  <Download className="w-4 h-4" /> {t.downloadJSON}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" onClick={() => setPublishDialogOpen(true)} className="h-10 gap-1.5 text-xs px-3">
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.publish}</span>
            </Button>
            <Button variant="outline" onClick={toggleLanguage} className="h-10 gap-2 text-xs sm:text-sm px-3">
              <Globe className="w-3.5 h-3.5" />
              <span className="font-medium">{lang === "ru" ? "RU" : "EN"}</span>
            </Button>
          </div>
        </motion.header>

        {/* ── Dialogs ── */}
        <Dialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle>{t.publishTitle}</DialogTitle>
              <DialogDescription>{t.publishDesc}</DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <div className="rounded-lg p-3 mb-4 bg-white/[0.03] border border-white/[0.06]">
                <p className="text-xs text-white/50 mb-1">{t.currentGRI}</p>
                <p className="text-2xl font-bold text-white/90 font-mono">{griScore.toFixed(1)}</p>
                <p className="text-[0.65rem] text-white/40 mt-1">
                  {t[`niche_${selectedNiche}`]} · {t[`size_${selectedSize}`]}
                </p>
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setPublishDialogOpen(false)} className="text-xs">
                {t.cancel}
              </Button>
              <Button onClick={handlePublish} className="gap-2 bg-gradient-to-r from-purple-600 to-purple-500 text-white text-xs">
                <Link2 className="w-3.5 h-3.5" />
                {t.generateLink}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle>{t.saveSessionTitle}</DialogTitle>
              <DialogDescription>
                {lang === "ru" ? "Введите название для текущей сессии" : "Enter a name for the current session"}
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Input
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                placeholder={t.sessionNamePlaceholder}
                className="text-sm"
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setSaveDialogOpen(false)} className="text-xs">
                {t.cancel}
              </Button>
              <Button onClick={saveSession} className="gap-2 bg-gradient-to-r from-blue-600 to-blue-500 text-white text-xs">
                <Save className="w-3.5 h-3.5" />
                {t.saveButton}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
          <DialogContent className="sm:max-w-[520px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <History className="w-4 h-4 text-purple-400" />
                {t.griHistory}
              </DialogTitle>
              <DialogDescription>{t.griHistoryDesc}</DialogDescription>
            </DialogHeader>
            <div className="py-4 max-h-[360px] overflow-y-auto gri-slider-scroll">
              {griHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-white/30">
                  <History className="w-8 h-8 mb-2 opacity-50" />
                  <p className="text-sm">{t.noHistoryData}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {griHistory.map((entry, i) => {
                    const entryGRI = computeGRI(entry.scores)
                    const barWidth = (entryGRI / 10) * 100
                    const barColor = entryGRI < 5 ? "#ef4444" : entryGRI <= 7 ? "#f59e0b" : "#10b981"
                    const dateStr = new Date(entry.date).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                    return (
                      <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-white/[0.04]">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-xs font-medium text-white/70 truncate">
                              {entry.name || `${t.sessionName} ${i + 1}`}
                            </p>
                            <span className="text-sm font-bold font-mono tabular-nums ml-2 flex-shrink-0" style={{ color: barColor }}>
                              {entryGRI.toFixed(1)}
                            </span>
                          </div>
                          <p className="text-[0.6rem] text-white/35 mb-1.5">{dateStr}</p>
                          <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${barWidth}%`, backgroundColor: barColor }}
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* ── Main Content ── */}
        <motion.main
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="flex-1 w-full px-4 sm:px-6 py-6 sm:py-8 flex flex-col gap-6"
        >
          {/* ── Alert Card ── */}
          <motion.div variants={itemVariants}>
            <AnimatePresence mode="wait">
              {hasRedZones ? (
                <motion.div key="red-alert" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }}>
                  <Card className="glass-card alert-glow rounded-xl py-4 px-5 sm:px-6">
                    <CardContent className="flex items-start gap-3 p-0">
                      <div className="flex-shrink-0 mt-0.5">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-amber-500/15">
                          <AlertTriangle className="w-4 h-4 text-amber-400" />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">{t.insight}</span>
                        </div>
                        <p className="text-sm text-amber-100/80 leading-relaxed">
                          {t.redZoneAlert}{" "}
                          <span className="font-semibold text-amber-300">
                            ({redZones.map((z) => categoryTranslations[z][lang]).join(", ")})
                          </span>
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ) : (
                <motion.div key="green-alert" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }}>
                  <Card className="glass-card rounded-xl border border-emerald-500/20 py-4 px-5 sm:px-6">
                    <CardContent className="flex items-start gap-3 p-0">
                      <div className="flex-shrink-0 mt-0.5">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-emerald-500/15">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">{t.insight}</span>
                        </div>
                        <p className="text-sm text-emerald-100/80 leading-relaxed">{t.noRedZone}</p>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* ── Chart + Sliders Section ── */}
          <motion.div variants={itemVariants} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Radar Chart */}
            <Card className="glass-card rounded-xl py-5">
              <CardContent className="p-0 px-4 sm:px-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                  <div>
                    <h2 className="text-base font-semibold text-white/90">{t.growthReadinessIndex}</h2>
                    <p className="text-xs text-white/40 mt-0.5">{t.calculatorSubtitle}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select value={selectedNiche} onValueChange={setSelectedNiche}>
                      <SelectTrigger className="w-[160px] text-xs h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["general", "it", "retail", "services", "fintech", "edtech"].map((niche) => (
                          <SelectItem key={niche} value={niche}>
                            {t[`niche_${niche}`]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={selectedSize} onValueChange={setSelectedSize}>
                      <SelectTrigger className="w-[120px] text-xs h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["micro", "small", "medium", "large"].map((size) => (
                          <SelectItem key={size} value={size}>
                            {t[`size_${size}`]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="w-full aspect-square max-w-[480px] mx-auto">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={chartData} cx="50%" cy="50%" outerRadius="72%">
                      <PolarGrid stroke="rgba(255,255,255,0.07)" strokeDasharray="3 3" />
                      <PolarAngleAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.75)", fontSize: 10, fontWeight: 500 }} />
                      <PolarRadiusAxis angle={90} domain={[0, 10]} tickCount={6} tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 9 }} axisLine={false} />
                      <Radar
                        name={t.yourBusiness}
                        dataKey="current"
                        stroke={planningMode ? "#a855f7" : "#2563eb"}
                        fill={planningMode ? "#a855f7" : "#2563eb"}
                        fillOpacity={0.18}
                        strokeWidth={2}
                      />
                      <Radar name={`${t.benchmark}`} dataKey="benchmark" stroke="#10b981" fill="none" strokeWidth={2} strokeDasharray="6 4" />
                      {planningMode && (
                        <Radar name={t.baseState} dataKey="base" stroke="rgba(37, 99, 235, 0.5)" fill="rgba(37, 99, 235, 0.08)" strokeWidth={1.5} strokeDasharray="4 3" />
                      )}
                      {planningMode && (
                        <Radar name={t.plannedState} dataKey="planned" stroke="#a855f7" fill="rgba(168, 85, 247, 0.15)" strokeWidth={2} />
                      )}
                      {comparePrevious && previousScores && (
                        <Radar name={t.previousSession} dataKey="previous" stroke="#f97316" fill="none" strokeWidth={1.5} strokeDasharray="5 3" />
                      )}
                      <Tooltip content={<CustomRadarTooltip lang={lang} />} wrapperStyle={{ outline: "none" }} />
                      <Legend />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Slider Panel */}
            <Card className="glass-card rounded-xl py-5">
              <CardContent className="p-0 px-4 sm:px-6 h-full flex flex-col">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
                  <div>
                    <h2 className="text-base font-semibold text-white/90">{t.calculatorTitle}</h2>
                    <p className="text-xs text-white/40 mt-0.5">{t.calculatorDesc}</p>
                  </div>
                  <Badge variant="outline" className="text-[0.6rem] w-fit">
                    {t.categories}
                  </Badge>
                </div>

                <div className="flex flex-wrap items-center gap-3 mb-4 pb-4 border-b border-white/[0.06]">
                  <div className="flex items-center gap-2">
                    <Switch id="planning-mode" checked={planningMode} onCheckedChange={togglePlanningMode} />
                    <Label htmlFor="planning-mode" className="text-xs text-white/60 cursor-pointer">
                      {t.planningMode}
                    </Label>
                  </div>
                  <Button variant="outline" onClick={openSaveDialog} className="h-10 gap-1.5 text-[0.7rem] px-3">
                    <Save className="w-3 h-3" />
                    {t.saveSession}
                  </Button>
                  <div className="flex items-center gap-2">
                    <Switch id="compare-previous" checked={comparePrevious} onCheckedChange={toggleComparePrevious} />
                    <Label htmlFor="compare-previous" className="text-xs text-white/60 cursor-pointer">
                      {t.comparePrevious}
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id="dynamic-insights" checked={dynamicInsights} onCheckedChange={setDynamicInsights} />
                    <Label htmlFor="dynamic-insights" className="text-xs text-white/60 cursor-pointer">
                      {t.dynamicInsights}
                    </Label>
                  </div>
                </div>

                <div className="flex-1 space-y-4 max-h-[520px] overflow-y-auto gri-slider-scroll pr-1">
                  {CATEGORIES.map((category) => {
                    const score = activeScores[category]
                    const color = getScoreColor(score)
                    const zoneClass = getScoreZoneClass(score)
                    const catLabel = categoryTranslations[category][lang]
                    const isRed = score < 5
                    const scoreExplanation = SCORE_EXPLANATIONS[score]
                    const catTips = CATEGORY_TIPS[category]
                    const tipLevel = score < 5 ? "low" : score <= 7 ? "mid" : "high"
                    const tip = catTips?.[tipLevel]
                    const isAutoUpdating = autoUpdatedSlidersRef.current.has(category)
                    const isExpanded = expandedCategory === category
                    const isImpacted = crossImpactWarnings.has(category)
                    const effort = EFFORT_DATA[category]
                    const delta = planningMode ? plannedScores[category] - baseScores[category] : 0
                    const microInsight = score < 8 ? MICRO_INSIGHTS[category]?.[score < 5 ? "low" : "mid"] : null
                    const factors = SUB_FACTORS[category] || []
                    const accChecked = accordionChecked[category] || {}
                    const checkedCount = factors.filter((f) => accChecked[f.id]).length

                    return (
                      <motion.div key={category} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3 }} className="group">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: isImpacted ? "#f97316" : color }} />
                            <button
                              onClick={() => toggleAccordion(category)}
                              className={`text-sm font-medium cursor-pointer transition-colors flex items-center gap-1 truncate ${
                                isImpacted ? "text-orange-400" : isRed ? "text-red-400" : "text-white/75 hover:text-white"
                              }`}
                            >
                              {catLabel}
                              {isExpanded ? <ChevronUp className="w-3 h-3 text-white/40" /> : <ChevronDown className="w-3 h-3 text-white/40" />}
                            </button>
                            {isRed && (
                              <Badge variant="destructive" className="text-[0.55rem] px-1.5 py-0 h-4">
                                {lang === "ru" ? "КЗ" : "RZ"}
                              </Badge>
                            )}
                            {isImpacted && (
                              <ShadTooltip>
                                <TooltipTrigger asChild>
                                  <span className="cross-impact-warning text-orange-400">
                                    <AlertCircle className="w-3.5 h-3.5" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="micro-insight-tooltip">
                                  <p className="text-[0.65rem] text-orange-300 leading-relaxed">{t.impactWarning}</p>
                                </TooltipContent>
                              </ShadTooltip>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {planningMode && delta > 0 && effort && (
                              <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="hidden sm:flex items-center gap-1 mr-1">
                                <span className="effort-badge effort-badge-time">
                                  <Clock className="w-2.5 h-2.5" />~{Math.round(effort.months * (delta / 3))}
                                  {t.months}
                                </span>
                                <span className="effort-badge effort-badge-budget">
                                  <DollarSign className="w-2.5 h-2.5" />
                                  {renderBudget(Math.round(effort.budget * (delta / 3)))}
                                </span>
                              </motion.div>
                            )}
                            <ShadTooltip>
                              <TooltipTrigger asChild>
                                <span className="text-sm font-mono font-semibold tabular-nums min-w-[28px] text-right cursor-help" style={{ color }}>
                                  {score}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="micro-insight-tooltip">
                                <div className="space-y-2">
                                  <p className="text-xs font-semibold text-white/90">
                                    {score}/10 — {scoreExplanation?.[lang]}
                                  </p>
                                  <div className="border-t border-white/10 pt-2">
                                    <p className="text-[0.65rem] text-purple-300/80 leading-relaxed">{tip?.[lang]}</p>
                                  </div>
                                  {microInsight && (
                                    <div className="border-t border-purple-500/20 pt-2">
                                      <div className="flex items-center gap-1 mb-1">
                                        <Sparkles className="w-2.5 h-2.5 text-purple-400" />
                                        <span className="text-[0.55rem] font-semibold text-purple-400 uppercase">{t.insight}</span>
                                      </div>
                                      <p className="text-[0.6rem] text-white/60 leading-relaxed">{microInsight[lang]}</p>
                                    </div>
                                  )}
                                </div>
                              </TooltipContent>
                            </ShadTooltip>
                          </div>
                        </div>
                        <Slider
                          min={1}
                          max={10}
                          step={1}
                          value={[score]}
                          onValueChange={(val) => handleSliderChange(category, val)}
                          className={`gri-slider ${zoneClass} ${isAutoUpdating ? "slider-auto-updating" : ""}`}
                        />

                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.3, ease: "easeInOut" }}
                              className="overflow-hidden"
                            >
                              <div className="mt-3 ml-4 pl-3 border-l border-white/[0.08] space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-[0.6rem] text-white/40 uppercase tracking-wider font-semibold">{t.subFactorsOf}</span>
                                  <span className="text-[0.6rem] text-white/30">
                                    {checkedCount}/{factors.length} {t.checkedOf}
                                  </span>
                                </div>
                                {factors.map((factor) => (
                                  <label key={factor.id} className="flex items-start gap-2.5 p-1.5 rounded-md hover:bg-white/[0.04] cursor-pointer transition-colors">
                                    <Checkbox
                                      checked={accChecked[factor.id] || false}
                                      onCheckedChange={(checked) => handleAccordionCheck(category, factor.id, !!checked)}
                                      className="mt-0.5"
                                    />
                                    <span className="text-xs text-white/65 leading-relaxed">{factor[lang]}</span>
                                  </label>
                                ))}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* ── Smart Dropzone Financial Analyst ── */}
          <motion.div variants={itemVariants}>
            <Card className="glass-card financial-card-glow rounded-xl py-5">
              <CardContent className="p-0 px-5 sm:px-6">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-cyan-500/15">
                    <BarChart3 className="w-4 h-4 text-cyan-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white/90">{t.financialAnalyst}</h3>
                    <p className="text-[0.65rem] text-white/40">{t.financialAnalystDesc}</p>
                  </div>
                </div>

                <div className="mt-4">
                  {!showPasteMode && !showMetricChips && !fileParsing ? (
                    <div
                      className={`smart-dropzone p-6 flex flex-col items-center justify-center min-h-[140px] ${dropzoneDragging ? "dragging" : ""}`}
                      onDrop={handleDrop}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                    >
                      <FileUp className="w-8 h-8 text-cyan-400/50 mb-3" />
                      <p className="text-sm font-medium text-white/70 mb-1">{t.dropzoneTitle}</p>
                      <p className="text-xs text-white/35 mb-3">{t.dropzoneSubtitle}</p>
                      <div className="flex items-center gap-3 text-xs text-white/40">
                        <span>{t.dropzoneOr}</span>
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="text-cyan-400 hover:text-cyan-300 font-medium underline underline-offset-2 transition-colors"
                        >
                          {t.dropzoneBrowse}
                        </button>
                        <span>{t.dropzoneOr}</span>
                        <button
                          onClick={() => setShowPasteMode(true)}
                          className="text-cyan-400 hover:text-cyan-300 font-medium underline underline-offset-2 transition-colors"
                        >
                          {t.dropzoneOrPaste}
                        </button>
                      </div>
                      <input ref={fileInputRef} type="file" accept=".pdf,.xlsx,.xls,.csv" className="hidden" onChange={handleFileUpload} />
                    </div>
                  ) : showPasteMode && !fileParsing ? (
                    <div className="relative">
                      <Textarea
                        value={financialData}
                        onChange={(e) => setFinancialData(e.target.value)}
                        placeholder={t.pasteFinancialData}
                        className="min-h-[120px] max-h-[240px] pr-20"
                      />
                      <div className="absolute top-2 right-2 flex items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => { setShowPasteMode(false); setFinancialData("") }} className="h-9 px-3 text-xs">
                          <X className="w-3 h-3" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()} className="h-9 px-3 text-xs">
                          <Paperclip className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      <input ref={fileInputRef} type="file" accept=".pdf,.xlsx,.xls,.csv" className="hidden" onChange={handleFileUpload} />
                    </div>
                  ) : null}

                  {fileParsing && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-4 rounded-xl" style={{ background: "rgba(6, 182, 212, 0.06)", border: "1px solid rgba(6, 182, 212, 0.15)" }}>
                      <div className="flex items-center gap-2 mb-3">
                        <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                        <span className="text-xs font-semibold text-cyan-400">{t.parsingFile}</span>
                      </div>
                      <div className="space-y-2">
                        {parsingSteps.map((step, i) => {
                          const stepNum = i + 1
                          const isActive = parsingStage === stepNum
                          const isDone = parsingStage > stepNum
                          return (
                            <div key={i} className={`flex items-center gap-2 ${isActive ? "parsing-step-item" : ""}`} style={{ opacity: isDone ? 0.4 : isActive ? 1 : 0.2 }}>
                              <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${isDone ? "bg-emerald-500/20" : isActive ? "bg-cyan-500/20" : "bg-white/[0.05]"}`}>
                                {isDone ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Loader2 className={`w-3 h-3 ${isActive ? "animate-spin text-cyan-400" : "text-white/20"}`} />}
                              </div>
                              <span className={`text-xs ${isActive ? "text-white/80" : "text-white/40"}`}>{step}</span>
                            </div>
                          )
                        })}
                      </div>
                    </motion.div>
                  )}

                  <AnimatePresence>
                    {showMetricChips && financialAnalysis && (
                      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="mt-4">
                        <p className="text-[0.65rem] font-semibold text-cyan-400/80 uppercase tracking-wider mb-3">{t.extractedMetricsTitle}</p>
                        <div className="flex flex-wrap gap-2 mb-4">
                          {financialAnalysis.extracted_metrics.revenue_trend && financialAnalysis.extracted_metrics.revenue_trend !== "Нет данных" && financialAnalysis.extracted_metrics.revenue_trend !== "No data" && (
                            <span className="metric-chip metric-chip-positive">
                              <TrendingUp className="w-3 h-3" />
                              {t.revenue}: {financialAnalysis.extracted_metrics.revenue_trend}
                            </span>
                          )}
                          {financialAnalysis.extracted_metrics.gross_margin && financialAnalysis.extracted_metrics.gross_margin !== "Нет данных" && financialAnalysis.extracted_metrics.gross_margin !== "No data" && (
                            <span className="metric-chip metric-chip-neutral">
                              <DollarSign className="w-3 h-3" />
                              {t.margin}: {financialAnalysis.extracted_metrics.gross_margin}
                            </span>
                          )}
                          {financialAnalysis.extracted_metrics.net_profit_margin && financialAnalysis.extracted_metrics.net_profit_margin !== "Нет данных" && financialAnalysis.extracted_metrics.net_profit_margin !== "No data" && (
                            <span className="metric-chip metric-chip-positive">
                              <TrendingUp className="w-3 h-3" />
                              {t.netProfitMargin}: {financialAnalysis.extracted_metrics.net_profit_margin}
                            </span>
                          )}
                          {financialAnalysis.mckinsey_insights.length > 0 && (
                            <span className="metric-chip metric-chip-negative">
                              <AlertTriangle className="w-3 h-3" />
                              {t.weakSpot}: {financialAnalysis.mckinsey_insights[0]?.slice(0, 40)}...
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button onClick={confirmMetricChips} className="confirm-metrics-btn gap-2 bg-gradient-to-r from-cyan-600 to-cyan-500 text-white text-xs rounded-lg px-4 py-2">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {t.confirmMetrics}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => { setShowMetricChips(false); setFinancialAnalysis(null) }} className="text-xs">
                            <X className="w-3 h-3 mr-1" />
                            {t.close}
                          </Button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {showPasteMode && (
                  <div className="flex items-center gap-3 mt-3">
                    <Button onClick={analyzeFinances} disabled={financialLoading || !financialData.trim()} className="gap-2 bg-gradient-to-r from-cyan-600 to-cyan-500 text-white px-4 py-2 text-xs rounded-lg">
                      {financialLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                      {financialLoading ? t.analyzingFinances : t.analyzeFinances}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Financial Analysis Results */}
          <AnimatePresence>
            {financialAnalysis && !showMetricChips && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} variants={itemVariants}>
                <Card className="glass-card financial-results-glow rounded-xl py-5">
                  <CardContent className="p-0 px-5 sm:px-6">
                    <div className="flex items-center justify-between mb-5">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-cyan-500/15">
                          <DollarSign className="w-4 h-4 text-cyan-400" />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-white/90">{t.analysisTitle}</h3>
                          <p className="text-[0.65rem] text-white/40">{t.analysisDesc}</p>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" aria-label="Очистить" onClick={() => { setFinancialAnalysis(null); setFinancialData(""); setShowPasteMode(false) }} className="h-10 w-10 p-0">
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div className="space-y-4">
                        <h4 className="text-xs font-semibold text-cyan-400/90 uppercase tracking-wider flex items-center gap-1.5">
                          <ArrowLeftRight className="w-3 h-3" />
                          {t.scoreUpdate}
                        </h4>
                        <div className="rounded-lg p-3" style={{ background: "rgba(6, 182, 212, 0.06)", border: "1px solid rgba(6, 182, 212, 0.12)" }}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium text-white/70">{t.financialStability}</span>
                            <span className="text-lg font-bold font-mono tabular-nums" style={{ color: getScoreColor(financialAnalysis.gri_updates.cash_stability.score) }}>
                              {financialAnalysis.gri_updates.cash_stability.score}/10
                            </span>
                          </div>
                          <p className="text-[0.7rem] text-white/50 leading-relaxed">{financialAnalysis.gri_updates.cash_stability.justification}</p>
                        </div>
                        <div className="rounded-lg p-3" style={{ background: "rgba(168, 85, 247, 0.06)", border: "1px solid rgba(168, 85, 247, 0.12)" }}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium text-white/70">{t.businessModelScore}</span>
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
                            {t.extractedMetrics}
                          </h4>
                          <div className="grid grid-cols-3 gap-2">
                            {[
                              { label: t.revenueTrend, val: financialAnalysis.extracted_metrics.revenue_trend },
                              { label: t.grossMargin, val: financialAnalysis.extracted_metrics.gross_margin },
                              { label: t.netProfitMargin, val: financialAnalysis.extracted_metrics.net_profit_margin },
                            ].map((m, i) => (
                              <div key={i} className="rounded-lg p-2.5 text-center bg-white/[0.03] border border-white/[0.06]">
                                <p className="text-[0.6rem] text-white/40 mb-1">{m.label}</p>
                                <p className="text-sm font-semibold text-white/80 font-mono">
                                  {m.val === "Нет данных" || m.val === "No data" ? t.noData : m.val}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <h4 className="text-xs font-semibold text-cyan-400/90 uppercase tracking-wider flex items-center gap-1.5 mb-3">
                            <TrendingDown className="w-3 h-3" />
                            {t.insights}
                          </h4>
                          <div className="space-y-2">
                            {financialAnalysis.mckinsey_insights.map((insight, i) => (
                              <div key={i} className="rounded-lg p-3 flex items-start gap-2.5" style={{ background: "rgba(245, 158, 11, 0.06)", border: "1px solid rgba(245, 158, 11, 0.12)" }}>
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
                        {t.applyToDashboard}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Split Button — Strategy/Export */}
          <motion.div variants={itemVariants}>
            <AnimatePresence>
              {!strategyText && !strategyLoading && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex justify-center">
                  <div className="flex">
                    <Button onClick={generateStrategy} className="split-button-main gap-2 bg-gradient-to-r from-purple-600 to-purple-500 text-white px-6 py-5 text-sm font-medium">
                      <Sparkles className="w-4 h-4" />
                      {t.generateStrategy}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button className="split-button-caret bg-purple-600 text-white px-3 py-5">
                          <ChevronDown className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" sideOffset={8} className="w-[240px]">
                        <DropdownMenuItem onClick={generateActionPlan} className="cursor-pointer gap-3 py-2.5">
                          <ClipboardList className="w-4 h-4 text-purple-400" />
                          <div>
                            <p className="text-xs font-medium">{t.actionPlan}</p>
                            <p className="text-[0.6rem] text-white/40">{t.actionPlanDesc}</p>
                          </div>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handlePitchDeck} className="cursor-pointer gap-3 py-2.5">
                          <Presentation className="w-4 h-4 text-cyan-400" />
                          <div>
                            <p className="text-xs font-medium">{t.pitchDeckPDF}</p>
                            <p className="text-[0.6rem] text-white/40">{t.pitchDeckDesc}</p>
                          </div>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={handleSaveProfile} className="cursor-pointer gap-3 py-2.5">
                          <Database className="w-4 h-4 text-blue-400" />
                          <div>
                            <p className="text-xs font-medium">{t.saveProfileSupabase}</p>
                            <p className="text-[0.6rem] text-white/40">{t.saveProfileDesc}</p>
                          </div>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {strategyLoading && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex justify-center">
                  <Button disabled className="gap-2 bg-purple-600/50 text-purple-200 px-6 py-5 text-sm rounded-xl">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t.generatingStrategy}
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Strategy Result */}
          <AnimatePresence>
            {strategyText && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} variants={itemVariants}>
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
                      <Button variant="ghost" size="sm" aria-label="Очистить" onClick={() => setStrategyText("")} className="h-10 w-10 p-0">
                        <X className="w-3.5 h-3.5" />
                      </Button>
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

          {/* KPI Metrics */}
          <motion.div variants={itemVariants} className={`grid gap-4 sm:gap-6 ${planningMode ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2"}`}>
            <Card className="glass-card kpi-card-glow-blue rounded-xl py-5">
              <CardContent className="p-0 px-5 sm:px-6">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-500/15">
                    <TrendingUp className="w-4 h-4 text-[#2563eb]" />
                  </div>
                  <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">
                    {planningMode ? t.baseGRI : t.currentGRI}
                  </span>
                </div>
                <div className="flex items-end gap-2">
                  <span className="text-4xl sm:text-5xl font-bold text-white gri-score-clickable" onClick={openGRIHistory} title={t.griHistory}>
                    <AnimatedGRI value={displayGri} />
                  </span>
                  <span className="text-sm text-white/30 mb-1.5">/ 10</span>
                </div>
                <p className="text-xs text-white/35 mt-2">{t.griSubtitle}</p>
                <div className="mt-3 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: displayGri < 5 ? "#ef4444" : displayGri <= 7 ? "#f59e0b" : "#10b981" }}
                    initial={{ width: 0 }}
                    animate={{ width: `${(displayGri / 10) * 100}%` }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                  />
                </div>
              </CardContent>
            </Card>

            {planningMode && (
              <Card className="glass-card kpi-card-glow-purple rounded-xl py-5">
                <CardContent className="p-0 px-5 sm:px-6">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-purple-500/15">
                      <Sparkles className="w-4 h-4 text-[#a855f7]" />
                    </div>
                    <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">{t.plannedGRI}</span>
                  </div>
                  <div className="flex items-end gap-2">
                    <span className="text-4xl sm:text-5xl font-bold text-[#a855f7]">
                      <AnimatedGRI value={plannedGRI} />
                    </span>
                    <span className="text-sm text-white/30 mb-1.5">/ 10</span>
                  </div>
                  <p className="text-xs text-white/35 mt-2">
                    {plannedGRI > griScore ? (
                      <span className="text-purple-400">
                        +{(plannedGRI - griScore).toFixed(1)} {lang === "ru" ? "к базовому" : "vs base"}
                      </span>
                    ) : plannedGRI < griScore ? (
                      <span className="text-red-400">
                        {(plannedGRI - griScore).toFixed(1)} {lang === "ru" ? "к базовому" : "vs base"}
                      </span>
                    ) : (
                      <span className="text-white/50">{lang === "ru" ? "Равно базовому" : "Same as base"}</span>
                    )}
                  </p>
                  <div className="mt-3 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-[#a855f7]"
                      initial={{ width: 0 }}
                      animate={{ width: `${(plannedGRI / 10) * 100}%` }}
                      transition={{ duration: 0.6, ease: "easeOut" }}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="glass-card kpi-card-glow-green rounded-xl py-5">
              <CardContent className="p-0 px-5 sm:px-6">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-emerald-500/15">
                    <Target className="w-4 h-4 text-[#10b981]" />
                  </div>
                  <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">{t.targetGRI}</span>
                </div>
                <div className="flex items-end gap-2">
                  <span className="text-4xl sm:text-5xl font-bold text-[#10b981]">{TARGET_GRI.toFixed(1)}</span>
                  <span className="text-sm text-white/30 mb-1.5">+</span>
                  <ArrowUpRight className="w-4 h-4 text-[#10b981] mb-1.5" />
                </div>
                <p className="text-xs text-white/35 mt-2">{t.targetSubtitle}</p>
                <div className="mt-3 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-[#10b981]"
                    initial={{ width: 0 }}
                    animate={{ width: `${(TARGET_GRI / 10) * 100}%` }}
                    transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
                  />
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </motion.main>

        {/* Footer */}
        <motion.footer initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }} className="mt-auto border-t border-white/[0.06] px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-white/25">© {new Date().getFullYear()} AIStart360</p>
            <p className="text-xs text-white/25">
              {lang === "ru" ? "Оценка готовности к масштабированию" : "Scaling Readiness Assessment"}
            </p>
          </div>
        </motion.footer>
      </div>
    </TooltipProvider>
  )
}
