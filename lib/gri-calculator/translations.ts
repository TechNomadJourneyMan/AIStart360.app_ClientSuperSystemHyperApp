// GRI Calculator — Internationalization Translations

export type Language = "ru" | "en";

export interface CategoryTranslations {
  ru: string;
  en: string;
}

/** All 7 GRI categories with their localized names */
export const categoryTranslations: Record<string, CategoryTranslations> = {
  "Product & Demand": { ru: "Продукт и Спрос", en: "Product & Demand" },
  "Trust & Positioning": { ru: "Доверие и Позиционирование", en: "Trust & Positioning" },
  "Business Model": { ru: "Бизнес-модель", en: "Business Model" },
  "Cash Stability": { ru: "Финансовая Устойчивость", en: "Cash Stability" },
  "Operations": { ru: "Операции", en: "Operations" },
  "Team": { ru: "Команда", en: "Team" },
  "Founder Ready": { ru: "Готовность Основателя", en: "Founder Ready" },
};

export const translations: Record<Language, Record<string, string>> = {
  ru: {
    // Header
    logo: "AIStart360",
    language: "Язык",

    // KPI
    currentGRI: "ТЕКУЩИЙ GRI",
    targetGRI: "ЦЕЛЬ GRI",
    griSubtitle: "Средний балл по 7 категориям",
    targetSubtitle: "Целевой показатель масштабирования",

    // Alert
    insight: "Инсайт",
    redZoneAlert: "Вы не можете масштабировать хаос. Сначала исправьте 'Красные Зоны'",
    noRedZone: "Отличная работа! Ваш бизнес готов к масштабированию. Продолжайте в том же духе!",

    // Chart
    yourBusiness: "Ваш Бизнес",
    benchmark: "Эталон",

    // Misc
    score: "Балл",
    of10: "из 10",
    calculatorTitle: "Калькулятор GRI",
    calculatorSubtitle: "Оцените готовность вашего бизнеса к масштабированию",
    growthReadinessIndex: "Индекс Готовности к Росту",
    calculatorDesc: "Настройте оценки для каждой категории",
    categories: "7 категорий",

    // Planning Mode
    planningMode: "Режим планирования",
    planningModeDesc: "Создайте плановые оценки для сравнения",
    baseGRI: "БАЗОВЫЙ GRI",
    plannedGRI: "ПЛАНОВЫЙ GRI",
    baseState: "Базовое состояние",
    plannedState: "Плановое состояние",

    // History
    saveSession: "Сохранить сессию",
    comparePrevious: "Сравнить с прошлым",
    noHistory: "Нет сохраненных данных",
    sessionSaved: "Сессия сохранена!",
    previousSession: "Предыдущая сессия",

    // Drill-down
    drillDownTitle: "Детальный анализ",
    calculatedScore: "Расчетный балл",
    applyScore: "Применить",
    subFactors: "Подфакторы",
    close: "Закрыть",
    subFactorsOf: "Подфакторы",
    checkedOf: "отмечено",

    // AI Strategy
    generateStrategy: "Сгенерировать стратегию роста",
    generatingStrategy: "Генерация стратегии...",
    strategyTitle: "AI Стратегия Роста",
    strategyDesc: "Анализ на основе ваших оценок GRI",
    strategyClose: "Закрыть стратегию",
    strategyError: "Ошибка генерации стратегии. Попробуйте позже.",

    // Niche Benchmarking
    nicheLabel: "Ниша",
    nicheDesc: "Выберите отрасль для сравнения",
    niche_general: "Общий",
    niche_it: "IT / Технологии",
    niche_retail: "Ритейл / E-commerce",
    niche_services: "Услуги / Консалтинг",
    niche_fintech: "FinTech",
    niche_edtech: "EdTech",

    // Tooltips
    tooltipHint: "Наведите для подробностей",

    // Financial Analyst
    financialAnalyst: "Финансовый Аналитик",
    financialAnalystDesc: "Загрузите финансовый отчет или вставьте данные для AI-анализа",
    pasteFinancialData: "Вставьте финансовые данные (P&L, Cash Flow, баланс)...",
    analyzeFinances: "Анализировать финансы",
    analyzingFinances: "Анализ...",
    analysisError: "Ошибка анализа. Проверьте данные и попробуйте снова.",
    analysisTitle: "AI Финансовый Анализ",
    analysisDesc: "Результаты анализа на основе ваших финансовых данных",
    applyToDashboard: "Применить к дашборду",
    applied: "Оценки обновлены на основе финансового анализа!",
    financialStability: "Финансовая Устойчивость",
    businessModelScore: "Бизнес-модель",
    extractedMetrics: "Извлеченные Метрики",
    revenueTrend: "Динамика Выручки",
    grossMargin: "Валовая Маржа",
    netProfitMargin: "Чистая Маржа",
    insights: "Инсайты McKinsey",
    scoreUpdate: "Обновление оценки",
    justification: "Обоснование",
    noData: "Нет данных",

    // Company Size
    companySize: "Размер компании",
    size_micro: "Микро",
    size_small: "Малый",
    size_medium: "Средний",
    size_large: "Крупный",

    // Dynamic Insights
    dynamicInsights: "Динамические инсайты",

    // Download & Publish
    download: "Скачать",
    publish: "Опубликовать",
    downloadTooltip: "Скачать отчет (PDF) или экспорт данных (JSON)",
    publishTooltip: "Сгенерировать публичную ссылку с предпросмотром",
    downloadPDF: "PDF Отчет",
    downloadJSON: "JSON Экспорт",
    publishTitle: "Опубликовать дашборд",
    publishDesc: "Сгенерируйте ссылку для совместного доступа к результатам диагностики",
    publishLink: "Ссылка скопирована!",
    generateLink: "Сгенерировать ссылку",
    sessionName: "Название сессии",
    sessionNamePlaceholder: "Введите название...",
    saveSessionTitle: "Сохранить сессию",
    saveButton: "Сохранить",
    cancel: "Отменить",

    // File Upload — Smart Dropzone
    attachFile: "Прикрепить файл",
    attachFileTooltip: "Загрузить PDF или Excel",
    parsingFile: "Парсинг файла...",
    parseError: "Ошибка чтения файла",
    extractedMetricsTitle: "Извлеченные метрики AI",
    dropzoneTitle: "Загрузите финансовый отчет",
    dropzoneSubtitle: "Перетащите PDF, Excel или CSV сюда",
    dropzoneOr: "или",
    dropzoneBrowse: "выберите файл",
    dropzoneOrPaste: "или вставьте данные вручную",
    parsingStep1: "Извлекаю P&L...",
    parsingStep2: "Сверяю Cash Flow...",
    parsingStep3: "Оцениваю runway...",
    parsingStep4: "Формирую рекомендации...",
    confirmMetrics: "Подтвердить и применить",
    weakSpot: "Слабое место",
    revenue: "Выручка",
    margin: "Маржа",
    metricsConfirmed: "Метрики подтверждены и применены к дашборду",

    // Planning Mode Enhanced
    effortRequired: "Требуется",
    months: "мес.",
    budget: "Бюджет",
    crossImpact: "Влияние на",
    impactWarning: "Текущий уровень не выдержит роста",
    improveFirst: "Улучшите сначала",

    // Split Button / Export
    actionPlan: "Action Plan (Notion)",
    actionPlanDesc: "Сгенерировать план действий для Notion / задач",
    pitchDeckPDF: "Pitch Deck (PDF)",
    pitchDeckDesc: "Сформировать красивый отчет для инвесторов",
    saveProfileSupabase: "Сохранить профиль",
    saveProfileDesc: "Сохранить текущий профиль для отслеживания динамики",
    actionPlanGenerated: "Action Plan сгенерирован!",
    pitchDeckGenerated: "Pitch Deck сохранен как PDF!",
    profileSaved: "Профиль сохранен!",

    // GRI History
    griHistory: "История GRI",
    griHistoryDesc: "История изменения общего индекса за все сессии",
    noHistoryData: "Нет сохраненных сессий",
    sessionDate: "Дата",
    sessionGRI: "GRI",

    // Action Items
    viewDetails: "Подробнее",
  },
  en: {
    // Header
    logo: "AIStart360",
    language: "Language",

    // KPI
    currentGRI: "CURRENT GRI",
    targetGRI: "TARGET GRI",
    griSubtitle: "Average score across 7 categories",
    targetSubtitle: "Scaling target benchmark",

    // Alert
    insight: "Insight",
    redZoneAlert: "You can't scale chaos. Fix your 'Red Zones'",
    noRedZone: "Great job! Your business is ready for scaling. Keep up the momentum!",

    // Chart
    yourBusiness: "Your Business",
    benchmark: "Benchmark",

    // Misc
    score: "Score",
    of10: "out of 10",
    calculatorTitle: "GRI Calculator",
    calculatorSubtitle: "Assess your business readiness for scaling",
    growthReadinessIndex: "Growth Readiness Index",
    calculatorDesc: "Adjust scores for each category",
    categories: "7 categories",

    // Planning Mode
    planningMode: "Planning Mode",
    planningModeDesc: "Create planned scores for comparison",
    baseGRI: "BASE GRI",
    plannedGRI: "PLANNED GRI",
    baseState: "Base State",
    plannedState: "Planned State",

    // History
    saveSession: "Save Session",
    comparePrevious: "Compare with Previous",
    noHistory: "No saved data available",
    sessionSaved: "Session saved!",
    previousSession: "Previous Session",

    // Drill-down
    drillDownTitle: "Detailed Analysis",
    calculatedScore: "Calculated Score",
    applyScore: "Apply",
    subFactors: "Sub-factors",
    close: "Close",
    subFactorsOf: "Sub-factors",
    checkedOf: "checked",

    // AI Strategy
    generateStrategy: "Generate Growth Strategy",
    generatingStrategy: "Generating strategy...",
    strategyTitle: "AI Growth Strategy",
    strategyDesc: "Analysis based on your GRI scores",
    strategyClose: "Close Strategy",
    strategyError: "Strategy generation failed. Please try again.",

    // Niche Benchmarking
    nicheLabel: "Niche",
    nicheDesc: "Select industry for benchmarking",
    niche_general: "General",
    niche_it: "IT / Technology",
    niche_retail: "Retail / E-commerce",
    niche_services: "Services / Consulting",
    niche_fintech: "FinTech",
    niche_edtech: "EdTech",

    // Tooltips
    tooltipHint: "Hover for details",

    // Financial Analyst
    financialAnalyst: "Financial Analyst",
    financialAnalystDesc: "Upload a financial report or paste data for AI analysis",
    pasteFinancialData: "Paste your financial data (P&L, Cash Flow, balance sheet)...",
    analyzeFinances: "Analyze Finances",
    analyzingFinances: "Analyzing...",
    analysisError: "Analysis error. Check your data and try again.",
    analysisTitle: "AI Financial Analysis",
    analysisDesc: "Analysis results based on your financial data",
    applyToDashboard: "Apply to Dashboard",
    applied: "Scores updated based on financial analysis!",
    financialStability: "Cash Stability",
    businessModelScore: "Business Model",
    extractedMetrics: "Extracted Metrics",
    revenueTrend: "Revenue Trend",
    grossMargin: "Gross Margin",
    netProfitMargin: "Net Profit Margin",
    insights: "McKinsey Insights",
    scoreUpdate: "Score Update",
    justification: "Justification",
    noData: "No data",

    // Company Size
    companySize: "Company Size",
    size_micro: "Micro",
    size_small: "Small",
    size_medium: "Medium",
    size_large: "Large",

    // Dynamic Insights
    dynamicInsights: "Dynamic Insights",

    // Download & Publish
    download: "Download",
    publish: "Publish",
    downloadTooltip: "Download report (PDF) or export data (JSON)",
    publishTooltip: "Generate a shareable link with preview",
    downloadPDF: "PDF Report",
    downloadJSON: "JSON Export",
    publishTitle: "Publish Dashboard",
    publishDesc: "Generate a shareable link for your diagnostic results",
    publishLink: "Link copied!",
    generateLink: "Generate Link",
    sessionName: "Session Name",
    sessionNamePlaceholder: "Enter session name...",
    saveSessionTitle: "Save Session",
    saveButton: "Save",
    cancel: "Cancel",

    // File Upload — Smart Dropzone
    attachFile: "Attach File",
    attachFileTooltip: "Upload PDF or Excel",
    parsingFile: "Parsing file...",
    parseError: "File read error",
    extractedMetricsTitle: "AI Extracted Metrics",
    dropzoneTitle: "Upload Financial Report",
    dropzoneSubtitle: "Drag & drop PDF, Excel or CSV here",
    dropzoneOr: "or",
    dropzoneBrowse: "browse file",
    dropzoneOrPaste: "or paste data manually",
    parsingStep1: "Extracting P&L...",
    parsingStep2: "Cross-checking Cash Flow...",
    parsingStep3: "Evaluating runway...",
    parsingStep4: "Generating recommendations...",
    confirmMetrics: "Confirm & Apply",
    weakSpot: "Weak Spot",
    revenue: "Revenue",
    margin: "Margin",
    metricsConfirmed: "Metrics confirmed and applied to dashboard",

    // Planning Mode Enhanced
    effortRequired: "Required",
    months: "mo.",
    budget: "Budget",
    crossImpact: "Impact on",
    impactWarning: "Current level can't sustain growth",
    improveFirst: "Improve first",

    // Split Button / Export
    actionPlan: "Action Plan (Notion)",
    actionPlanDesc: "Generate action plan for Notion / task list",
    pitchDeckPDF: "Pitch Deck (PDF)",
    pitchDeckDesc: "Generate a beautiful report for investors",
    saveProfileSupabase: "Save Profile",
    saveProfileDesc: "Save current profile for tracking progress",
    actionPlanGenerated: "Action Plan generated!",
    pitchDeckGenerated: "Pitch Deck saved as PDF!",
    profileSaved: "Profile saved!",

    // GRI History
    griHistory: "GRI History",
    griHistoryDesc: "Overall index history across all sessions",
    noHistoryData: "No saved sessions",
    sessionDate: "Date",
    sessionGRI: "GRI",

    // Action Items
    viewDetails: "View Details",
  },
};
