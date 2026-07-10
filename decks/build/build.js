// AIStart360 × Radius.uz pitch deck builder
// Output: ../Radius_AIStart360_Pitch.pptx (12 slides, 16:9, dark theme)

const pptxgen = require("pptxgenjs");
const path = require("path");

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.3" × 7.5"
pres.author = "AIStart360";
pres.company = "AIStart360";
pres.subject = "Pitch — операционка для Radius.uz";
pres.title = "AIStart360 × Radius.uz";

// ── Palette ────────────────────────────────────────────────
const C = {
  bg:         "0B0F14", // deep almost-black
  surface:    "151B22",
  surface2:   "1F262E",
  border:     "2A323B",
  primary:    "5CFFB5", // AIStart green
  primaryDim: "3DCC91",
  accent:     "60FFD4", // teal accent
  warn:       "FFB454",
  error:      "FF5C7A",
  text:       "FFFFFF",
  textDim:    "94A3B8",
  textMuted:  "5E6B7A",
};

const FONT_H = "Helvetica Neue";
const FONT_B = "Helvetica Neue";

// ── Helpers ────────────────────────────────────────────────
function bg(slide, color = C.bg) {
  slide.background = { color };
}

function chip(slide, x, y, w, h, text, fg = C.primary, bgc = C.surface2) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, fill: { color: bgc }, line: { color: bgc, width: 0 }, rectRadius: 0.08,
  });
  slide.addText(text, {
    x, y, w, h, fontFace: FONT_B, fontSize: 10, color: fg, bold: true,
    align: "center", valign: "middle", margin: 0,
  });
}

function header(slide, eyebrow, title) {
  slide.addText(eyebrow, {
    x: 0.6, y: 0.45, w: 12, h: 0.35,
    fontFace: FONT_B, fontSize: 11, color: C.primary, bold: true,
    charSpacing: 6, margin: 0,
  });
  slide.addText(title, {
    x: 0.6, y: 0.8, w: 12, h: 1.0,
    fontFace: FONT_H, fontSize: 36, color: C.text, bold: true,
    margin: 0,
  });
}

function footer(slide, page, total) {
  slide.addText("AIStart360 × Radius.uz · pitch · май 2026", {
    x: 0.6, y: 7.1, w: 8, h: 0.25,
    fontFace: FONT_B, fontSize: 9, color: C.textMuted, margin: 0,
  });
  slide.addText(`${page} / ${total}`, {
    x: 12.2, y: 7.1, w: 0.8, h: 0.25,
    fontFace: FONT_B, fontSize: 9, color: C.textMuted, align: "right", margin: 0,
  });
  // Top-right brand tag
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 11.7, y: 0.45, w: 1.2, h: 0.32,
    fill: { color: "0F2920" }, line: { color: C.primary, width: 0.75 }, rectRadius: 0.04,
  });
  slide.addText("AIStart360", {
    x: 11.7, y: 0.45, w: 1.2, h: 0.32,
    fontFace: FONT_B, fontSize: 9, color: C.primary, bold: true,
    align: "center", valign: "middle", margin: 0,
  });
}

function dot(slide, x, y, size = 0.18, color = C.primary) {
  slide.addShape(pres.shapes.OVAL, {
    x, y, w: size, h: size, fill: { color }, line: { color, width: 0 },
  });
}

function card(slide, x, y, w, h, opts = {}) {
  const { fill = C.surface, border = C.border, radius = 0.12 } = opts;
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, fill: { color: fill }, line: { color: border, width: 0.75 }, rectRadius: radius,
  });
}

function accentBar(slide, x, y, w) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x, y, w, h: 0.06, fill: { color: C.primary }, line: { color: C.primary, width: 0 },
  });
}

const TOTAL = 12;

// ═══════════════════════════════════════════════════════════
// SLIDE 1 — Cover
// ═══════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  bg(s);
  // Decorative blob
  s.addShape(pres.shapes.OVAL, {
    x: 9, y: -2, w: 8, h: 8,
    fill: { color: C.primary, transparency: 88 },
    line: { color: C.primary, width: 0 },
  });
  s.addShape(pres.shapes.OVAL, {
    x: -2, y: 4, w: 6, h: 6,
    fill: { color: C.accent, transparency: 92 },
    line: { color: C.accent, width: 0 },
  });

  s.addText("PITCH · МАЙ 2026", {
    x: 0.8, y: 0.9, w: 6, h: 0.4,
    fontFace: FONT_B, fontSize: 12, color: C.primary, bold: true, charSpacing: 8, margin: 0,
  });

  s.addText("AIStart360", {
    x: 0.8, y: 1.6, w: 12, h: 1.0,
    fontFace: FONT_H, fontSize: 56, color: C.text, bold: true, margin: 0,
  });
  s.addText([
    { text: "×", options: { color: C.primary, bold: true } },
    { text: "  Radius.uz", options: { color: C.text, bold: true } },
  ], {
    x: 0.8, y: 2.55, w: 12, h: 1.1,
    fontFace: FONT_H, fontSize: 56, margin: 0,
  });

  s.addText("AI-операционная система для лидера электроники Узбекистана", {
    x: 0.8, y: 4.0, w: 11, h: 0.6,
    fontFace: FONT_B, fontSize: 20, color: C.textDim, margin: 0,
  });

  // Bottom info row
  card(s, 0.8, 5.4, 3.6, 1.3, { fill: C.surface });
  s.addText("Для", { x: 1.0, y: 5.5, w: 3.2, h: 0.3, fontFace: FONT_B, fontSize: 10, color: C.textMuted, charSpacing: 4, margin: 0 });
  s.addText("Radius.uz", { x: 1.0, y: 5.8, w: 3.2, h: 0.5, fontFace: FONT_H, fontSize: 22, color: C.text, bold: true, margin: 0 });
  s.addText("официальный дистрибутор Samsung в UZ", { x: 1.0, y: 6.3, w: 3.2, h: 0.3, fontFace: FONT_B, fontSize: 9, color: C.textMuted, margin: 0 });

  card(s, 4.6, 5.4, 3.6, 1.3, { fill: C.surface });
  s.addText("Цель встречи", { x: 4.8, y: 5.5, w: 3.2, h: 0.3, fontFace: FONT_B, fontSize: 10, color: C.textMuted, charSpacing: 4, margin: 0 });
  s.addText("Запуск пилота 30 дней", { x: 4.8, y: 5.8, w: 3.2, h: 0.5, fontFace: FONT_H, fontSize: 22, color: C.text, bold: true, margin: 0 });
  s.addText("диагностика + 2 квартала отчётности", { x: 4.8, y: 6.3, w: 3.2, h: 0.3, fontFace: FONT_B, fontSize: 9, color: C.textMuted, margin: 0 });

  card(s, 8.4, 5.4, 4.1, 1.3, { fill: "0F2920", border: C.primary });
  s.addText("Контакт", { x: 8.6, y: 5.5, w: 3.8, h: 0.3, fontFace: FONT_B, fontSize: 10, color: C.primary, charSpacing: 4, margin: 0 });
  s.addText("aistart360.vercel.app", { x: 8.6, y: 5.8, w: 3.8, h: 0.5, fontFace: FONT_H, fontSize: 22, color: C.text, bold: true, margin: 0 });
  s.addText("hello@aistart360.app · Tashkent / Almaty", { x: 8.6, y: 6.3, w: 3.8, h: 0.3, fontFace: FONT_B, fontSize: 9, color: C.textMuted, margin: 0 });
}

// ═══════════════════════════════════════════════════════════
// SLIDE 2 — Кто такие Radius
// ═══════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  bg(s);
  header(s, "КТО ТАКИЕ", "Radius.uz — лидер электроники Узбекистана");
  accentBar(s, 0.6, 2.0, 1.5);

  // Left: company snapshot
  card(s, 0.6, 2.5, 6.0, 4.0);
  s.addText("Что есть сейчас", { x: 0.85, y: 2.7, w: 5.5, h: 0.35, fontFace: FONT_B, fontSize: 11, color: C.primary, charSpacing: 4, bold: true, margin: 0 });

  const items = [
    ["storefront", "Официальный дистрибутор Samsung в UZ"],
    ["public", "Доставка по всей стране, центр — Ташкент"],
    ["devices", "Каталог: смартфоны, MacBook, бытовая техника"],
    ["language", "Сайт ru / uz, поддержка 10:00–21:00"],
    ["forum", "Каналы: Facebook · Instagram · Telegram"],
    ["call", "+998 (71) 200 31 00"],
  ];
  items.forEach((it, i) => {
    const yy = 3.15 + i * 0.45;
    dot(s, 0.85, yy + 0.07, 0.12, C.primary);
    s.addText(it[1], {
      x: 1.15, y: yy, w: 5.2, h: 0.4,
      fontFace: FONT_B, fontSize: 13, color: C.text, margin: 0, valign: "middle",
    });
  });

  // Right: stat cards
  const stats = [
    { v: "100%", lbl: "доля онлайн-канала", note: "уже digital-native" },
    { v: "1 страна", lbl: "рынок", note: "Узбекистан, e-com растёт ~30%/год" },
    { v: "1 источник", lbl: "трафика", note: "собственный сайт + соцсети" },
    { v: "0 диагностики", lbl: "роста", note: "нет единого дашборда юнит-эконом" },
  ];
  stats.forEach((st, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 6.9 + col * 3.0;
    const y = 2.5 + row * 2.05;
    card(s, x, y, 2.85, 1.9);
    s.addText(st.v, { x: x + 0.2, y: y + 0.2, w: 2.5, h: 0.7, fontFace: FONT_H, fontSize: 30, color: C.primary, bold: true, margin: 0 });
    s.addText(st.lbl, { x: x + 0.2, y: y + 0.95, w: 2.5, h: 0.35, fontFace: FONT_B, fontSize: 11, color: C.text, bold: true, margin: 0 });
    s.addText(st.note, { x: x + 0.2, y: y + 1.3, w: 2.5, h: 0.5, fontFace: FONT_B, fontSize: 10, color: C.textDim, margin: 0 });
  });

  footer(s, 2, TOTAL);
}

// ═══════════════════════════════════════════════════════════
// SLIDE 3 — Вызов 2026
// ═══════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  bg(s);
  header(s, "ВЫЗОВ 2026", "Три боли электронного ритейла в UZ");
  accentBar(s, 0.6, 2.0, 1.5);

  const pains = [
    {
      n: "01",
      t: "Маржа давит дистрибуторская модель",
      d: "Samsung диктует цены, маржа узкая. Конкуренция от Mediapark, Texnomart, Idea + маркетплейсы Uzum/Sello. Без точного CAC/LTV каждая реклама режет прибыль.",
      kpi: "₸ маржа / клиент",
    },
    {
      n: "02",
      t: "Сезонность кассы",
      d: "Электроника — это пики (НГ, школьники, Рамадан) и провалы. Прогноз кэша «в голове», подушка либо избыточная, либо опасно тонкая.",
      kpi: "Cash Flow / мес",
    },
    {
      n: "03",
      t: "Повторка и сарафан",
      d: "Чек ₸2–10М, покупают раз в 2–3 года. NPS, реферальный трафик и retention — единственный путь снизить CAC. Сейчас не замеряются системно.",
      kpi: "NPS · Repeat Rate",
    },
  ];

  pains.forEach((p, i) => {
    const x = 0.6 + i * 4.3;
    const y = 2.4;
    card(s, x, y, 4.1, 4.4);
    accentBar(s, x, y, 4.1);
    s.addText(p.n, {
      x: x + 0.3, y: y + 0.3, w: 1.5, h: 0.7,
      fontFace: FONT_H, fontSize: 36, color: C.primary, bold: true, margin: 0,
    });
    s.addText(p.t, {
      x: x + 0.3, y: y + 1.1, w: 3.5, h: 0.9,
      fontFace: FONT_H, fontSize: 17, color: C.text, bold: true, margin: 0,
    });
    s.addText(p.d, {
      x: x + 0.3, y: y + 2.0, w: 3.5, h: 1.7,
      fontFace: FONT_B, fontSize: 11, color: C.textDim, margin: 0,
    });
    chip(s, x + 0.3, y + 3.85, 2.0, 0.32, p.kpi, C.primary, "0F2920");
  });

  footer(s, 3, TOTAL);
}

// ═══════════════════════════════════════════════════════════
// SLIDE 4 — Что такое AIStart360
// ═══════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  bg(s);
  header(s, "РЕШЕНИЕ", "AIStart360 — операционка роста для собственника");
  accentBar(s, 0.6, 2.0, 1.5);

  s.addText("Заполняешь анкету + загружаешь P&L → система автоматически считает «где ты сейчас», показывает «куда двигаться» и держит руку на пульсе каждый месяц.", {
    x: 0.6, y: 2.3, w: 12.2, h: 0.9,
    fontFace: FONT_B, fontSize: 16, color: C.textDim, margin: 0,
  });

  const modules = [
    { n: "1", t: "Диагностика", d: "Анкета 12 шагов + парсинг P&L / баланса / маркетинг-отчётов. AI-извлечение цифр.", color: C.primary },
    { n: "2", t: "Метрики",     d: "122 живых метрики по 7 отделам с привязкой к источнику. Не «общее место» — конкретно.", color: C.accent },
    { n: "3", t: "План",         d: "Точка А → Точка Б. 11 целей роста + 90-дневная roadmap. Gap-анализ автоматом.", color: C.primary },
    { n: "4", t: "Исполнение",   d: "Интеграции: Bitrix24, AmoCRM, n8n, Inngest. Уведомления Telegram + email при отклонениях.", color: C.accent },
  ];
  modules.forEach((m, i) => {
    const x = 0.6 + i * 3.15;
    const y = 3.5;
    card(s, x, y, 2.95, 3.2);
    s.addShape(pres.shapes.OVAL, {
      x: x + 0.3, y: y + 0.3, w: 0.7, h: 0.7,
      fill: { color: "0F2920" }, line: { color: m.color, width: 1.5 },
    });
    s.addText(m.n, {
      x: x + 0.3, y: y + 0.3, w: 0.7, h: 0.7,
      fontFace: FONT_H, fontSize: 24, color: m.color, bold: true,
      align: "center", valign: "middle", margin: 0,
    });
    s.addText(m.t, {
      x: x + 0.3, y: y + 1.2, w: 2.5, h: 0.5,
      fontFace: FONT_H, fontSize: 20, color: C.text, bold: true, margin: 0,
    });
    s.addText(m.d, {
      x: x + 0.3, y: y + 1.8, w: 2.5, h: 1.3,
      fontFace: FONT_B, fontSize: 11, color: C.textDim, margin: 0,
    });
  });

  footer(s, 4, TOTAL);
}

// ═══════════════════════════════════════════════════════════
// SLIDE 5 — Точка А
// ═══════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  bg(s);
  header(s, "МОДУЛЬ 1", "Точка А — объективный снимок «где вы сейчас»");
  accentBar(s, 0.6, 2.0, 1.5);

  // Left: process flow
  card(s, 0.6, 2.4, 5.6, 4.4);
  s.addText("Как формируется", { x: 0.85, y: 2.55, w: 5.0, h: 0.35, fontFace: FONT_B, fontSize: 11, color: C.primary, charSpacing: 4, bold: true, margin: 0 });

  const steps = [
    { n: "1", t: "Анкета 12 шагов", d: "Финансы, продажи, операции, маркетинг, команда, цели" },
    { n: "2", t: "Загрузка документов", d: "P&L, баланс, отчёты Samsung, выгрузка из 1С/CRM" },
    { n: "3", t: "AI-извлечение", d: "OpenRouter Sonnet парсит → цифры в нужные поля" },
    { n: "4", t: "Расчёт 5 блоков", d: "Финансы 30% · Продажи 25% · Операции 20% · Маркетинг 15% · Стратегия 10%" },
    { n: "5", t: "GRI Score 0–100", d: "Общий балл + health-индекс + стадия зрелости" },
  ];
  steps.forEach((st, i) => {
    const y = 3.0 + i * 0.72;
    // number circle
    s.addShape(pres.shapes.OVAL, {
      x: 0.85, y: y, w: 0.5, h: 0.5,
      fill: { color: "0F2920" }, line: { color: C.primary, width: 1.25 },
    });
    s.addText(st.n, {
      x: 0.85, y: y, w: 0.5, h: 0.5,
      fontFace: FONT_H, fontSize: 16, color: C.primary, bold: true,
      align: "center", valign: "middle", margin: 0,
    });
    s.addText(st.t, {
      x: 1.5, y: y - 0.02, w: 4.5, h: 0.32,
      fontFace: FONT_B, fontSize: 13, color: C.text, bold: true, margin: 0,
    });
    s.addText(st.d, {
      x: 1.5, y: y + 0.28, w: 4.5, h: 0.32,
      fontFace: FONT_B, fontSize: 10, color: C.textDim, margin: 0,
    });
  });

  // Right: mock dashboard preview
  card(s, 6.5, 2.4, 6.3, 4.4, { fill: "0E1620", border: C.border });
  s.addText("Что увидит собственник Radius", { x: 6.75, y: 2.55, w: 5.8, h: 0.35, fontFace: FONT_B, fontSize: 11, color: C.primary, charSpacing: 4, bold: true, margin: 0 });

  // Big score
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

  // 5-block bars
  const blocks = [
    { n: "Финансы", v: 0.74, c: C.primary },
    { n: "Продажи", v: 0.82, c: C.primary },
    { n: "Операции", v: 0.41, c: C.error },
    { n: "Маркетинг", v: 0.52, c: C.warn },
    { n: "Стратегия", v: 0.67, c: C.primary },
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
// SLIDE 6 — Метрики
// ═══════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  bg(s);
  header(s, "МОДУЛЬ 2", "122 метрики · 7 отделов · с привязкой к источнику");
  accentBar(s, 0.6, 2.0, 1.5);

  s.addText("Каждая метрика знает, откуда брать данные: поле анкеты, выгрузка из 1С, документ от Samsung, GA, CRM или внешний API. Не «общее место».", {
    x: 0.6, y: 2.3, w: 12.2, h: 0.6,
    fontFace: FONT_B, fontSize: 13, color: C.textDim, margin: 0,
  });

  // Departments grid 4x2 + 1 wide
  const depts = [
    { icon: "💳", name: "Финансы", n: 8, kpi: "Выручка · EBITDA · ROA · Cash Flow" },
    { icon: "📣", name: "Маркетинг", n: 9, kpi: "CAC · CPL · ER · NPS · посещения" },
    { icon: "🤝", name: "Продажи", n: 7, kpi: "Чек · Win Rate · Цикл · TTR" },
    { icon: "⚙️", name: "Операции", n: 7, kpi: "SLA · SKU · Брак · Производительность" },
    { icon: "👥", name: "HR / Команда", n: 6, kpi: "Текучка · eNPS · Time-to-Hire · OKR" },
    { icon: "📦", name: "Продукт", n: 5, kpi: "Доля рынка · Экспорт · Онлайн · SKU" },
    { icon: "❤️", name: "Клиенты", n: 6, kpi: "Активные · Churn · NPS · Retention · ARPU" },
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

  // Total chip
  chip(s, 0.6, 6.85, 2.6, 0.32, "ИТОГО · 48 БИЗ + 12 KPI + 7 GRI + 55 ЦЕЛЕЙ = 122", C.bg, C.primary);

  footer(s, 6, TOTAL);
}

// ═══════════════════════════════════════════════════════════
// SLIDE 7 — GRI Pulse
// ═══════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  bg(s);
  header(s, "МОДУЛЬ 3", "GRI Pulse — 7 блоков готовности к росту");
  accentBar(s, 0.6, 2.0, 1.5);

  s.addText("Не аудит, а маршрут. Видно где «бутылочное горлышко» и куда инвестировать рубль, чтобы получить 5 рублей.", {
    x: 0.6, y: 2.3, w: 12.2, h: 0.5,
    fontFace: FONT_B, fontSize: 13, color: C.textDim, margin: 0,
  });

  const griBlocks = [
    { n: "Бизнес-модель",       s: 7.4, st: "ok" },
    { n: "Готовность основателя", s: 6.7, st: "ok" },
    { n: "Доверие и позиция",    s: 5.2, st: "weak" },
    { n: "Стабильность кассы",   s: 5.0, st: "weak" },
    { n: "Продукт и спрос",      s: 4.7, st: "weak" },
    { n: "Команда",              s: 2.6, st: "critical" },
    { n: "Операции",             s: 2.1, st: "critical" },
  ];
  const colorByStatus = (st) => st === "critical" ? C.error : st === "weak" ? C.warn : C.primary;
  const labelByStatus = (st) => st === "critical" ? "КРИТИЧЕСКИЙ" : st === "weak" ? "СЛАБОЕ МЕСТО" : "ДОСТАТОЧНО";

  griBlocks.forEach((b, i) => {
    const y = 2.95 + i * 0.55;
    card(s, 0.6, y, 8.6, 0.45, { fill: C.surface, radius: 0.06 });
    s.addText(b.n, { x: 0.85, y: y, w: 2.7, h: 0.45, fontFace: FONT_B, fontSize: 12, color: C.text, valign: "middle", margin: 0 });
    s.addShape(pres.shapes.RECTANGLE, { x: 3.65, y: y + 0.16, w: 4.3, h: 0.14, fill: { color: C.surface2 }, line: { color: C.surface2, width: 0 } });
    s.addShape(pres.shapes.RECTANGLE, { x: 3.65, y: y + 0.16, w: 4.3 * (b.s / 10), h: 0.14, fill: { color: colorByStatus(b.st) }, line: { color: colorByStatus(b.st), width: 0 } });
    s.addText(`${b.s}/10`, { x: 8.05, y: y, w: 1.0, h: 0.45, fontFace: FONT_B, fontSize: 11, color: colorByStatus(b.st), bold: true, valign: "middle", align: "right", margin: 0 });
  });

  // Overall + insight
  card(s, 9.4, 2.95, 3.4, 2.5, { fill: "0F2920", border: C.primary });
  s.addText("GRI ИТОГОВЫЙ", { x: 9.6, y: 3.1, w: 3.0, h: 0.3, fontFace: FONT_B, fontSize: 9, color: C.primary, charSpacing: 6, bold: true, margin: 0 });
  s.addText("4.7", { x: 9.6, y: 3.4, w: 3.0, h: 1.0, fontFace: FONT_H, fontSize: 56, color: C.text, bold: true, margin: 0 });
  s.addText("/ 10", { x: 11.8, y: 3.9, w: 0.8, h: 0.5, fontFace: FONT_B, fontSize: 16, color: C.textDim, margin: 0 });
  s.addText("Средний уровень. Главный тормоз — Операции и Команда. Без них любые $$ в рекламу = слив.", {
    x: 9.6, y: 4.55, w: 3.0, h: 0.85, fontFace: FONT_B, fontSize: 10, color: C.textDim, margin: 0,
  });

  card(s, 9.4, 5.55, 3.4, 1.5);
  s.addText("ЧТО ДЕЛАТЬ ПЕРВЫМ", { x: 9.6, y: 5.65, w: 3.0, h: 0.3, fontFace: FONT_B, fontSize: 9, color: C.primary, charSpacing: 6, bold: true, margin: 0 });
  s.addText("Регламенты процессов · KPI команды · BI-отчётность", {
    x: 9.6, y: 5.95, w: 3.0, h: 0.95, fontFace: FONT_B, fontSize: 11, color: C.text, margin: 0,
  });

  footer(s, 7, TOTAL);
}

// ═══════════════════════════════════════════════════════════
// SLIDE 8 — План: 11 целей + 90 дней
// ═══════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  bg(s);
  header(s, "МОДУЛЬ 4", "Точка Б — план роста с измеримой целью");
  accentBar(s, 0.6, 2.0, 1.5);

  // Target KPIs row
  const targets = [
    { k: "ARR", cur: "$5M", tgt: "$8M", pct: 63 },
    { k: "Средний чек", cur: "₸2.1М", tgt: "₸2.4М", pct: 87 },
    { k: "LTV/CAC", cur: "2.2x", tgt: "≥3x", pct: 73 },
    { k: "NPS", cur: "38", tgt: "50+", pct: 76 },
    { k: "Доля повторки", cur: "18%", tgt: "35%", pct: 51 },
  ];
  s.addText("Целевые KPI на 12 месяцев (для иллюстрации; настраивается по факту анкеты Radius)", {
    x: 0.6, y: 2.3, w: 12.2, h: 0.3, fontFace: FONT_B, fontSize: 10, color: C.textMuted, margin: 0,
  });
  targets.forEach((t, i) => {
    const x = 0.6 + i * 2.45;
    const y = 2.7;
    card(s, x, y, 2.3, 1.5);
    s.addText(t.k, { x: x + 0.2, y: y + 0.15, w: 1.95, h: 0.3, fontFace: FONT_B, fontSize: 10, color: C.textMuted, charSpacing: 4, bold: true, margin: 0 });
    s.addText(t.tgt, { x: x + 0.2, y: y + 0.45, w: 1.95, h: 0.55, fontFace: FONT_H, fontSize: 22, color: C.primary, bold: true, margin: 0 });
    s.addText(`сейчас: ${t.cur}`, { x: x + 0.2, y: y + 1.0, w: 1.95, h: 0.3, fontFace: FONT_B, fontSize: 9, color: C.textDim, margin: 0 });
    s.addShape(pres.shapes.RECTANGLE, { x: x + 0.2, y: y + 1.3, w: 1.95, h: 0.08, fill: { color: C.surface2 }, line: { color: C.surface2, width: 0 } });
    s.addShape(pres.shapes.RECTANGLE, { x: x + 0.2, y: y + 1.3, w: 1.95 * (t.pct / 100), h: 0.08, fill: { color: C.primary }, line: { color: C.primary, width: 0 } });
  });

  // Roadmap 90 days
  s.addText("90-дневная roadmap", { x: 0.6, y: 4.4, w: 8, h: 0.35, fontFace: FONT_B, fontSize: 11, color: C.primary, charSpacing: 4, bold: true, margin: 0 });
  const phases = [
    { p: "Дни 1–30", t: "Стабилизация", c: C.error, items: ["Регламенты опер.", "KPI команды", "Парсинг 2 кв. отчётов"] },
    { p: "Дни 31–60", t: "Атрибуция", c: C.warn, items: ["UTM-разметка", "CAC по каналу", "NPS-замер"] },
    { p: "Дни 61–90", t: "Рычаги роста", c: C.primary, items: ["Программа повторки", "Апсейл-сценарии", "Сарафан-программа"] },
  ];
  phases.forEach((ph, i) => {
    const x = 0.6 + i * 4.2;
    const y = 4.8;
    card(s, x, y, 4.0, 2.2);
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: 4.0, h: 0.08, fill: { color: ph.c }, line: { color: ph.c, width: 0 } });
    s.addText(ph.p, { x: x + 0.25, y: y + 0.2, w: 3.5, h: 0.3, fontFace: FONT_B, fontSize: 10, color: ph.c, charSpacing: 4, bold: true, margin: 0 });
    s.addText(ph.t, { x: x + 0.25, y: y + 0.5, w: 3.5, h: 0.45, fontFace: FONT_H, fontSize: 18, color: C.text, bold: true, margin: 0 });
    ph.items.forEach((it, j) => {
      const yy = y + 1.05 + j * 0.32;
      dot(s, x + 0.3, yy + 0.08, 0.12, ph.c);
      s.addText(it, { x: x + 0.55, y: yy, w: 3.2, h: 0.3, fontFace: FONT_B, fontSize: 11, color: C.text, margin: 0 });
    });
  });

  footer(s, 8, TOTAL);
}

// ═══════════════════════════════════════════════════════════
// SLIDE 9 — AI-парсер документов
// ═══════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  bg(s);
  header(s, "AI-ПАРСЕР", "P&L · баланс · отчёты Samsung · 1С — в один клик");
  accentBar(s, 0.6, 2.0, 1.5);

  s.addText("Закидываете документ → AI извлекает 30–60 ключевых полей и мапит их в нужные разделы дашборда. Не нужно вручную перепечатывать.", {
    x: 0.6, y: 2.3, w: 12.2, h: 0.5,
    fontFace: FONT_B, fontSize: 13, color: C.textDim, margin: 0,
  });

  // Pipeline: 3 cards with arrows
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
  // Arrows
  [4.5, 8.9].forEach((x) => {
    s.addText("→", { x: x, y: 3.8, w: 0.5, h: 0.5, fontFace: FONT_H, fontSize: 32, color: C.primary, align: "center", margin: 0 });
  });

  // Doc types row
  s.addText("Поддерживаемые типы документов", { x: 0.6, y: 5.2, w: 8, h: 0.35, fontFace: FONT_B, fontSize: 11, color: C.primary, charSpacing: 4, bold: true, margin: 0 });
  const types = [
    "P&L отчёт", "Бухбаланс", "Marketing report", "Ops report",
    "CRM-export", "Аудит", "Прайс Samsung", "Другое",
  ];
  types.forEach((t, i) => {
    const x = 0.6 + (i % 8) * 1.55;
    chip(s, x, 5.6, 1.45, 0.45, t, C.text, C.surface2);
  });

  // Bottom result
  card(s, 0.6, 6.3, 12.2, 0.7, { fill: "0F2920", border: C.primary });
  s.addText("✓ В демо-парсинге 3-страничного P&L: 47 полей извлечено за 8 секунд, точность маппинга 92%", {
    x: 0.85, y: 6.3, w: 11.7, h: 0.7, fontFace: FONT_B, fontSize: 13, color: C.primary, bold: true, valign: "middle", margin: 0,
  });

  footer(s, 9, TOTAL);
}

// ═══════════════════════════════════════════════════════════
// SLIDE 10 — Интеграции
// ═══════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  bg(s);
  header(s, "ИНТЕГРАЦИИ", "Не заменяем ваши инструменты — подключаемся к ним");
  accentBar(s, 0.6, 2.0, 1.5);

  const groups = [
    {
      t: "CRM / Продажи",
      items: ["Bitrix24", "AmoCRM", "1С"],
      desc: "Сделки, средний чек, цикл закрытия, конверсия по этапам",
    },
    {
      t: "Маркетинг / Аналитика",
      items: ["Google Analytics 4", "Яндекс.Метрика", "Meta Graph", "TikTok"],
      desc: "Атрибуция «канал → выручка», CPL, ER по площадкам",
    },
    {
      t: "Коммуникации",
      items: ["Telegram-бот", "Resend email", "WhatsApp Business"],
      desc: "Алёрты при отклонениях, weekly digest, NPS-опросы",
    },
    {
      t: "Оркестрация",
      items: ["n8n", "Inngest", "Webhook API"],
      desc: "Регулярная синхронизация, ретраи, очереди задач",
    },
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

  // Bottom note
  s.addText("Для Radius: подключаем то, что уже есть. Поверх — единая аналитика и алёрты.", {
    x: 0.6, y: 7.0, w: 12.2, h: 0.3, fontFace: FONT_B, fontSize: 11, color: C.textMuted, italic: true, margin: 0,
  });

  footer(s, 10, TOTAL);
}

// ═══════════════════════════════════════════════════════════
// SLIDE 11 — ROI / эффект
// ═══════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  bg(s);
  header(s, "ROI", "Что меняется в Radius через 90 дней");
  accentBar(s, 0.6, 2.0, 1.5);

  // Big stat callouts
  const wins = [
    { v: "+15%", t: "средний чек", d: "Через апсейл и bundle-сценарии (аксессуары к смартфонам, страховки, доставка)" },
    { v: "−20%", t: "CAC", d: "Через атрибуцию «канал → выручка» и отключение неэффективных каналов" },
    { v: "+30%", t: "retention 30d", d: "Через NPS-опрос + триггерные коммуникации после покупки" },
  ];
  wins.forEach((w, i) => {
    const x = 0.6 + i * 4.2;
    const y = 2.4;
    card(s, x, y, 4.0, 2.5);
    accentBar(s, x, y, 4.0);
    s.addText(w.v, { x: x + 0.3, y: y + 0.3, w: 3.5, h: 1.0, fontFace: FONT_H, fontSize: 56, color: C.primary, bold: true, margin: 0 });
    s.addText(w.t, { x: x + 0.3, y: y + 1.3, w: 3.5, h: 0.4, fontFace: FONT_H, fontSize: 18, color: C.text, bold: true, margin: 0 });
    s.addText(w.d, { x: x + 0.3, y: y + 1.75, w: 3.5, h: 0.7, fontFace: FONT_B, fontSize: 11, color: C.textDim, margin: 0 });
  });

  // Cost vs payback row
  card(s, 0.6, 5.1, 6.0, 1.7, { fill: C.surface });
  s.addText("СТОИМОСТЬ", { x: 0.85, y: 5.2, w: 5.5, h: 0.3, fontFace: FONT_B, fontSize: 9, color: C.textMuted, charSpacing: 6, bold: true, margin: 0 });
  s.addText("Pilot 30 дней — бесплатно", { x: 0.85, y: 5.5, w: 5.5, h: 0.4, fontFace: FONT_H, fontSize: 18, color: C.text, bold: true, margin: 0 });
  s.addText("Далее: подписка $300–800/мес в зависимости от объёма документов и числа пользователей.", {
    x: 0.85, y: 5.95, w: 5.5, h: 0.8, fontFace: FONT_B, fontSize: 11, color: C.textDim, margin: 0,
  });

  card(s, 6.8, 5.1, 6.0, 1.7, { fill: "0F2920", border: C.primary });
  s.addText("ОКУПАЕМОСТЬ", { x: 7.05, y: 5.2, w: 5.5, h: 0.3, fontFace: FONT_B, fontSize: 9, color: C.primary, charSpacing: 6, bold: true, margin: 0 });
  s.addText("Месяц 1 — за счёт одного апсейл-сценария", { x: 7.05, y: 5.5, w: 5.5, h: 0.4, fontFace: FONT_H, fontSize: 18, color: C.text, bold: true, margin: 0 });
  s.addText("Снижение CAC на 5% при выручке Radius окупает годовую подписку за ~6 недель.", {
    x: 7.05, y: 5.95, w: 5.5, h: 0.8, fontFace: FONT_B, fontSize: 11, color: C.textDim, margin: 0,
  });

  footer(s, 11, TOTAL);
}

// ═══════════════════════════════════════════════════════════
// SLIDE 12 — Следующие шаги
// ═══════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  bg(s);
  // Decorative
  s.addShape(pres.shapes.OVAL, {
    x: -2, y: -2, w: 8, h: 8,
    fill: { color: C.primary, transparency: 92 },
    line: { color: C.primary, width: 0 },
  });

  s.addText("СЛЕДУЮЩИЕ ШАГИ", { x: 0.8, y: 0.9, w: 8, h: 0.4, fontFace: FONT_B, fontSize: 12, color: C.primary, bold: true, charSpacing: 8, margin: 0 });

  s.addText("3 шага — и через 90 дней Radius управляется по цифрам, а не «по ощущениям»", {
    x: 0.8, y: 1.4, w: 12, h: 1.5, fontFace: FONT_H, fontSize: 32, color: C.text, bold: true, margin: 0,
  });

  const next = [
    { n: "01", t: "Демо 30 минут", d: "Покажем платформу на реальных данных другого ритейлера. Ответим на технические вопросы.", when: "На этой неделе" },
    { n: "02", t: "Pilot 30 дней", d: "Анкета + парсинг 2 кварталов отчётов. Получаете Точку А, GRI, 11 целей. Бесплатно.", when: "Старт через 5 рабочих дней" },
    { n: "03", t: "Внедрение", d: "Интеграция с вашими CRM/аналитикой, обучение команды, ежемесячные апдейты. Подписка.", when: "После пилота" },
  ];
  next.forEach((n, i) => {
    const y = 3.3 + i * 1.2;
    card(s, 0.8, y, 12.0, 1.05);
    s.addText(n.n, { x: 1.0, y: y + 0.2, w: 0.8, h: 0.65, fontFace: FONT_H, fontSize: 28, color: C.primary, bold: true, margin: 0 });
    s.addText(n.t, { x: 1.95, y: y + 0.15, w: 7.5, h: 0.4, fontFace: FONT_H, fontSize: 18, color: C.text, bold: true, margin: 0 });
    s.addText(n.d, { x: 1.95, y: y + 0.55, w: 7.5, h: 0.45, fontFace: FONT_B, fontSize: 11, color: C.textDim, margin: 0 });
    chip(s, 9.6, y + 0.3, 3.0, 0.45, n.when, C.primary, "0F2920");
  });

  // Contact strip
  card(s, 0.8, 7.0, 12.0, 0.35, { fill: "0F2920", border: C.primary, radius: 0.05 });
  s.addText("hello@aistart360.app  ·  aistart360.vercel.app  ·  Almaty / Tashkent", {
    x: 0.8, y: 7.0, w: 12.0, h: 0.35,
    fontFace: FONT_B, fontSize: 11, color: C.primary, bold: true,
    align: "center", valign: "middle", margin: 0,
  });
}

// ── Save ────────────────────────────────────────────────────
const outPath = path.resolve(__dirname, "..", "Radius_AIStart360_Pitch.pptx");
pres.writeFile({ fileName: outPath }).then((fn) => {
  console.log("Wrote", fn);
});
