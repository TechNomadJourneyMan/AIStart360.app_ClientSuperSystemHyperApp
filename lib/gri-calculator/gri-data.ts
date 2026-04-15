// GRI Calculator — All Data Constants

// ─────────────────────────────────────────────────────
// Categories
// ─────────────────────────────────────────────────────

export const CATEGORIES = [
  "Product & Demand",
  "Trust & Positioning",
  "Business Model",
  "Cash Stability",
  "Operations",
  "Team",
  "Founder Ready",
] as const;

// ─────────────────────────────────────────────────────
// Default Scores
// ─────────────────────────────────────────────────────

export const DEFAULT_SCORES: Record<string, number> = {
  "Product & Demand": 5,
  "Trust & Positioning": 4,
  "Business Model": 3,
  "Cash Stability": 6,
  "Operations": 2,
  "Team": 5,
  "Founder Ready": 4,
};

// ─────────────────────────────────────────────────────
// Target GRI
// ─────────────────────────────────────────────────────

export const TARGET_GRI = 8.5;

// ─────────────────────────────────────────────────────
// Sub-factors per Category
// ─────────────────────────────────────────────────────

export const SUB_FACTORS: Record<
  string,
  { id: string; ru: string; en: string }[]
> = {
  "Product & Demand": [
    { id: "pmf", ru: "Product-Market Fit подтвержден", en: "Product-Market Fit validated" },
    { id: "demand_validated", ru: "Спрос подтвержден данными", en: "Demand validated with data" },
    { id: "unit_economics", ru: "Положительная юнит-экономика", en: "Positive unit economics" },
    { id: "retention", ru: "Удержание пользователей > 40%", en: "User retention > 40%" },
    { id: "feedback_loop", ru: "Петля обратной связи", en: "Feedback loop established" },
  ],
  "Trust & Positioning": [
    { id: "brand_recognition", ru: "Узнаваемость бренда", en: "Brand recognition" },
    { id: "reviews", ru: "Положительные отзывы", en: "Positive reviews/testimonials" },
    { id: "expert_positioning", ru: "Экспертное позиционирование", en: "Expert positioning" },
    { id: "partnerships", ru: "Стратегические партнерства", en: "Strategic partnerships" },
    { id: "content_marketing", ru: "Контент-маркетинг", en: "Content marketing active" },
  ],
  "Business Model": [
    { id: "recurring_rev", ru: "Регулярный доход", en: "Recurring revenue stream" },
    { id: "scalable", ru: "Масштабируемость модели", en: "Scalable model" },
    { id: "diversified", ru: "Диверсификация доходов", en: "Revenue diversification" },
    { id: "pricing_power", ru: "Ценовая власть", en: "Pricing power" },
    { id: "automation", ru: "Автоматизация процессов", en: "Process automation" },
  ],
  "Cash Stability": [
    { id: "cash_reserve", ru: "Запас денег на 3+ месяца", en: "3+ month cash reserve" },
    { id: "positive_flow", ru: "Положительный денежный поток", en: "Positive cash flow" },
    { id: "access_to_capital", ru: "Доступ к капиталу", en: "Access to capital" },
    { id: "low_debt", ru: "Низкая долговая нагрузка", en: "Low debt burden" },
    { id: "financial_controls", ru: "Финансовый контроль", en: "Financial controls in place" },
  ],
  "Operations": [
    { id: "documented_processes", ru: "Документированные процессы", en: "Documented processes" },
    { id: "kpi_tracking", ru: "Отслеживание KPI", en: "KPI tracking system" },
    { id: "team_ops", ru: "Операционная команда", en: "Operations team in place" },
    { id: "tech_stack", ru: "Стабильный tech stack", en: "Stable tech stack" },
    { id: "quality_control", ru: "Контроль качества", en: "Quality control system" },
  ],
  "Team": [
    { id: "core_team", ru: "Ядро команды укомплектовано", en: "Core team complete" },
    { id: "skills_coverage", ru: "Покрытие ключевых навыков", en: "Key skills covered" },
    { id: "culture", ru: "Сильная культура", en: "Strong team culture" },
    { id: "retention_team", ru: "Низкая текучесть", en: "Low turnover rate" },
    { id: "hiring_pipeline", ru: "Воронка найма", en: "Hiring pipeline active" },
  ],
  "Founder Ready": [
    { id: "vision", ru: "Четкое видение", en: "Clear vision articulated" },
    { id: "delegation", ru: "Делегирование", en: "Delegation capability" },
    { id: "resilience", ru: "Стрессоустойчивость", en: "Stress resilience" },
    { id: "network", ru: "Профессиональная сеть", en: "Professional network" },
    { id: "learning", ru: "Постоянное обучение", en: "Continuous learning" },
  ],
};

// ─────────────────────────────────────────────────────
// Score Explanations
// ─────────────────────────────────────────────────────

export const SCORE_EXPLANATIONS: Record<
  number,
  { ru: string; en: string }
> = {
  1: { ru: "Критический уровень. Требуется немедленное вмешательство.", en: "Critical level. Immediate intervention required." },
  2: { ru: "Очень слабый. Значительные риски для бизнеса.", en: "Very weak. Significant business risks." },
  3: { ru: "Слабый. Серьезные пробелы необходимо закрыть.", en: "Weak. Serious gaps need to be closed." },
  4: { ru: "Ниже среднего. Требует внимания и улучшений.", en: "Below average. Needs attention and improvements." },
  5: { ru: "Средний уровень. Базовая готовность присутствует.", en: "Average. Basic readiness is present." },
  6: { ru: "Выше среднего. Хорошая основа для роста.", en: "Above average. Good foundation for growth." },
  7: { ru: "Хороший уровень. Устойчивая позиция.", en: "Good level. Strong position." },
  8: { ru: "Отлично. Минимальные точки роста.", en: "Excellent. Minimal areas for improvement." },
  9: { ru: "Выдающийся. Почти идеальный результат.", en: "Outstanding. Near-perfect result." },
  10: { ru: "Идеал. Эталонное выполнение.", en: "Perfect. Benchmark performance." },
};

// ─────────────────────────────────────────────────────
// Category-specific Tips
// ─────────────────────────────────────────────────────

export const CATEGORY_TIPS: Record<
  string,
  { low: { ru: string; en: string }; mid: { ru: string; en: string }; high: { ru: string; en: string } }
> = {
  "Product & Demand": {
    low: { ru: "Проведите Customer Discovery интервью минимум с 20 клиентами.", en: "Conduct Customer Discovery interviews with at least 20 clients." },
    mid: { ru: "Усилите продуктовые метрики и воронку конверсии.", en: "Strengthen product metrics and conversion funnel." },
    high: { ru: "Масштабируйте через новые каналы привлечения.", en: "Scale through new acquisition channels." },
  },
  "Trust & Positioning": {
    low: { ru: "Запустите программу сбора отзывов и кейсов.", en: "Launch a review and case study collection program." },
    mid: { ru: "Инвестируйте в thought leadership и контент.", en: "Invest in thought leadership and content." },
    high: { ru: "Позиционируйтесь как лидер мнений в нише.", en: "Position yourself as a thought leader in the niche." },
  },
  "Business Model": {
    low: { ru: "Пересмотрите ценностное предложение и бизнес-модель.", en: "Revisit your value proposition and business model." },
    mid: { ru: "Автоматизируйте рутинные процессы для роста маржинальности.", en: "Automate routine processes to improve margins." },
    high: { ru: "Исследуйте новые рыночные сегменты и модели дохода.", en: "Explore new market segments and revenue models." },
  },
  "Cash Stability": {
    low: { ru: "Срочно пересмотрите бюджет и сократите непроизводительные расходы.", en: "Urgently review budget and cut non-productive expenses." },
    mid: { ru: "Создайте финансовую подушку в 3+ месяца операционных расходов.", en: "Build a 3+ month financial runway." },
    high: { ru: "Оптимизируйте денежные потоки и инвестируйте излишки.", en: "Optimize cash flows and invest surpluses." },
  },
  "Operations": {
    low: { ru: "Документируйте ключевые бизнес-процессы.", en: "Document key business processes." },
    mid: { ru: "Внедрите систему контроля качества и метрик.", en: "Implement quality control and metrics system." },
    high: { ru: "Автоматизируйте операции и масштабируйте без потери качества.", en: "Automate operations and scale without quality loss." },
  },
  "Team": {
    low: { ru: "Определите ключевые роли и начните нанимать.", en: "Define key roles and start hiring." },
    mid: { ru: "Развивайте корпоративную культуру и программу удержания.", en: "Develop company culture and retention program." },
    high: { ru: "Масштабируйте команду параллельно с ростом бизнеса.", en: "Scale the team in parallel with business growth." },
  },
  "Founder Ready": {
    low: { ru: "Сосредоточьтесь на развитии лидерских компетенций.", en: "Focus on developing leadership competencies." },
    mid: { ru: "Начните делегировать операционные задачи.", en: "Start delegating operational tasks." },
    high: { ru: "Станьте стратегом — работайте ON бизнес, а не IN бизнес.", en: "Become the strategist — work ON the business, not IN it." },
  },
};

// ─────────────────────────────────────────────────────
// Niche Benchmarks
// ─────────────────────────────────────────────────────

export const NICHE_BENCHMARKS: Record<string, Record<string, number>> = {
  general: {
    "Product & Demand": 8,
    "Trust & Positioning": 7,
    "Business Model": 9,
    "Cash Stability": 8,
    "Operations": 7,
    "Team": 8,
    "Founder Ready": 9,
  },
  it: {
    "Product & Demand": 9,
    "Trust & Positioning": 6,
    "Business Model": 8,
    "Cash Stability": 7,
    "Operations": 8,
    "Team": 9,
    "Founder Ready": 8,
  },
  retail: {
    "Product & Demand": 8,
    "Trust & Positioning": 8,
    "Business Model": 7,
    "Cash Stability": 9,
    "Operations": 9,
    "Team": 7,
    "Founder Ready": 7,
  },
  services: {
    "Product & Demand": 7,
    "Trust & Positioning": 9,
    "Business Model": 7,
    "Cash Stability": 7,
    "Operations": 6,
    "Team": 8,
    "Founder Ready": 9,
  },
  fintech: {
    "Product & Demand": 8,
    "Trust & Positioning": 8,
    "Business Model": 9,
    "Cash Stability": 9,
    "Operations": 8,
    "Team": 8,
    "Founder Ready": 8,
  },
  edtech: {
    "Product & Demand": 7,
    "Trust & Positioning": 7,
    "Business Model": 6,
    "Cash Stability": 6,
    "Operations": 7,
    "Team": 7,
    "Founder Ready": 8,
  },
};

export const SIZE_MULTIPLIERS: Record<string, Record<string, number>> = {
  micro: {
    "Product & Demand": -1,
    "Trust & Positioning": -1,
    "Business Model": -1,
    "Cash Stability": -2,
    "Operations": -2,
    "Team": -2,
    "Founder Ready": 0,
  },
  small: {
    "Product & Demand": 0,
    "Trust & Positioning": 0,
    "Business Model": 0,
    "Cash Stability": -1,
    "Operations": -1,
    "Team": -1,
    "Founder Ready": 0,
  },
  medium: {
    "Product & Demand": 0,
    "Trust & Positioning": 0,
    "Business Model": 1,
    "Cash Stability": 0,
    "Operations": 0,
    "Team": 0,
    "Founder Ready": 0,
  },
  large: {
    "Product & Demand": 1,
    "Trust & Positioning": 1,
    "Business Model": 1,
    "Cash Stability": 1,
    "Operations": 1,
    "Team": 1,
    "Founder Ready": 0,
  },
};

export function getBlendedBenchmark(niche: string, size: string): Record<string, number> {
  const base = NICHE_BENCHMARKS[niche] || NICHE_BENCHMARKS.general;
  const modifiers = SIZE_MULTIPLIERS[size] || SIZE_MULTIPLIERS.small;
  const blended: Record<string, number> = {};
  for (const cat of CATEGORIES) {
    blended[cat] = Math.max(1, Math.min(10, (base[cat] || 7) + (modifiers[cat] || 0)));
  }
  return blended;
}

// ─────────────────────────────────────────────────────
// Helper: color by score zone
// ─────────────────────────────────────────────────────

export function getScoreColor(score: number): string {
  if (score < 5) return "#ef4444";
  if (score <= 7) return "#f59e0b";
  return "#10b981";
}

export function getScoreZoneClass(score: number): string {
  if (score < 5) return "gri-slider-red";
  if (score <= 7) return "gri-slider-yellow";
  return "gri-slider-green";
}

// ─────────────────────────────────────────────────────
// Cross-impact relationships (system thinking)
// ─────────────────────────────────────────────────────

export const CROSS_IMPACTS: Record<string, string[]> = {
  "Product & Demand": ["Operations", "Team"],
  "Trust & Positioning": ["Team"],
  "Business Model": ["Cash Stability", "Operations"],
  "Cash Stability": ["Operations"],
  "Operations": ["Team", "Cash Stability"],
  "Team": ["Operations", "Founder Ready"],
  "Founder Ready": ["Team"],
};

// ─────────────────────────────────────────────────────
// Effort estimates for planning mode
// ─────────────────────────────────────────────────────

export const EFFORT_DATA: Record<string, { ru: string; en: string; months: number; budget: number }> = {
  "Product & Demand":    { ru: "Customer Discovery + MVP доработка", en: "Customer Discovery + MVP refinement", months: 3, budget: 2 },
  "Trust & Positioning": { ru: "Бренд-стратегия + контент-план", en: "Brand strategy + content plan", months: 2, budget: 1 },
  "Business Model":      { ru: "Пересмотр монетизации + тесты", en: "Monetization review + testing", months: 4, budget: 3 },
  "Cash Stability":      { ru: "Финансовое планирование + сокращение кэшбёрна", en: "Financial planning + burn reduction", months: 2, budget: 1 },
  "Operations":          { ru: "Документирование + внедрение ERP/CRM", en: "Documentation + ERP/CRM implementation", months: 3, budget: 2 },
  "Team":                { ru: "Найм + онбординг + развитие культуры", en: "Hiring + onboarding + culture building", months: 4, budget: 3 },
  "Founder Ready":       { ru: "Коучинг + делегирование + обучение", en: "Coaching + delegation + training", months: 2, budget: 1 },
};

// ─────────────────────────────────────────────────────
// Micro-insights for contextual AI tooltips
// ─────────────────────────────────────────────────────

export const MICRO_INSIGHTS: Record<string, Record<string, { ru: string; en: string }>> = {
  "Product & Demand": {
    low: { ru: "Нет Product-Market Fit — 90% стартапов проваливаются по этой причине. Проведите 20+ CustDev интервью.", en: "No Product-Market Fit — 90% of startups fail for this reason. Conduct 20+ CustDev interviews." },
    mid: { ru: "PMF не подтвержден количественно. Измерьте retention > 40% и конверсию.", en: "PMF not quantitatively confirmed. Measure retention > 40% and conversion rate." },
  },
  "Trust & Positioning": {
    low: { ru: "Нулевая узнаваемость. Без доверия клиентов CAC будет неконтролируемо расти.", en: "Zero brand awareness. Without customer trust, CAC will grow uncontrollably." },
    mid: { ru: "Доверие формируется, но нет экспертного позиционирования. Станьте голосом индустрии.", en: "Trust is forming, but no expert positioning. Become the voice of the industry." },
  },
  "Business Model": {
    low: { ru: "Высокий отток (Churn). Модель не выдержит масштабирования без внедрения подписок.", en: "High churn rate. The model won't survive scaling without introducing subscriptions." },
    mid: { ru: "Модель работает, но маржинальность низкая. Автоматизируйте для роста прибыли.", en: "Model works, but margins are low. Automate to increase profitability." },
  },
  "Cash Stability": {
    low: { ru: "Runway < 3 месяца. Критический уровень — нужен немедленный пересмотр кэшфлоу.", en: "Runway < 3 months. Critical level — immediate cash flow review needed." },
    mid: { ru: "Нестабильный денежный поток. Создайте финансовую подушку 6+ месяцев.", en: "Unstable cash flow. Build a 6+ month financial cushion." },
  },
  "Operations": {
    low: { ru: "Хаос в процессах. Масштабирование усугубит проблемы 10x. Документируйте сейчас.", en: "Chaos in processes. Scaling will amplify problems 10x. Document now." },
    mid: { ru: "Базовые процессы есть, но нет метрик качества. Внедрите KPI и QC.", en: "Basic processes exist, but no quality metrics. Implement KPIs and QC." },
  },
  "Team": {
    low: { ru: "Команда не укомплектована. Фаундер выгорает — нанимайте или рискуете провалом.", en: "Team incomplete. Founder is burning out — hire or risk failure." },
    mid: { ru: "Ядро есть, но не хватает ключевых компетенций. Определите gap и нанимайте.", en: "Core exists, but key skills are missing. Identify the gap and hire." },
  },
  "Founder Ready": {
    low: { ru: "Микроменеджмент тормозит рост. Начните делегировать — вы бутылочное горлышко.", en: "Micromanagement slows growth. Start delegating — you're the bottleneck." },
    mid: { ru: "Видение есть, но делегирование слабое. Работайте ON бизнес, а не IN бизнес.", en: "Vision exists, but delegation is weak. Work ON the business, not IN it." },
  },
};

// ─────────────────────────────────────────────────────
// History type for localStorage
// ─────────────────────────────────────────────────────

export interface GRIHistoryEntry {
  date: string;
  name: string;
  scores: Record<string, number>;
}
