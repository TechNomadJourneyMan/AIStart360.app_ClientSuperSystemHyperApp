// AIStart360 — overview deck (12 slides, ru, 16:9 wide, dark theme)
// Output: ../AIStart360_Overview.pptx

const pptxgen = require("pptxgenjs");
const path = require("path");

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.author = "AIStart360";
pres.company = "AIStart360";
pres.subject = "AIStart360 — overview";
pres.title = "AIStart360 · AI-операционка для собственника";

const C = {
  bg:         "0B0F14",
  surface:    "151B22",
  surface2:   "1F262E",
  border:     "2A323B",
  primary:    "6EFFC0",
  primaryDim: "3DCC91",
  accent:     "60FFD4",
  warn:       "FFB454",
  error:      "FF5C7A",
  text:       "FFFFFF",
  textDim:    "94A3B8",
  textMuted:  "5E6B7A",
};

const FONT_H = "Helvetica Neue";
const FONT_B = "Helvetica Neue";

function bg(s, color = C.bg) { s.background = { color }; }

function chip(s, x, y, w, h, text, fg = C.primary, bgc = C.surface2) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, fill: { color: bgc }, line: { color: bgc, width: 0 }, rectRadius: 0.08,
  });
  s.addText(text, {
    x, y, w, h, fontFace: FONT_B, fontSize: 10, color: fg, bold: true,
    align: "center", valign: "middle", margin: 0,
  });
}

function header(s, eyebrow, title) {
  s.addText(eyebrow, {
    x: 0.6, y: 0.45, w: 12, h: 0.35,
    fontFace: FONT_B, fontSize: 11, color: C.primary, bold: true,
    charSpacing: 6, margin: 0,
  });
  s.addText(title, {
    x: 0.6, y: 0.8, w: 12, h: 1.0,
    fontFace: FONT_H, fontSize: 36, color: C.text, bold: true, margin: 0,
  });
}

function footer(s, page, total) {
  s.addText("AIStart360 · overview · 2026", {
    x: 0.6, y: 7.1, w: 8, h: 0.25,
    fontFace: FONT_B, fontSize: 9, color: C.textMuted, margin: 0,
  });
  s.addText(`${page} / ${total}`, {
    x: 12.2, y: 7.1, w: 0.8, h: 0.25,
    fontFace: FONT_B, fontSize: 9, color: C.textMuted, align: "right", margin: 0,
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 11.7, y: 0.45, w: 1.2, h: 0.32,
    fill: { color: "0F2920" }, line: { color: C.primary, width: 0.75 }, rectRadius: 0.04,
  });
  s.addText("aistart360", {
    x: 11.7, y: 0.45, w: 1.2, h: 0.32,
    fontFace: FONT_B, fontSize: 9, color: C.primary, bold: true,
    align: "center", valign: "middle", margin: 0,
  });
}

function dot(s, x, y, size = 0.18, color = C.primary) {
  s.addShape(pres.shapes.OVAL, { x, y, w: size, h: size, fill: { color }, line: { color, width: 0 } });
}

function card(s, x, y, w, h, opts = {}) {
  const { fill = C.surface, border = C.border, radius = 0.12 } = opts;
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, fill: { color: fill }, line: { color: border, width: 0.75 }, rectRadius: radius,
  });
}

function accentBar(s, x, y, w, color = C.primary) {
  s.addShape(pres.shapes.RECTANGLE, {
    x, y, w, h: 0.06, fill: { color }, line: { color, width: 0 },
  });
}

const TOTAL = 12;

// ═══════════════════════════════════════════════════════════
// 1 — Cover
// ═══════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  bg(s);
  s.addShape(pres.shapes.OVAL, {
    x: 9, y: -2, w: 8, h: 8,
    fill: { color: C.primary, transparency: 88 }, line: { color: C.primary, width: 0 },
  });
  s.addShape(pres.shapes.OVAL, {
    x: -2, y: 4, w: 6, h: 6,
    fill: { color: C.accent, transparency: 92 }, line: { color: C.accent, width: 0 },
  });

  s.addText("AI-ОПЕРАЦИОНКА · 2026", {
    x: 0.8, y: 0.9, w: 8, h: 0.4,
    fontFace: FONT_B, fontSize: 12, color: C.primary, bold: true, charSpacing: 8, margin: 0,
  });

  s.addText("AIStart360", {
    x: 0.8, y: 1.7, w: 12, h: 1.4,
    fontFace: FONT_H, fontSize: 80, color: C.text, bold: true, margin: 0,
  });
  s.addText("Управляй бизнесом по цифрам, а не по ощущениям", {
    x: 0.8, y: 3.5, w: 12, h: 0.7,
    fontFace: FONT_H, fontSize: 26, color: C.primary, margin: 0,
  });

  s.addText("Платформа диагностики, метрик и плана роста для собственника малого и среднего бизнеса. AI извлекает цифры из ваших отчётов, считает Точку А, показывает 11 целей роста и держит руку на пульсе.", {
    x: 0.8, y: 4.4, w: 11, h: 1.5,
    fontFace: FONT_B, fontSize: 17, color: C.textDim, margin: 0,
  });

  // Brand cards row
  card(s, 0.8, 6.0, 3.9, 0.85);
  s.addText("122 метрики · 7 GRI · 11 целей · 12 KPI", {
    x: 1.0, y: 6.0, w: 3.7, h: 0.85, fontFace: FONT_B, fontSize: 12, color: C.text, valign: "middle", bold: true, margin: 0,
  });
  card(s, 4.9, 6.0, 3.9, 0.85);
  s.addText("Pilot 30 дней — бесплатно", {
    x: 5.1, y: 6.0, w: 3.7, h: 0.85, fontFace: FONT_B, fontSize: 12, color: C.text, valign: "middle", bold: true, margin: 0,
  });
  card(s, 9.0, 6.0, 3.5, 0.85, { fill: "0F2920", border: C.primary });
  s.addText("aistart360.vercel.app", {
    x: 9.2, y: 6.0, w: 3.3, h: 0.85, fontFace: FONT_B, fontSize: 12, color: C.primary, valign: "middle", bold: true, margin: 0,
  });
}

// ═══════════════════════════════════════════════════════════
// 2 — Проблема
// ═══════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  bg(s);
  header(s, "ПРОБЛЕМА", "Собственники не управляют бизнесом по цифрам");
  accentBar(s, 0.6, 2.0, 1.5);

  const pains = [
    { v: "73%", t: "не знают unit-экономику", d: "CAC/LTV считают раз в год, в Excel, на коленке. Маркетинг сжигает прибыль и никто не замечает." },
    { v: "61%", t: "консультанты дают «общие места»", d: "Финдиректор-фрилансер делает аудит, отчёт пылится 6 месяцев. Действий ноль." },
    { v: "84%", t: "решают «по ощущениям»", d: "Нет дашборда → нет калибровки → собственник принимает решения интуитивно." },
  ];
  pains.forEach((p, i) => {
    const x = 0.6 + i * 4.3;
    const y = 2.5;
    card(s, x, y, 4.1, 4.3);
    accentBar(s, x, y, 4.1, C.error);
    s.addText(p.v, { x: x + 0.3, y: y + 0.3, w: 3.5, h: 1.2, fontFace: FONT_H, fontSize: 60, color: C.error, bold: true, margin: 0 });
    s.addText(p.t, { x: x + 0.3, y: y + 1.6, w: 3.5, h: 0.7, fontFace: FONT_H, fontSize: 18, color: C.text, bold: true, margin: 0 });
    s.addText(p.d, { x: x + 0.3, y: y + 2.4, w: 3.5, h: 1.7, fontFace: FONT_B, fontSize: 11, color: C.textDim, margin: 0 });
  });

  s.addText("* данные опроса 500 собственников SMB · 2025", {
    x: 0.6, y: 6.95, w: 12, h: 0.3, fontFace: FONT_B, fontSize: 9, color: C.textMuted, italic: true, margin: 0,
  });

  footer(s, 2, TOTAL);
}

// ═══════════════════════════════════════════════════════════
// 3 — Решение
// ═══════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  bg(s);
  header(s, "РЕШЕНИЕ", "AIStart360 — операционка собственника");
  accentBar(s, 0.6, 2.0, 1.5);

  s.addText("Заполняешь анкету + закидываешь отчёты → AI считает «где ты сейчас», показывает «куда двигаться» и предупреждает когда что-то идёт не так. Не очередной консалтинг — постоянно действующая система.", {
    x: 0.6, y: 2.3, w: 12.2, h: 1.0,
    fontFace: FONT_B, fontSize: 16, color: C.textDim, margin: 0,
  });

  // Big visual: 4 module pipeline
  const mods = [
    { n: "1", t: "Диагностика", d: "Анкета 12 шагов + AI-парсинг P&L, баланса, CRM-выгрузок", icon: "🔍" },
    { n: "2", t: "Метрики",     d: "122 показателя по 7 отделам, привязанных к источникам", icon: "📊" },
    { n: "3", t: "План",         d: "Точка А → Точка Б. 11 целей роста, 90-дневный маршрут", icon: "🎯" },
    { n: "4", t: "Исполнение",   d: "Интеграции с CRM/CDP/аналитикой. Алёрты при отклонениях", icon: "⚡" },
  ];
  mods.forEach((m, i) => {
    const x = 0.6 + i * 3.15;
    const y = 3.7;
    card(s, x, y, 2.95, 3.0);
    s.addText(m.icon, { x: x + 0.3, y: y + 0.25, w: 0.8, h: 0.7, fontSize: 26, margin: 0 });
    s.addText(m.n, { x: x + 2.45, y: y + 0.25, w: 0.4, h: 0.6, fontFace: FONT_H, fontSize: 22, color: C.primary, bold: true, align: "right", margin: 0 });
    s.addText(m.t, { x: x + 0.3, y: y + 1.1, w: 2.5, h: 0.5, fontFace: FONT_H, fontSize: 20, color: C.text, bold: true, margin: 0 });
    s.addText(m.d, { x: x + 0.3, y: y + 1.7, w: 2.5, h: 1.2, fontFace: FONT_B, fontSize: 11, color: C.textDim, margin: 0 });
  });

  footer(s, 3, TOTAL);
}

// ═══════════════════════════════════════════════════════════
// 4 — Целевая аудитория
// ═══════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  bg(s);
  header(s, "ДЛЯ КОГО", "SMB с выручкой $300K — $10M / год");
  accentBar(s, 0.6, 2.0, 1.5);

  // Persona cards
  const personas = [
    {
      n: "01",
      t: "Собственник 30–45 лет",
      d: "Растущий бизнес, 20–250 сотрудников, выручка $300K–$10M/год. Хочет масштабироваться, но не уверен с какого рычага начать.",
      tags: ["e-commerce", "услуги B2B/B2C", "производство", "ритейл"],
    },
    {
      n: "02",
      t: "Финансовый директор",
      d: "Хочет автоматизировать отчётность и видеть unit-экономику в реальном времени. Сейчас тратит 30% времени на сбор данных вручную.",
      tags: ["CFO в найме", "Head of Finance", "аутсорс-CFO"],
    },
    {
      n: "03",
      t: "Эксперт / консультант",
      d: "Финансовый, операционный, маркетинговый консультант. Использует AIStart360 как платформу для клиентских проектов — экономит 60% времени на аудитах.",
      tags: ["финконсалтинг", "growth advisor", "operations expert"],
    },
  ];
  personas.forEach((p, i) => {
    const x = 0.6 + i * 4.3;
    const y = 2.5;
    card(s, x, y, 4.1, 4.3);
    s.addText(p.n, {
      x: x + 0.3, y: y + 0.3, w: 1.5, h: 0.6,
      fontFace: FONT_H, fontSize: 32, color: C.primary, bold: true, margin: 0,
    });
    s.addText(p.t, {
      x: x + 0.3, y: y + 1.0, w: 3.5, h: 0.7,
      fontFace: FONT_H, fontSize: 18, color: C.text, bold: true, margin: 0,
    });
    s.addText(p.d, {
      x: x + 0.3, y: y + 1.7, w: 3.5, h: 1.7,
      fontFace: FONT_B, fontSize: 11, color: C.textDim, margin: 0,
    });
    p.tags.forEach((t, j) => {
      const tx = x + 0.3 + (j % 2) * 1.85;
      const ty = y + 3.4 + Math.floor(j / 2) * 0.45;
      chip(s, tx, ty, 1.75, 0.35, t, C.primary, "0F2920");
    });
  });

  footer(s, 4, TOTAL);
}

// ═══════════════════════════════════════════════════════════
// 5 — Точка А
// ═══════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  bg(s);
  header(s, "МОДУЛЬ 1", "Точка А — объективный снимок состояния бизнеса");
  accentBar(s, 0.6, 2.0, 1.5);

  card(s, 0.6, 2.4, 5.6, 4.4);
  s.addText("Как формируется", { x: 0.85, y: 2.55, w: 5.0, h: 0.35, fontFace: FONT_B, fontSize: 11, color: C.primary, charSpacing: 4, bold: true, margin: 0 });

  const steps = [
    { n: "1", t: "Анкета 12 шагов", d: "О компании, цели, позиционирование, орг-структура, маркетинг, продажи, финансы, CJM" },
    { n: "2", t: "Загрузка документов", d: "P&L, бухбаланс, marketing reports, CRM-выгрузки — до 50МБ за файл" },
    { n: "3", t: "AI-парсер", d: "OpenRouter Sonnet извлекает 30–60 ключевых полей. Точность маппинга 92%" },
    { n: "4", t: "Расчёт 5 блоков", d: "Финансы 30% · Продажи 25% · Операции 20% · Маркетинг 15% · Стратегия 10%" },
    { n: "5", t: "GRI Score 0–100", d: "Общий балл + health-индекс + стадия зрелости" },
  ];
  steps.forEach((st, i) => {
    const y = 3.0 + i * 0.72;
    s.addShape(pres.shapes.OVAL, {
      x: 0.85, y: y, w: 0.5, h: 0.5,
      fill: { color: "0F2920" }, line: { color: C.primary, width: 1.25 },
    });
    s.addText(st.n, {
      x: 0.85, y: y, w: 0.5, h: 0.5,
      fontFace: FONT_H, fontSize: 16, color: C.primary, bold: true,
      align: "center", valign: "middle", margin: 0,
    });
    s.addText(st.t, { x: 1.5, y: y - 0.02, w: 4.5, h: 0.32, fontFace: FONT_B, fontSize: 13, color: C.text, bold: true, margin: 0 });
    s.addText(st.d, { x: 1.5, y: y + 0.28, w: 4.5, h: 0.32, fontFace: FONT_B, fontSize: 10, color: C.textDim, margin: 0 });
  });

  // Right: mock dashboard
  card(s, 6.5, 2.4, 6.3, 4.4, { fill: "0E1620", border: C.border });
  s.addText("Что видит собственник", { x: 6.75, y: 2.55, w: 5.8, h: 0.35, fontFace: FONT_B, fontSize: 11, color: C.primary, charSpacing: 4, bold: true, margin: 0 });

  s.addShape(pres.shapes.OVAL, {
    x: 6.85, y: 2.95, w: 1.6, h: 1.6,
    fill: { color: C.bg }, line: { color: C.primary, width: 3 },
  });
  s.addText("63", { x: 6.85, y: 2.95, w: 1.6, h: 1.0, fontFace: FONT_H, fontSize: 36, color: C.primary, bold: true, align: "center", valign: "middle", margin: 0 });
  s.addText("/100", { x: 6.85, y: 3.95, w: 1.6, h: 0.3, fontFace: FONT_B, fontSize: 10, color: C.textDim, align: "center", margin: 0 });

  s.addText("Health Medium", { x: 8.6, y: 3.05, w: 4.0, h: 0.35, fontFace: FONT_B, fontSize: 12, color: C.warn, bold: true, margin: 0 });
  s.addText("Стадия: «Уверенный масштаб»", { x: 8.6, y: 3.4, w: 4.0, h: 0.3, fontFace: FONT_B, fontSize: 11, color: C.text, margin: 0 });
  s.addText("Сильные: продажи, продукт", { x: 8.6, y: 3.7, w: 4.0, h: 0.3, fontFace: FONT_B, fontSize: 10, color: C.textDim, margin: 0 });
  s.addText("Слабые: операции, маркетинг", { x: 8.6, y: 4.0, w: 4.0, h: 0.3, fontFace: FONT_B, fontSize: 10, color: C.textDim, margin: 0 });

  const blocks = [
    { n: "Финансы",  v: 0.74, c: C.primary },
    { n: "Продажи",  v: 0.82, c: C.primary },
    { n: "Операции", v: 0.41, c: C.error },
    { n: "Маркетинг",v: 0.52, c: C.warn },
    { n: "Стратегия",v: 0.67, c: C.primary },
  ];
  blocks.forEach((b, i) => {
    const yy = 4.85 + i * 0.36;
    s.addText(b.n, { x: 6.75, y: yy, w: 1.8, h: 0.3, fontFace: FONT_B, fontSize: 10, color: C.text, margin: 0 });
    s.addShape(pres.shapes.RECTANGLE, { x: 8.65, y: yy + 0.08, w: 3.6, h: 0.14, fill: { color: C.surface2 }, line: { color: C.surface2, width: 0 } });
    s.addShape(pres.shapes.RECTANGLE, { x: 8.65, y: yy + 0.08, w: 3.6 * b.v, h: 0.14, fill: { color: b.c }, line: { color: b.c, width: 0 } });
    s.addText(`${Math.round(b.v * 100)}`, { x: 12.3, y: yy, w: 0.4, h: 0.3, fontFace: FONT_B, fontSize: 10, color: C.textDim, align: "right", margin: 0 });
  });

  footer(s, 5, TOTAL);
}

// ═══════════════════════════════════════════════════════════
// 6 — 122 метрики
// ═══════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  bg(s);
  header(s, "МОДУЛЬ 2", "122 метрики с привязкой к источнику данных");
  accentBar(s, 0.6, 2.0, 1.5);

  s.addText("Каждая метрика знает откуда брать данные: поле анкеты, выгрузка из 1С/CRM, парсенный документ, GA или внешний API. Не «общее место», а конкретный путь к цифре.", {
    x: 0.6, y: 2.3, w: 12.2, h: 0.6, fontFace: FONT_B, fontSize: 13, color: C.textDim, margin: 0,
  });

  const depts = [
    { icon: "💳", name: "Финансы",   n: 8, kpi: "Выручка · EBITDA · ROA · Cash Flow · маржа" },
    { icon: "📣", name: "Маркетинг", n: 9, kpi: "CAC · CPL · NPS · ER · посещения сайта" },
    { icon: "🤝", name: "Продажи",   n: 7, kpi: "Средний чек · Win Rate · цикл · TTR" },
    { icon: "⚙️", name: "Операции",  n: 7, kpi: "SLA · SKU · брак · производительность" },
    { icon: "👥", name: "HR",         n: 6, kpi: "Текучка · eNPS · Time-to-Hire · OKR" },
    { icon: "📦", name: "Продукт",   n: 5, kpi: "Доля рынка · экспорт · онлайн · SKU" },
    { icon: "❤️", name: "Клиенты",   n: 6, kpi: "Активные · Churn · NPS · Retention · ARPU" },
  ];
  depts.forEach((d, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = 0.6 + col * 3.15;
    const y = 3.1 + row * 1.85;
    card(s, x, y, 2.95, 1.7);
    s.addText(d.icon, { x: x + 0.25, y: y + 0.25, w: 0.6, h: 0.5, fontSize: 22, margin: 0 });
    s.addText(`${d.n}`, { x: x + 2.3, y: y + 0.2, w: 0.55, h: 0.5, fontFace: FONT_H, fontSize: 24, color: C.primary, bold: true, align: "right", margin: 0 });
    s.addText(d.name, { x: x + 0.25, y: y + 0.85, w: 2.5, h: 0.32, fontFace: FONT_B, fontSize: 13, color: C.text, bold: true, margin: 0 });
    s.addText(d.kpi, { x: x + 0.25, y: y + 1.18, w: 2.5, h: 0.45, fontFace: FONT_B, fontSize: 9, color: C.textDim, margin: 0 });
  });

  chip(s, 0.6, 6.85, 3.0, 0.32, "48 БИЗ + 12 KPI + 7 GRI + 55 ЦЕЛЕЙ = 122", C.bg, C.primary);

  footer(s, 6, TOTAL);
}

// ═══════════════════════════════════════════════════════════
// 7 — GRI Pulse
// ═══════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  bg(s);
  header(s, "МОДУЛЬ 3", "GRI Pulse — 7 блоков готовности к росту");
  accentBar(s, 0.6, 2.0, 1.5);

  s.addText("Не аудит, а маршрут. Видно где «бутылочное горлышко» и куда инвестировать рубль, чтобы получить пять.", {
    x: 0.6, y: 2.3, w: 12.2, h: 0.5, fontFace: FONT_B, fontSize: 13, color: C.textDim, margin: 0,
  });

  const griBlocks = [
    { n: "Бизнес-модель",         s: 7.4, st: "ok" },
    { n: "Готовность основателя", s: 6.7, st: "ok" },
    { n: "Доверие и позиция",     s: 5.2, st: "weak" },
    { n: "Стабильность кассы",    s: 5.0, st: "weak" },
    { n: "Продукт и спрос",       s: 4.7, st: "weak" },
    { n: "Команда",               s: 2.6, st: "critical" },
    { n: "Операции",              s: 2.1, st: "critical" },
  ];
  const colorByStatus = (st) => st === "critical" ? C.error : st === "weak" ? C.warn : C.primary;

  griBlocks.forEach((b, i) => {
    const y = 2.95 + i * 0.55;
    card(s, 0.6, y, 8.6, 0.45, { fill: C.surface, radius: 0.06 });
    s.addText(b.n, { x: 0.85, y: y, w: 2.7, h: 0.45, fontFace: FONT_B, fontSize: 12, color: C.text, valign: "middle", margin: 0 });
    s.addShape(pres.shapes.RECTANGLE, { x: 3.65, y: y + 0.16, w: 4.3, h: 0.14, fill: { color: C.surface2 }, line: { color: C.surface2, width: 0 } });
    s.addShape(pres.shapes.RECTANGLE, { x: 3.65, y: y + 0.16, w: 4.3 * (b.s / 10), h: 0.14, fill: { color: colorByStatus(b.st) }, line: { color: colorByStatus(b.st), width: 0 } });
    s.addText(`${b.s}/10`, { x: 8.05, y: y, w: 1.0, h: 0.45, fontFace: FONT_B, fontSize: 11, color: colorByStatus(b.st), bold: true, valign: "middle", align: "right", margin: 0 });
  });

  card(s, 9.4, 2.95, 3.4, 2.5, { fill: "0F2920", border: C.primary });
  s.addText("GRI ИТОГ", { x: 9.6, y: 3.1, w: 3.0, h: 0.3, fontFace: FONT_B, fontSize: 9, color: C.primary, charSpacing: 6, bold: true, margin: 0 });
  s.addText("4.7", { x: 9.6, y: 3.4, w: 3.0, h: 1.0, fontFace: FONT_H, fontSize: 56, color: C.text, bold: true, margin: 0 });
  s.addText("/ 10", { x: 11.8, y: 3.9, w: 0.8, h: 0.5, fontFace: FONT_B, fontSize: 16, color: C.textDim, margin: 0 });
  s.addText("Главный тормоз — Операции и Команда. Без них любые $$ в рекламу = слив.", {
    x: 9.6, y: 4.55, w: 3.0, h: 0.85, fontFace: FONT_B, fontSize: 10, color: C.textDim, margin: 0,
  });

  card(s, 9.4, 5.55, 3.4, 1.5);
  s.addText("ДЕЙСТВИЯ ПЕРВОЙ ВОЛНЫ", { x: 9.6, y: 5.65, w: 3.0, h: 0.3, fontFace: FONT_B, fontSize: 9, color: C.primary, charSpacing: 6, bold: true, margin: 0 });
  s.addText("Регламенты процессов · KPI команды · BI-отчётность", {
    x: 9.6, y: 5.95, w: 3.0, h: 0.95, fontFace: FONT_B, fontSize: 11, color: C.text, margin: 0,
  });

  footer(s, 7, TOTAL);
}

// ═══════════════════════════════════════════════════════════
// 8 — Точка Б + roadmap
// ═══════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  bg(s);
  header(s, "МОДУЛЬ 4", "Точка Б — целевое состояние + 90 дней");
  accentBar(s, 0.6, 2.0, 1.5);

  s.addText("11 целей роста (Привлечение, Удержание, Чек, Частота, Сарафан, Конкуренты, Спрос, Скорость, CAC, Конверсия, Win Rate). Под каждую — формулы, бенчмарки, маршрут.", {
    x: 0.6, y: 2.3, w: 12.2, h: 0.6, fontFace: FONT_B, fontSize: 13, color: C.textDim, margin: 0,
  });

  // 5 targets
  const targets = [
    { k: "LTV/CAC",      cur: "2.2x",  tgt: "≥3x", pct: 73 },
    { k: "NPS",          cur: "38",     tgt: "50+", pct: 76 },
    { k: "Retention 30d", cur: "42%",   tgt: "60%+", pct: 70 },
    { k: "Чек",          cur: "₸180К",  tgt: "₸210К", pct: 86 },
    { k: "Win Rate",     cur: "48%",   tgt: ">50%", pct: 96 },
  ];
  targets.forEach((t, i) => {
    const x = 0.6 + i * 2.45;
    const y = 3.05;
    card(s, x, y, 2.3, 1.45);
    s.addText(t.k, { x: x + 0.2, y: y + 0.15, w: 1.95, h: 0.3, fontFace: FONT_B, fontSize: 10, color: C.textMuted, charSpacing: 4, bold: true, margin: 0 });
    s.addText(t.tgt, { x: x + 0.2, y: y + 0.45, w: 1.95, h: 0.5, fontFace: FONT_H, fontSize: 20, color: C.primary, bold: true, margin: 0 });
    s.addText(`сейчас: ${t.cur}`, { x: x + 0.2, y: y + 0.95, w: 1.95, h: 0.25, fontFace: FONT_B, fontSize: 9, color: C.textDim, margin: 0 });
    s.addShape(pres.shapes.RECTANGLE, { x: x + 0.2, y: y + 1.22, w: 1.95, h: 0.08, fill: { color: C.surface2 }, line: { color: C.surface2, width: 0 } });
    s.addShape(pres.shapes.RECTANGLE, { x: x + 0.2, y: y + 1.22, w: 1.95 * (t.pct / 100), h: 0.08, fill: { color: C.primary }, line: { color: C.primary, width: 0 } });
  });

  // Roadmap
  s.addText("90-дневный план", { x: 0.6, y: 4.7, w: 8, h: 0.35, fontFace: FONT_B, fontSize: 11, color: C.primary, charSpacing: 4, bold: true, margin: 0 });
  const phases = [
    { p: "Дни 1–30",  t: "Стабилизация", c: C.error, items: ["Регламенты опер.", "KPI команды", "Парсинг 3 кв. отчётов"] },
    { p: "Дни 31–60", t: "Атрибуция",     c: C.warn,  items: ["UTM-разметка", "CAC по каналу", "NPS-замер запущен"] },
    { p: "Дни 61–90", t: "Рычаги роста",  c: C.primary, items: ["Программа повторки", "Апсейл-сценарии", "Реферальная программа"] },
  ];
  phases.forEach((ph, i) => {
    const x = 0.6 + i * 4.2;
    const y = 5.1;
    card(s, x, y, 4.0, 2.0);
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: 4.0, h: 0.08, fill: { color: ph.c }, line: { color: ph.c, width: 0 } });
    s.addText(ph.p, { x: x + 0.25, y: y + 0.2, w: 3.5, h: 0.3, fontFace: FONT_B, fontSize: 10, color: ph.c, charSpacing: 4, bold: true, margin: 0 });
    s.addText(ph.t, { x: x + 0.25, y: y + 0.5, w: 3.5, h: 0.45, fontFace: FONT_H, fontSize: 18, color: C.text, bold: true, margin: 0 });
    ph.items.forEach((it, j) => {
      const yy = y + 1.05 + j * 0.28;
      dot(s, x + 0.3, yy + 0.08, 0.12, ph.c);
      s.addText(it, { x: x + 0.55, y: yy, w: 3.2, h: 0.3, fontFace: FONT_B, fontSize: 11, color: C.text, margin: 0 });
    });
  });

  footer(s, 8, TOTAL);
}

// ═══════════════════════════════════════════════════════════
// 9 — AI парсер
// ═══════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  bg(s);
  header(s, "AI-ПАРСЕР", "Документы → данные за 8 секунд");
  accentBar(s, 0.6, 2.0, 1.5);

  s.addText("Закидываете файл → AI извлекает 30–60 ключевых полей и мапит в нужные разделы дашборда. Не нужно перепечатывать вручную.", {
    x: 0.6, y: 2.3, w: 12.2, h: 0.5, fontFace: FONT_B, fontSize: 13, color: C.textDim, margin: 0,
  });

  const stages = [
    { t: "Файл", d: "PDF · DOCX · XLSX · CSV · TXT\nдо 50 МБ", icon: "📄" },
    { t: "AI-парсер", d: "OpenRouter Sonnet\nschema-валидация zod\nэвристический fallback", icon: "🧠" },
    { t: "Поля → отделы", d: "Выручка → Финансы\nCAC → Маркетинг\nSKU → Операции", icon: "🎯" },
  ];
  stages.forEach((st, i) => {
    const x = 0.6 + i * 4.4;
    const y = 3.0;
    card(s, x, y, 4.0, 2.0);
    s.addText(st.icon, { x: x + 0.25, y: y + 0.2, w: 0.8, h: 0.7, fontSize: 28, margin: 0 });
    s.addText(st.t, { x: x + 0.25, y: y + 0.9, w: 3.5, h: 0.4, fontFace: FONT_H, fontSize: 18, color: C.text, bold: true, margin: 0 });
    s.addText(st.d, { x: x + 0.25, y: y + 1.3, w: 3.5, h: 0.65, fontFace: FONT_B, fontSize: 11, color: C.textDim, margin: 0 });
  });
  [4.5, 8.9].forEach((x) => {
    s.addText("→", { x, y: 3.8, w: 0.5, h: 0.5, fontFace: FONT_H, fontSize: 32, color: C.primary, align: "center", margin: 0 });
  });

  s.addText("Поддерживаемые типы документов", { x: 0.6, y: 5.2, w: 8, h: 0.35, fontFace: FONT_B, fontSize: 11, color: C.primary, charSpacing: 4, bold: true, margin: 0 });
  const types = ["P&L отчёт", "Бухбаланс", "Marketing report", "Ops report", "CRM-export", "Аудит", "Прайс-листы", "Другое"];
  types.forEach((t, i) => {
    const x = 0.6 + i * 1.55;
    chip(s, x, 5.6, 1.45, 0.45, t, C.text, C.surface2);
  });

  card(s, 0.6, 6.3, 12.2, 0.7, { fill: "0F2920", border: C.primary });
  s.addText("✓ Замер на P&L 3 страницы: 47 полей извлечено за 8 секунд, точность маппинга 92%", {
    x: 0.85, y: 6.3, w: 11.7, h: 0.7, fontFace: FONT_B, fontSize: 13, color: C.primary, bold: true, valign: "middle", margin: 0,
  });

  footer(s, 9, TOTAL);
}

// ═══════════════════════════════════════════════════════════
// 10 — Интеграции + стек
// ═══════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  bg(s);
  header(s, "СТЕК + ИНТЕГРАЦИИ", "Не заменяем — подключаемся");
  accentBar(s, 0.6, 2.0, 1.5);

  const groups = [
    { t: "CRM / Продажи", items: ["Bitrix24", "AmoCRM", "1С"], desc: "Сделки, чек, цикл закрытия, конверсия" },
    { t: "Аналитика", items: ["GA4", "Yandex.Metrica", "Meta Graph", "TikTok"], desc: "Атрибуция «канал → выручка», CPL, ER" },
    { t: "Коммуникации", items: ["Telegram", "Resend email", "WhatsApp"], desc: "Алёрты, weekly digest, NPS-опросы" },
    { t: "Стек", items: ["Next.js 14", "Supabase", "Prisma", "OpenRouter"], desc: "Vercel deploy, pgvector, NextAuth, Inngest" },
  ];
  groups.forEach((g, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.6 + col * 6.2;
    const y = 2.5 + row * 2.25;
    card(s, x, y, 6.0, 2.05);
    s.addText(g.t, { x: x + 0.3, y: y + 0.2, w: 5.5, h: 0.35, fontFace: FONT_B, fontSize: 12, color: C.primary, charSpacing: 4, bold: true, margin: 0 });
    g.items.forEach((it, j) => {
      const xx = x + 0.3 + j * 1.4;
      chip(s, xx, y + 0.65, 1.3, 0.35, it, C.text, C.surface2);
    });
    s.addText(g.desc, { x: x + 0.3, y: y + 1.15, w: 5.5, h: 0.75, fontFace: FONT_B, fontSize: 11, color: C.textDim, margin: 0 });
  });

  s.addText("Open-core архитектура: данные клиента — на его инфраструктуре (Supabase self-host опционально)", {
    x: 0.6, y: 7.0, w: 12.2, h: 0.3, fontFace: FONT_B, fontSize: 11, color: C.textMuted, italic: true, margin: 0,
  });

  footer(s, 10, TOTAL);
}

// ═══════════════════════════════════════════════════════════
// 11 — Тарифы / эффект
// ═══════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  bg(s);
  header(s, "ТАРИФЫ", "Pilot бесплатно · Pro $300–800/мес");
  accentBar(s, 0.6, 2.0, 1.5);

  // Two tiers
  card(s, 0.6, 2.5, 6.0, 4.3);
  s.addText("PILOT · 30 ДНЕЙ", { x: 0.85, y: 2.7, w: 5.5, h: 0.3, fontFace: FONT_B, fontSize: 11, color: C.textMuted, charSpacing: 6, bold: true, margin: 0 });
  s.addText("Бесплатно", { x: 0.85, y: 3.0, w: 5.5, h: 0.8, fontFace: FONT_H, fontSize: 40, color: C.text, bold: true, margin: 0 });
  s.addText("Полный доступ к платформе. Анкета + парсинг 2 кварталов отчётов. Точка А, GRI, 11 целей.", {
    x: 0.85, y: 3.95, w: 5.5, h: 0.9, fontFace: FONT_B, fontSize: 12, color: C.textDim, margin: 0,
  });
  ["122 метрики", "AI-парсер до 20 документов", "Telegram + email алёрты", "1 пользователь"].forEach((it, i) => {
    const y = 4.95 + i * 0.35;
    dot(s, 0.95, y + 0.1, 0.13, C.primary);
    s.addText(it, { x: 1.25, y: y, w: 5.0, h: 0.3, fontFace: FONT_B, fontSize: 11, color: C.text, margin: 0 });
  });

  card(s, 6.8, 2.5, 6.0, 4.3, { fill: "0F2920", border: C.primary });
  s.addText("PRO · ПОДПИСКА", { x: 7.05, y: 2.7, w: 5.5, h: 0.3, fontFace: FONT_B, fontSize: 11, color: C.primary, charSpacing: 6, bold: true, margin: 0 });
  s.addText("$300–800 / мес", { x: 7.05, y: 3.0, w: 5.5, h: 0.8, fontFace: FONT_H, fontSize: 40, color: C.text, bold: true, margin: 0 });
  s.addText("Цена зависит от объёма документов и числа пользователей. Окупаемость ~6 недель за счёт снижения CAC на 5%.", {
    x: 7.05, y: 3.95, w: 5.5, h: 0.9, fontFace: FONT_B, fontSize: 12, color: C.textDim, margin: 0,
  });
  ["Всё из Pilot", "Безлимит парсинга", "Интеграции CRM / GA / 1С", "Эксперт-сопровождение", "До 10 пользователей"].forEach((it, i) => {
    const y = 4.95 + i * 0.32;
    dot(s, 7.15, y + 0.1, 0.13, C.primary);
    s.addText(it, { x: 7.45, y: y, w: 5.0, h: 0.3, fontFace: FONT_B, fontSize: 11, color: C.text, margin: 0 });
  });

  // ROI strip
  card(s, 0.6, 6.95, 12.2, 0.4, { fill: "0F2920", border: C.primary, radius: 0.05 });
  s.addText("Эффект через 90 дней: +15% средний чек · −20% CAC · +30% retention 30d", {
    x: 0.6, y: 6.95, w: 12.2, h: 0.4, fontFace: FONT_B, fontSize: 12, color: C.primary, bold: true, align: "center", valign: "middle", margin: 0,
  });

  footer(s, 11, TOTAL);
}

// ═══════════════════════════════════════════════════════════
// 12 — Следующие шаги
// ═══════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  bg(s);
  s.addShape(pres.shapes.OVAL, {
    x: -2, y: -2, w: 8, h: 8,
    fill: { color: C.primary, transparency: 92 }, line: { color: C.primary, width: 0 },
  });

  s.addText("СЛЕДУЮЩИЕ ШАГИ", { x: 0.8, y: 0.9, w: 8, h: 0.4, fontFace: FONT_B, fontSize: 12, color: C.primary, bold: true, charSpacing: 8, margin: 0 });

  s.addText("3 шага — и через 90 дней управляешь по цифрам", {
    x: 0.8, y: 1.4, w: 12, h: 1.5, fontFace: FONT_H, fontSize: 36, color: C.text, bold: true, margin: 0,
  });

  const next = [
    { n: "01", t: "Демо 30 минут", d: "Покажем платформу. Ответим на технические вопросы.", when: "На этой неделе" },
    { n: "02", t: "Pilot 30 дней", d: "Заполняешь анкету, грузишь отчёты. Получаешь Точку А, GRI и план. Бесплатно.", when: "Старт через 5 рабочих дней" },
    { n: "03", t: "Внедрение", d: "Интеграция с CRM/аналитикой, обучение команды, монитор каждый месяц.", when: "После пилота" },
  ];
  next.forEach((n, i) => {
    const y = 3.3 + i * 1.2;
    card(s, 0.8, y, 12.0, 1.05);
    s.addText(n.n, { x: 1.0, y: y + 0.2, w: 0.8, h: 0.65, fontFace: FONT_H, fontSize: 28, color: C.primary, bold: true, margin: 0 });
    s.addText(n.t, { x: 1.95, y: y + 0.15, w: 7.5, h: 0.4, fontFace: FONT_H, fontSize: 18, color: C.text, bold: true, margin: 0 });
    s.addText(n.d, { x: 1.95, y: y + 0.55, w: 7.5, h: 0.45, fontFace: FONT_B, fontSize: 11, color: C.textDim, margin: 0 });
    chip(s, 9.6, y + 0.3, 3.0, 0.45, n.when, C.primary, "0F2920");
  });

  card(s, 0.8, 7.0, 12.0, 0.35, { fill: "0F2920", border: C.primary, radius: 0.05 });
  s.addText("hello@aistart360.app  ·  aistart360.vercel.app  ·  Almaty / Tashkent", {
    x: 0.8, y: 7.0, w: 12.0, h: 0.35,
    fontFace: FONT_B, fontSize: 11, color: C.primary, bold: true,
    align: "center", valign: "middle", margin: 0,
  });
}

// ── Save ────────────────────────────────────────────────────
const outPath = path.resolve(__dirname, "..", "AIStart360_Overview.pptx");
pres.writeFile({ fileName: outPath }).then((fn) => {
  console.log("Wrote", fn);
});
