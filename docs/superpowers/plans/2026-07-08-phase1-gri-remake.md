# Фаза 1: Ремейк /gri + баг-фиксы туров «Гри» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Вкладочный ремейк страницы /gri с серверной персистенцией сессий калькулятора и честными AI-функциями + фикс двух багов туров Гри (выход карточки за экран, «туры постоянно»).

**Architecture:** Страница /gri становится композицией `GriPageShell` (клиентский контейнер: hero + 4 вкладки + shared-стейт оценок), в который встраиваются существующие GRICalculator/GRIAssessment и три новых панели (Результат, Динамика, AI-аналитик). Сессии калькулятора переезжают в новую Supabase-таблицу `gri_calc_sessions` (RLS по шаблону 027). Баг-фиксы туров: чистая функция геометрии + проверка результата UPDATE + union-merge настроек.

**Tech Stack:** Next.js 14 App Router, Supabase (RLS), vitest, recharts, framer-motion, Tailwind, существующие lib/documents/parse.ts и lib/reports/pdf.ts.

**Спека:** `docs/superpowers/specs/2026-07-08-gri-pulse-crm-design.md` (секции A и B-багфиксы).

**Конвенции:** русский UI, primary `#6effc0`, конверт API `{ok, data|error}`, тесты `npx vitest run <path>`, линт `npm run lint`. Прод-аутентификация — Supabase (`createServerClient` из `lib/supabase-server.ts`); Prisma-стек не трогаем. Коммиты — после каждой задачи.

---

## Блок A — Баг-фиксы туров «Гри»

### Task 1: Чистая функция геометрии карточки тура

**Files:**
- Create: `lib/assistant/mascot/coachmark-layout.ts`
- Test: `tests/unit/assistant-mascot/coachmark-layout.test.ts`

Сейчас карточка (MascotCoachmarks.tsx:114-125,149-160) позиционируется `top/left` + `transform: translateY(-100%)` для положения «над таргетом», но framer-motion `animate` перезаписывает transform → карточка рисуется НИЖЕ таргета и уходит за нижнюю границу. Ширина 330 фиксирована. Выносим геометрию в чистую функцию (тестируемо) и считаем всё в top/left без transform.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/assistant-mascot/coachmark-layout.test.ts
import { describe, it, expect } from 'vitest'
import { computeCoachmarkLayout } from '@/lib/assistant/mascot/coachmark-layout'

const VW = 1280
const VH = 800
const CARD_H = 200

describe('computeCoachmarkLayout', () => {
  it('places the card below the target when there is room', () => {
    const r = computeCoachmarkLayout({ top: 100, left: 500, width: 200, height: 50 }, VW, VH, CARD_H)
    expect(r.below).toBe(true)
    expect(r.top).toBe(100 + 50 + 14) // target bottom + gap
  })

  it('places the card above the target when no room below', () => {
    const r = computeCoachmarkLayout({ top: 700, left: 500, width: 200, height: 60 }, VW, VH, CARD_H)
    expect(r.below).toBe(false)
    expect(r.top).toBe(700 - 14 - CARD_H) // target top - gap - card height
    expect(r.top + CARD_H).toBeLessThanOrEqual(VH - 12)
  })

  it('clamps the card into the viewport vertically (huge target)', () => {
    const r = computeCoachmarkLayout({ top: 10, left: 100, width: 300, height: 900 }, VW, VH, CARD_H)
    expect(r.top).toBeGreaterThanOrEqual(12)
    expect(r.top + CARD_H).toBeLessThanOrEqual(VH - 12 + 1)
  })

  it('shrinks width on narrow viewports', () => {
    const r = computeCoachmarkLayout({ top: 100, left: 0, width: 40, height: 40 }, 320, 700, CARD_H)
    expect(r.width).toBe(320 - 24)
    expect(r.left + r.width).toBeLessThanOrEqual(320 - 12 + 1)
  })

  it('uses full 330 width when viewport allows', () => {
    const r = computeCoachmarkLayout({ top: 100, left: 0, width: 40, height: 40 }, 1280, 800, CARD_H)
    expect(r.width).toBe(330)
    expect(r.left).toBeGreaterThanOrEqual(12)
  })

  it('keeps the arrow within the card', () => {
    const r = computeCoachmarkLayout({ top: 100, left: 1200, width: 60, height: 40 }, VW, VH, CARD_H)
    expect(r.arrowLeft).toBeGreaterThanOrEqual(18)
    expect(r.arrowLeft).toBeLessThanOrEqual(r.width - 18)
  })

  it('falls back to a safe top-left position without a rect', () => {
    const r = computeCoachmarkLayout(null, VW, VH, CARD_H)
    expect(r.top).toBe(12)
    expect(r.left).toBe(12)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/assistant-mascot/coachmark-layout.test.ts`
Expected: FAIL — `Cannot find module '@/lib/assistant/mascot/coachmark-layout'`

- [ ] **Step 3: Write the implementation**

```ts
// lib/assistant/mascot/coachmark-layout.ts
/**
 * Pure geometry for the coachmark card: viewport-clamped top/left placement
 * (no CSS transforms — framer-motion's `animate` owns `transform`).
 */
export interface TargetRect {
  top: number
  left: number
  width: number
  height: number
}

export interface CardPlacement {
  top: number
  left: number
  below: boolean
  arrowLeft: number
  width: number
}

const GAP = 14
const MARGIN = 12
const MAX_W = 330

export function computeCoachmarkLayout(
  rect: TargetRect | null,
  vw: number,
  vh: number,
  cardH: number,
): CardPlacement {
  const width = Math.min(MAX_W, vw - MARGIN * 2)
  if (!rect) {
    return { top: MARGIN, left: MARGIN, below: true, arrowLeft: width / 2, width }
  }
  const cx = rect.left + rect.width / 2
  const fitsBelow = rect.top + rect.height + GAP + cardH + MARGIN <= vh
  const fitsAbove = rect.top - GAP - cardH >= MARGIN
  const below = fitsBelow || !fitsAbove
  let top = below ? rect.top + rect.height + GAP : rect.top - GAP - cardH
  top = Math.min(Math.max(MARGIN, top), Math.max(MARGIN, vh - cardH - MARGIN))
  const left = Math.min(Math.max(MARGIN, cx - width / 2), Math.max(MARGIN, vw - width - MARGIN))
  const arrowLeft = Math.min(Math.max(18, cx - left - 7), width - 18)
  return { top, left, below, arrowLeft, width }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/assistant-mascot/coachmark-layout.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/assistant/mascot/coachmark-layout.ts tests/unit/assistant-mascot/coachmark-layout.test.ts
git commit -m "feat(mascot): чистая функция геометрии карточки тура с клампом в вьюпорт"
```

### Task 2: MascotCoachmarks — применить геометрию, измерять высоту карточки, ждать поздние таргеты

**Files:**
- Modify: `components/assistant/mascot/MascotCoachmarks.tsx`

Три изменения:
1. `liveSteps` считается один раз в `useMemo` (строка 51) — шаги с поздно рендерящимися таргетами молча выпадают. Заменить на навигацию по ВСЕМ `steps` с ожиданием таргета текущего шага (поллинг 250мс до 3с, затем авто-скип шага).
2. Позиционирование карточки — через `computeCoachmarkLayout` + реальная высота карточки (ref + `useLayoutEffect`), убрать `transform: translateY(-100%)` и ручной расчёт (строки 111-125, 154-160).
3. Ширина карточки — из layout (мобильные).

- [ ] **Step 1: Внести изменения**

Заменить блок состояния и логики (строки 50-125) на:

```tsx
import { computeCoachmarkLayout } from '@/lib/assistant/mascot/coachmark-layout'
// (import добавить к существующим; useMemo из импорта react можно убрать, если больше не используется)

  const [idx, setIdx] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [cardH, setCardH] = useState(200)
  const [waiting, setWaiting] = useState(false)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef(0)

  const finish = useCallback((done: boolean) => onClose(done), [onClose])

  useEffect(() => {
    if (steps.length === 0) finish(false)
  }, [steps.length, finish])

  const step = steps[idx]

  // Wait for the current step's target: poll up to 3s, then auto-skip the step.
  useEffect(() => {
    if (!step) return
    let cancelled = false
    let tries = 0
    setWaiting(true)
    setRect(null)
    const tryFind = () => {
      if (cancelled) return
      const el = findTarget(step.selector)
      if (el) {
        setWaiting(false)
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        setTimeout(() => {
          if (cancelled) return
          const r = el.getBoundingClientRect()
          setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
        }, 420)
        return
      }
      tries += 1
      if (tries >= 12) {
        // target never appeared — skip this step (last step → finish as done)
        setWaiting(false)
        if (idx < steps.length - 1) setIdx((v) => v + 1)
        else finish(true)
        return
      }
      setTimeout(tryFind, 250)
    }
    tryFind()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, step?.selector])

  // Track the target rect on scroll/resize.
  useEffect(() => {
    if (!step) return
    const onMove = () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        const el = findTarget(step.selector)
        if (!el) return
        const r = el.getBoundingClientRect()
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
      })
    }
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, { passive: true, capture: true })
    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, { capture: true })
    }
  }, [idx, step?.selector])

  // Measure real card height (content varies per step).
  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight
    if (h && h > 0) setCardH(h)
  }, [idx, rect])
```

Клавиатурный эффект (строки 97-106) оставить, заменив `liveSteps` на `steps`. Ранний выход (строки 108-112) заменить на:

```tsx
  if (!step || waiting) {
    // dim the page while waiting so the user sees the tour is in progress
    return step ? (
      <div className="fixed inset-0 z-[70] bg-black/50" aria-hidden />
    ) : null
  }

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const layout = computeCoachmarkLayout(rect, vw, vh, cardH)
```

В JSX карточки (строки 149-171): `ref={cardRef}`, `width: layout.width`, `left: layout.left`, `top: layout.top`, УДАЛИТЬ `transform: below ? undefined : 'translateY(-100%)'`; в initial-анимации `y: layout.below ? 8 : -8`; стрелка — `layout.below` и `left: layout.arrowLeft`. Точки прогресса и подписи (`liveSteps.map` → `steps.map`, `idx === liveSteps.length - 1` → `idx === steps.length - 1`). `useLayoutEffect` добавить в импорт react.

- [ ] **Step 2: Проверить типы и линт**

Run: `npx tsc --noEmit 2>&1 | grep -i coachmark; npm run lint -- --file components/assistant/mascot/MascotCoachmarks.tsx`
Expected: без ошибок (если `next lint --file` не поддержан — просто `npm run lint`)

- [ ] **Step 3: Ручная верификация в превью**

Запустить дев-сервер (preview_start), открыть /dashboard, вызвать тур через меню Гри «Подсказки по странице». Проверить: карточка не выходит за нижнюю границу (шаг с таргетом внизу страницы), при узком вьюпорте (preview_resize mobile) ширина ≤ vw−24.

- [ ] **Step 4: Commit**

```bash
git add components/assistant/mascot/MascotCoachmarks.tsx
git commit -m "fix(mascot): карточка тура больше не выходит за экран; ожидание поздних таргетов вместо молчаливого выпадения шагов"
```

### Task 3: Персистенция toursDone — проверять результат UPDATE

**Files:**
- Modify: `lib/assistant/mascot/settings-server.ts:136-142`
- Test: `tests/unit/assistant-mascot/settings-server-write.test.ts`

`UPDATE profiles`, молча срезанный RLS, возвращает `error=null` и 0 строк — код считает это успехом, toursDone не сохраняется, туры перезапускаются вечно.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/assistant-mascot/settings-server-write.test.ts
import { describe, it, expect, vi } from 'vitest'
import { writeMascotSettings } from '@/lib/assistant/mascot/settings-server'

function mockSb(updateResult: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn(),
    update: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { preferences: {} }, error: null }),
  }
  // read chain: .from().select().eq().maybeSingle()
  // write chain: .from().update().eq().select() → updateResult
  chain.eq.mockImplementation(() => ({ ...chain, select: vi.fn().mockResolvedValue(updateResult) }))
  return { from: vi.fn(() => chain) } as never
}

describe('writeMascotSettings', () => {
  it('throws when the UPDATE affects 0 rows (silent RLS no-op)', async () => {
    const sb = mockSb({ data: [], error: null })
    await expect(
      writeMascotSettings(sb, 'user-1', { toursDone: ['/gri'] }),
    ).rejects.toThrow(/0 rows/)
  })

  it('returns merged settings when the UPDATE lands', async () => {
    const sb = mockSb({ data: [{ id: 'user-1' }], error: null })
    const res = await writeMascotSettings(sb, 'user-1', { toursDone: ['/gri'] })
    expect(res.toursDone).toContain('/gri')
  })
})
```

Если цепочка мока не совпадёт с реальными вызовами (`.maybeSingle` на чтение, `.select('id')` на запись) — поправь мок под фактические вызовы, НЕ реализацию под мок.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/assistant-mascot/settings-server-write.test.ts`
Expected: FAIL — второй тест может пройти, первый падает (сейчас 0 строк = успех)

- [ ] **Step 3: Implementation**

В `writeMascotSettings` заменить строки 136-142 на:

```ts
  const { data: updated, error } = await sb
    .from('profiles')
    .update({ preferences: { ...prefs, assistant: merged } })
    .eq('id', userId)
    .select('id')

  if (error) throw error
  if (!updated || updated.length === 0) {
    // RLS silently dropped the UPDATE — surfacing it beats "tours forever".
    throw new Error(`mascot settings update affected 0 rows for user ${userId}`)
  }
  return merged
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/assistant-mascot/`
Expected: PASS (все)

- [ ] **Step 5: Commit**

```bash
git add lib/assistant/mascot/settings-server.ts tests/unit/assistant-mascot/settings-server-write.test.ts
git commit -m "fix(mascot): молчаливый RLS no-op при записи настроек стал ошибкой — корень «туров постоянно»"
```

### Task 4: Гонка клоббера toursDone — union-merge в setContext

**Files:**
- Modify: `lib/assistant/mascot/state.ts:82-88`
- Test: `tests/unit/assistant-mascot/state-toursdone-merge.test.ts`

Параллельный `/context` со старыми settings перезаписывает только что применённый локальный `toursDone`. Сервер остаётся источником истины для всего, КРОМЕ монотонно растущих списков `toursDone`/`dismissedHints` — их объединяем.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/assistant-mascot/state-toursdone-merge.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useMascotStore } from '@/lib/assistant/mascot/state'
import { DEFAULT_MASCOT_SETTINGS } from '@/lib/assistant/mascot/types'

// Payload-минимум: смотри AssistantContextPayload — заполни обязательные поля
// значениями по умолчанию (progress/results/hints) из фактического типа.
function payloadWith(settings: Partial<typeof DEFAULT_MASCOT_SETTINGS>) {
  return {
    progress: { completionPct: 0, completedSections: 0, nextSection: null, status: 'empty' },
    results: { hasDiagnostic: false, griIndex: null, topLimit: null, realismLevel: null },
    hints: [],
    settings: { ...DEFAULT_MASCOT_SETTINGS, ...settings },
  } as never
}

describe('setContext toursDone merge', () => {
  beforeEach(() => {
    useMascotStore.setState({
      settings: { ...DEFAULT_MASCOT_SETTINGS, toursDone: ['/gri'] },
    } as never)
  })

  it('does not lose locally completed tours when the server copy is stale', () => {
    useMascotStore.getState().setContext(payloadWith({ toursDone: ['/dashboard'] }))
    const done = useMascotStore.getState().settings.toursDone
    expect(done).toContain('/gri')
    expect(done).toContain('/dashboard')
  })

  it('still adopts server-side settings fields', () => {
    useMascotStore.getState().setContext(payloadWith({ greeted: true } as never))
    expect((useMascotStore.getState().settings as { greeted?: boolean }).greeted).toBe(true)
  })
})
```

Сверь имена полей payload с реальным `AssistantContextPayload` (lib/assistant/mascot/types.ts) и поправь фикстуру при расхождении.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/assistant-mascot/state-toursdone-merge.test.ts`
Expected: FAIL — первый тест: '/gri' потерян

- [ ] **Step 3: Implementation**

В `state.ts` заменить `setContext` (строки 82-88) на:

```ts
      setContext: (payload) =>
        set((s) => ({
          context: payload,
          contextFetchedAt: Date.now(),
          // Server settings win, EXCEPT monotonically growing lists: a stale
          // /context response must not clobber a tour completed a second ago.
          settings: {
            ...payload.settings,
            toursDone: Array.from(
              new Set([...payload.settings.toursDone, ...s.settings.toursDone]),
            ).slice(0, 50),
            dismissedHints: Array.from(
              new Set([...payload.settings.dismissedHints, ...s.settings.dismissedHints]),
            ).slice(0, 50),
          },
        })),
```

- [ ] **Step 4: Run tests + full mascot suite**

Run: `npx vitest run tests/unit/assistant-mascot/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/assistant/mascot/state.ts tests/unit/assistant-mascot/state-toursdone-merge.test.ts
git commit -m "fix(mascot): union-merge toursDone/dismissedHints в setContext — гонка клоббера устранена"
```

---

## Блок B — Данные и API сессий калькулятора

### Task 5: Миграция 043 — таблица gri_calc_sessions

**Files:**
- Create: `supabase/migrations/043_gri_calc_sessions.sql`

- [ ] **Step 1: Написать миграцию** (шаблон RLS — 027/042; только snake_case; идемпотентно)

```sql
-- 043_gri_calc_sessions.sql
-- Сессии GRI-калькулятора: кросс-девайс история «Сохранить сессию» /
-- «Сравнить с прошлым» (раньше — только localStorage['gri_history']).
-- Применение: node scripts/apply-migration.js supabase/migrations/043_gri_calc_sessions.sql

CREATE TABLE IF NOT EXISTS public.gri_calc_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  scores JSONB NOT NULL,
  gri_index NUMERIC(4,2) NOT NULL,
  niche TEXT NOT NULL DEFAULT 'general',
  size TEXT NOT NULL DEFAULT 'small',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gri_calc_sessions_user_created
  ON public.gri_calc_sessions (user_id, created_at DESC);

ALTER TABLE public.gri_calc_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gri_calc_sessions_select_own ON public.gri_calc_sessions;
CREATE POLICY gri_calc_sessions_select_own ON public.gri_calc_sessions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS gri_calc_sessions_insert_own ON public.gri_calc_sessions;
CREATE POLICY gri_calc_sessions_insert_own ON public.gri_calc_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS gri_calc_sessions_delete_own ON public.gri_calc_sessions;
CREATE POLICY gri_calc_sessions_delete_own ON public.gri_calc_sessions
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS gri_calc_sessions_select_admin ON public.gri_calc_sessions;
CREATE POLICY gri_calc_sessions_select_admin ON public.gri_calc_sessions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('super_admin', 'admin', 'manager', 'analyst')
    )
  );

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Применить локально**

Run: `node scripts/apply-migration.js supabase/migrations/043_gri_calc_sessions.sql`
Expected: успех без ошибок. (На prod накатить отдельно — отметить в PR-описании!)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/043_gri_calc_sessions.sql
git commit -m "feat(gri): миграция 043 — таблица gri_calc_sessions (RLS own + staff-read)"
```

### Task 6: API /api/v1/gri/calc-sessions

**Files:**
- Create: `lib/gri-calculator/calc-session-validate.ts`
- Create: `app/api/v1/gri/calc-sessions/route.ts`
- Create: `app/api/v1/gri/calc-sessions/[id]/route.ts`
- Test: `tests/unit/api/gri-calc-session-validate.test.ts`

- [ ] **Step 1: Write the failing test (валидатор — чистая функция)**

```ts
// tests/unit/api/gri-calc-session-validate.test.ts
import { describe, it, expect } from 'vitest'
import { validateCalcSession } from '@/lib/gri-calculator/calc-session-validate'
import { DEFAULT_SCORES } from '@/lib/gri-calculator/gri-data'

const validScores = Object.fromEntries(Object.keys(DEFAULT_SCORES).map((k) => [k, 7]))

describe('validateCalcSession', () => {
  it('accepts a valid body and computes gri_index as the rounded mean', () => {
    const r = validateCalcSession({ name: 'Тест', scores: validScores })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.gri_index).toBe(7)
  })

  it('rejects missing categories', () => {
    const bad = { ...validScores }
    delete (bad as Record<string, number>)[Object.keys(validScores)[0]]
    expect(validateCalcSession({ scores: bad }).ok).toBe(false)
  })

  it('rejects out-of-range and non-numeric values', () => {
    expect(validateCalcSession({ scores: { ...validScores, [Object.keys(validScores)[0]]: 11 } }).ok).toBe(false)
    expect(validateCalcSession({ scores: { ...validScores, [Object.keys(validScores)[0]]: 'x' } }).ok).toBe(false)
  })

  it('trims and caps name at 80 chars, note at 500', () => {
    const r = validateCalcSession({ name: ' a '.padEnd(200, 'b'), scores: validScores, note: 'n'.repeat(600) })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.name.length).toBeLessThanOrEqual(80)
      expect((r.value.note ?? '').length).toBeLessThanOrEqual(500)
    }
  })
})
```

- [ ] **Step 2: Run to verify FAIL**, потом **Step 3: Implementation**

```ts
// lib/gri-calculator/calc-session-validate.ts
import { DEFAULT_SCORES } from '@/lib/gri-calculator/gri-data'

const CATEGORY_KEYS = Object.keys(DEFAULT_SCORES)

export interface CalcSessionInput {
  name: string
  scores: Record<string, number>
  gri_index: number
  niche: string
  size: string
  note: string | null
}

export type ValidateResult =
  | { ok: true; value: CalcSessionInput }
  | { ok: false; error: string }

export function validateCalcSession(body: unknown): ValidateResult {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid body' }
  const b = body as Record<string, unknown>
  const rawScores = b.scores
  if (!rawScores || typeof rawScores !== 'object') return { ok: false, error: 'scores required' }
  const scores: Record<string, number> = {}
  for (const key of CATEGORY_KEYS) {
    const v = (rawScores as Record<string, unknown>)[key]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 1 || v > 10) {
      return { ok: false, error: `score "${key}" must be a number 1..10` }
    }
    scores[key] = v
  }
  const mean = CATEGORY_KEYS.reduce((s, k) => s + scores[k], 0) / CATEGORY_KEYS.length
  const name = String(b.name ?? '').trim().slice(0, 80)
  const note = b.note == null ? null : String(b.note).trim().slice(0, 500) || null
  const niche = String(b.niche ?? 'general').slice(0, 40)
  const size = String(b.size ?? 'small').slice(0, 40)
  return {
    ok: true,
    value: { name, scores, gri_index: Math.round(mean * 100) / 100, niche, size, note },
  }
}
```

- [ ] **Step 4: Run tests** → PASS. **Step 5: Роуты** (паттерн — app/api/v1/gri/pulse/route.ts)

```ts
// app/api/v1/gri/calc-sessions/route.ts
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { validateCalcSession } from '@/lib/gri-calculator/calc-session-validate'

// GET → { ok, data: { sessions: [...last 20 desc] } }
export async function GET() {
  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const { data, error } = await sb
    .from('gri_calc_sessions')
    .select('*')
    .eq('user_id', userData.user.id)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) {
    return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, data: { sessions: data ?? [] } })
}

// POST {name?, scores, niche?, size?, note?} → { ok, data: { session } }
export async function POST(request: NextRequest) {
  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }
  const parsed = validateCalcSession(body)
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })
  }
  const { data, error } = await sb
    .from('gri_calc_sessions')
    .insert({ user_id: userData.user.id, ...parsed.value })
    .select('*')
    .single()
  if (error || !data) {
    return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, data: { session: data } })
}
```

```ts
// app/api/v1/gri/calc-sessions/[id]/route.ts
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const sb = createServerClient()
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const { data, error } = await sb
    .from('gri_calc_sessions')
    .delete()
    .eq('id', params.id)
    .eq('user_id', userData.user.id)
    .select('id')
  if (error) return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
  if (!data || data.length === 0) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, data: { deleted: params.id } })
}
```

- [ ] **Step 6: Линт + smoke** — `npm run lint`; в превью `curl -s localhost:3000/api/v1/gri/calc-sessions` → 401 (без сессии — норм).

- [ ] **Step 7: Commit**

```bash
git add lib/gri-calculator/calc-session-validate.ts app/api/v1/gri/calc-sessions tests/unit/api/gri-calc-session-validate.test.ts
git commit -m "feat(gri): API v1/gri/calc-sessions — серверные сессии калькулятора (GET/POST/DELETE)"
```

---

## Блок C — Ремейк /gri

Целевая структура файлов:

```
app/(dashboard)/gri/page.tsx            — серверная обёртка (metadata) → GriPageShell
components/gri/page/GriPageShell.tsx    — клиентский контейнер: hero + вкладки + shared scores
components/gri/page/GriHero.tsx         — презентационный hero (индекс, цель, статус, CTA)
components/gri/page/GriResultPanel.tsx  — вкладка «Результат» (данные gri_assessments)
components/gri/page/GriDynamicsPanel.tsx— вкладка «Динамика» (история + сессии + пульс)
components/gri/calculator/FinancialAnalyst.tsx — извлечённый «Финансовый аналитик»
components/gri/calculator/GrowthStrategy.tsx   — извлечённая «Стратегия роста»
components/gri/calculator/GRICalculator.tsx    — остаётся: слайдеры/радар/планирование/сессии
```

### Task 7: GriHero (презентационный)

**Files:**
- Create: `components/gri/page/GriHero.tsx`
- Test: `tests/unit/components/gri-hero.test.tsx` (если в tests/unit/components уже есть паттерн рендер-тестов — повторить; иначе ограничиться типовой проверкой чистых хелперов статуса)

- [ ] **Step 1: Компонент**

```tsx
'use client'

// components/gri/page/GriHero.tsx — шапка страницы GRI: текущий индекс, цель,
// статус готовности и контекстный CTA. Чисто презентационный.
import { motion } from 'framer-motion'

export interface GriHeroProps {
  griIndex: number | null       // null — диагностика ещё не пройдена
  target?: number               // цель, по умолчанию 8.5
  assessedAt?: string | null    // ISO-дата последней диагностики
  onStartAssessment: () => void // CTA «Пройти тест» / «Обновить оценку»
}

export function heroStatus(gri: number | null): { label: string; tone: 'ok' | 'warn' | 'bad' | 'none' } {
  if (gri == null) return { label: 'Диагностика не пройдена', tone: 'none' }
  if (gri >= 8) return { label: 'Высокая готовность', tone: 'ok' }
  if (gri >= 6) return { label: 'Средняя готовность', tone: 'warn' }
  return { label: 'Низкая готовность', tone: 'bad' }
}

const TONE_CLASS: Record<string, string> = {
  ok: 'text-primary border-primary/30 bg-primary/10',
  warn: 'text-amber-300 border-amber-400/30 bg-amber-400/10',
  bad: 'text-red-400 border-red-400/30 bg-red-400/10',
  none: 'text-on-surface-variant border-white/10 bg-white/[0.04]',
}

export default function GriHero({ griIndex, target = 8.5, assessedAt, onStartAssessment }: GriHeroProps) {
  const status = heroStatus(griIndex)
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8"
    >
      <div className="flex items-end gap-3">
        <span className="text-5xl font-bold text-primary tabular-nums">
          {griIndex == null ? '—' : griIndex.toFixed(1)}
        </span>
        <span className="text-sm text-on-surface-variant pb-1.5">/ цель {target}+</span>
      </div>
      <div className="flex-1 min-w-0">
        <span className={`inline-block px-2.5 py-1 rounded-full border text-xs font-medium ${TONE_CLASS[status.tone]}`}>
          {status.label}
        </span>
        {assessedAt && (
          <p className="text-xs text-on-surface-variant mt-1.5">
            Последняя диагностика: {new Date(assessedAt).toLocaleDateString('ru-RU')}
          </p>
        )}
      </div>
      <button
        onClick={onStartAssessment}
        className="shrink-0 px-4 py-2.5 rounded-xl bg-primary text-[#003824] text-sm font-semibold hover:bg-primary/90 transition-colors"
      >
        {griIndex == null ? 'Пройти диагностику' : 'Обновить оценку'}
      </button>
    </motion.section>
  )
}
```

- [ ] **Step 2: Тест хелпера**

```tsx
// tests/unit/components/gri-hero.test.tsx
import { describe, it, expect } from 'vitest'
import { heroStatus } from '@/components/gri/page/GriHero'

describe('heroStatus', () => {
  it('maps GRI to readiness tone', () => {
    expect(heroStatus(null).tone).toBe('none')
    expect(heroStatus(8.2).tone).toBe('ok')
    expect(heroStatus(7).tone).toBe('warn')
    expect(heroStatus(4.9).tone).toBe('bad')
  })
})
```

Run: `npx vitest run tests/unit/components/gri-hero.test.tsx` → PASS

- [ ] **Step 3: Commit** — `git add … && git commit -m "feat(gri): hero-панель страницы GRI"`

### Task 8: GriPageShell — вкладки, shared scores, загрузка assessment

**Files:**
- Create: `components/gri/page/GriPageShell.tsx`
- Modify: `app/(dashboard)/gri/page.tsx`

- [ ] **Step 1: Shell**

```tsx
'use client'

// components/gri/page/GriPageShell.tsx — контейнер страницы /gri:
// hero + вкладки Оценка / Результат / Динамика / AI-аналитик.
// Владеет shared-стейтом оценок (scores/niche/size), чтобы вкладка
// AI-аналитика работала с теми же данными, что и калькулятор.
import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import GriHero from './GriHero'
import { DEFAULT_SCORES } from '@/lib/gri-calculator/gri-data'

const GRICalculator = dynamic(() => import('@/components/gri/calculator/GRICalculator'), {
  loading: () => <div className="animate-pulse h-[400px] bg-white/[0.03] rounded-2xl" />,
})
const GRIAssessment = dynamic(() => import('@/components/gri/assessment/GRIAssessment'), {
  loading: () => <div className="animate-pulse h-[400px] bg-white/[0.03] rounded-2xl" />,
})
const GriResultPanel = dynamic(() => import('./GriResultPanel'))
const GriDynamicsPanel = dynamic(() => import('./GriDynamicsPanel'))
const FinancialAnalyst = dynamic(() => import('@/components/gri/calculator/FinancialAnalyst'))
const GrowthStrategy = dynamic(() => import('@/components/gri/calculator/GrowthStrategy'))

const TABS = [
  { key: 'assess', label: 'Оценка', icon: 'tune' },
  { key: 'result', label: 'Результат', icon: 'insights' },
  { key: 'dynamics', label: 'Динамика', icon: 'monitoring' },
  { key: 'ai', label: 'AI-аналитик', icon: 'auto_awesome' },
] as const

type TabKey = (typeof TABS)[number]['key']

export interface AssessmentCurrent {
  gri_index: number
  section_avgs: Record<string, number>
  top_5_limits: unknown[]
  action_plan_90d: unknown[]
  created_at: string
}

export default function GriPageShell() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const rawTab = searchParams.get('tab') as TabKey | null
  const tab: TabKey = TABS.some((t) => t.key === rawTab) ? (rawTab as TabKey) : 'assess'

  const [scores, setScores] = useState<Record<string, number>>(DEFAULT_SCORES)
  const [niche, setNiche] = useState('general')
  const [size, setSize] = useState('small')
  const [assessment, setAssessment] = useState<AssessmentCurrent | null>(null)

  const setTab = useCallback(
    (key: TabKey) => router.replace(`/gri?tab=${key}`, { scroll: false }),
    [router],
  )

  const loadAssessment = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/gri/assessment', { credentials: 'include' })
      if (!res.ok) return
      const json = await res.json()
      const cur = json?.data?.assessment ?? json?.assessment ?? json?.data ?? null
      if (cur && typeof cur.gri_index !== 'undefined') setAssessment(cur as AssessmentCurrent)
    } catch {
      /* оффлайн/аноним — hero покажет «диагностика не пройдена» */
    }
  }, [])

  useEffect(() => {
    void loadAssessment()
    const onUpdate = () => void loadAssessment()
    window.addEventListener('gri:assessment-updated', onUpdate)
    return () => window.removeEventListener('gri:assessment-updated', onUpdate)
  }, [loadAssessment])

  return (
    <div className="px-4 py-4 space-y-5 max-w-6xl mx-auto">
      <GriHero
        griIndex={assessment ? Number(assessment.gri_index) : null}
        assessedAt={assessment?.created_at ?? null}
        onStartAssessment={() => {
          setTab('assess')
          // Прокрутка к точной диагностике — секция ниже калькулятора.
          setTimeout(() => document.getElementById('gri-assessment')?.scrollIntoView({ behavior: 'smooth' }), 60)
        }}
      />

      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-white/[0.08] bg-white/[0.02] p-1" role="tablist" aria-label="Разделы GRI">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm whitespace-nowrap transition-colors ${
              tab === t.key
                ? 'bg-primary/15 text-primary font-semibold'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-white/[0.05]'
            }`}
          >
            <span className="material-symbols-outlined text-base" aria-hidden>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'assess' && (
        <div className="space-y-6">
          <GRICalculator
            scores={scores}
            onScoresChange={setScores}
            niche={niche}
            size={size}
            onNicheChange={setNiche}
            onSizeChange={setSize}
          />
          <div id="gri-assessment">
            <GRIAssessment />
          </div>
        </div>
      )}
      {tab === 'result' && <GriResultPanel assessment={assessment} onGoAssess={() => setTab('assess')} />}
      {tab === 'dynamics' && <GriDynamicsPanel />}
      {tab === 'ai' && (
        <div className="space-y-6">
          <FinancialAnalyst scores={scores} onApplyScores={setScores} />
          <GrowthStrategy scores={scores} niche={niche} size={size} />
        </div>
      )}
    </div>
  )
}
```

ПРИМЕЧАНИЕ: форму ответа GET /api/v1/gri/assessment сверить с реальным роутом (`app/api/v1/gri/assessment/route.ts`) и поправить распаковку `cur` под фактический конверт — прежде чем коммитить.

- [ ] **Step 2: page.tsx**

```tsx
// app/(dashboard)/gri/page.tsx
import type { Metadata } from 'next'
import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { OnboardingStatusBadges } from '@/components/dashboard/OnboardingStatusBadges'
import { ShareButtonAuto } from '@/components/share/ShareButtonAuto'

export const metadata: Metadata = { title: 'GRI — Growth Readiness Index' }

const GriPageShell = dynamic(() => import('@/components/gri/page/GriPageShell'), {
  loading: () => <div className="animate-pulse h-[600px] bg-white/[0.03] rounded-2xl m-4" />,
})

export default function GriPage() {
  return (
    <>
      <div className="flex items-center justify-end gap-2 px-4 pt-4">
        <ShareButtonAuto type="gri" />
        <OnboardingStatusBadges />
      </div>
      <Suspense fallback={null}>
        <GriPageShell />
      </Suspense>
    </>
  )
}
```

(`useSearchParams` требует Suspense-границу.)

Этот таск компилируется только вместе с Task 9-10-11 (props калькулятора и новые панели). Выполнять Task 8-11 в одной рабочей сессии, коммит — после того как соберётся всё вместе (см. Task 11 Step 5).

### Task 9: GRICalculator — контролируемые props + вырезание AI-блоков

**Files:**
- Modify: `components/gri/calculator/GRICalculator.tsx`

- [ ] **Step 1: Props вместо локального стейта**

```tsx
export interface GRICalculatorProps {
  scores: Record<string, number>
  onScoresChange: (next: Record<string, number>) => void
  niche: string
  size: string
  onNicheChange: (v: string) => void
  onSizeChange: (v: string) => void
}

export default function GRICalculator({
  scores, onScoresChange, niche, size, onNicheChange, onSizeChange,
}: GRICalculatorProps) {
```

Удалить `useState` строк 203 (`scores`), 242-243 (`selectedNiche/selectedSize`); все `setScores(...)` → `onScoresChange(...)`, `selectedNiche/selectedSize` → `niche/size`, их сеттеры → `onNicheChange/onSizeChange`. Внутренние состояния планирования (baseScores/plannedScores, строки 206-208) остаются. Синхронизация из assessment (строки 285-360) продолжает писать через `onScoresChange`.

Честность индекса: слайдеры остаются целочисленными (округление средних секций при синхронизации неизбежно), но у крупной цифры индекса в калькуляторе добавить подпись «по ползункам ≈» когда значения слайдеров разошлись с точным серверным индексом (`slidersMatchBase === false`); точный серверный индекс всегда виден в hero страницы — цифра больше не «прыгает» молча.

- [ ] **Step 2: Вырезать AI-блоки** (переезжают в Task 10/11):
  - «Финансовый аналитик»: JSX строк ~1326-1560 + state строк 226-241, 258-268 (`financialData`, `financialAnalysis`, `financialLoading`, `fileParsing`, `parsingStage`, `dropzoneDragging`, `showMetricChips`, `showPasteMode`) + колбэки `processFileUpload`/`handleFileUpload`/`runParsingStages` (строки 619-697).
  - «Стратегия роста»: JSX кнопки/вывода (~1572+) + state 222-223 + `generateStrategy` (543-565) + debounce-эффект динамических инсайтов (строка ~566) — эффект УДАЛИТЬ совсем (spec: AI только по кнопке; локальные MICRO_INSIGHTS на строке 1201 остаются как есть).
  - Тумблер «Динамические инсайты» (state 246) теперь управляет только показом micro-insight подписей у слайдеров — LLM-вызовов при движении быть не должно.
  - Функцию `renderMarkdown` (строки 171-190) перенести в новый файл `components/gri/calculator/markdown.ts` с `export function renderMarkdown` и импортировать оттуда здесь и в GrowthStrategy.

- [ ] **Step 3: Сессии → сервер** (замена localStorage-логики):

`saveSession` (строка 502) заменить на:

```tsx
  const saveSession = useCallback(async () => {
    const payload = {
      name: sessionName.trim() || `Сессия ${new Date().toLocaleDateString('ru-RU')}`,
      scores: activeScores,
      niche,
      size,
    }
    try {
      const res = await fetch('/api/v1/gri/calc-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(String(res.status))
      toast.success('Сессия сохранена')
      setSaveDialogOpen(false)
      setSessionName('')
    } catch {
      toast.error('Не удалось сохранить на сервере — сохранено локально')
      // прежний localStorage-путь остаётся фолбэком (существующий код)
    }
  }, [sessionName, activeScores, niche, size])
```

(`toast` — sonner, как в остальном проекте; сверить фактический импорт в файле.) Загрузку истории (`griHistory`, эффект строки 270+) заменить на GET `/api/v1/gri/calc-sessions` с фолбэком на localStorage при ошибке; диалог истории получает кнопку удаления → DELETE `/api/v1/gri/calc-sessions/{id}`. «Сравнить с прошлым» (`previousScores`) наполняется из выбранной серверной сессии. Пункт меню «Сохранить профиль» (иконка Database, ключ saveProfileSupabase) — удалить: теперь это одно и то же «Сохранить сессию».

- [ ] **Step 4: Честный PDF** — `handleDownloadPDF` (строка 774) заменить на:

```tsx
  const handleDownloadPDF = useCallback(() => {
    window.open('/api/export/report?type=gri', '_blank', 'noopener')
  }, [])
```

Кнопку «Pitch Deck (PDF)» (txt-блоб) удалить; «Скачать JSON» оставить.

### Task 10: FinancialAnalyst.tsx — извлечение + честное чтение файлов

**Files:**
- Create: `components/gri/calculator/FinancialAnalyst.tsx`
- Modify: `app/api/gri/financial-analyst/route.ts`

- [ ] **Step 1: Роут — принять multipart и реально распарсить файл**

В начало `POST` (перед `await request.json()`, строка ~104) добавить ветку:

```ts
import { parseDocument } from '@/lib/documents/parse'

const MAX_FILE_BYTES = 10 * 1024 * 1024

// внутри POST:
    const contentType = request.headers.get('content-type') ?? ''
    let financialData: string
    let scores: Record<string, number> | undefined
    let lang: string | undefined

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      const file = form.get('file')
      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'Файл не передан' }, { status: 400 })
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: 'Файл больше 10 МБ' }, { status: 413 })
      }
      const buf = Buffer.from(await file.arrayBuffer())
      const parsed = await parseDocument(buf, file.name, file.type || undefined)
      financialData = parsed.text.slice(0, 30_000)
      if (!financialData.trim()) {
        return NextResponse.json({ error: 'Не удалось извлечь текст из файла' }, { status: 422 })
      }
      try { scores = JSON.parse(String(form.get('scores') ?? 'null')) ?? undefined } catch { scores = undefined }
      lang = String(form.get('lang') ?? 'ru')
    } else {
      const body: FinancialAnalystRequest = await request.json()
      financialData = body.financialData
      scores = body.scores
      lang = body.lang
    }
```

Дальше существующая логика использует `financialData/scores/lang` как раньше. Существующую валидацию `financialData` сохранить.

- [ ] **Step 2: Компонент** — новый файл, props:

```tsx
export interface FinancialAnalystProps {
  scores: Record<string, number>
  onApplyScores: (next: Record<string, number>) => void
}
```

Перенести из GRICalculator вырезанные state/JSX (Task 9 Step 2). Изменения при переносе:
- `processFileUpload`: для PDF/XLSX/XLS/CSV — БЕЗ чтения на клиенте и БЕЗ `runParsingStages` (удалить функцию целиком): собрать `FormData` (`file`, `scores` JSON, `lang`) и POST на `/api/gri/financial-analyst`. Стадии прогресса — реальные: `'upload' | 'analyze' | 'done'` (state), переключаются вокруг fetch, никаких setTimeout-стадий.
- Вставка текста вручную (`showPasteMode`) — прежний JSON-путь.
- «Применить к оценкам» — `onApplyScores({ ...scores, ...gri_updates })` + toast с предложением «Сохранить как сессию» (просто текст, без новой логики).
- Тексты — русские; нужные ключи перевода перенести локальной константой в файл.

- [ ] **Step 3: Ручная проверка в превью**: вкладка AI-аналитик → загрузить маленький CSV и маленький PDF → в ответе реальные значения из файла (не имя файла); XLSX аналогично.

### Task 11: GrowthStrategy.tsx + сборка вкладок

**Files:**
- Create: `components/gri/calculator/GrowthStrategy.tsx`
- Create: `components/gri/calculator/markdown.ts`

- [ ] **Step 1: Компонент**

```tsx
export interface GrowthStrategyProps {
  scores: Record<string, number>
  niche: string
  size: string
}
```

Перенести `generateStrategy` (POST /api/gri/ai-strategy с телом как сейчас — сверить контракт по строкам 543-565 исходника), `strategyText/strategyLoading`, вывод через `renderMarkdown` из `./markdown`. Кнопка «Сгенерировать стратегию роста» — единственный триггер LLM.

- [ ] **Step 2: Собрать всё и добиться компиляции**

Run: `npx tsc --noEmit` и `npm run lint`
Expected: 0 ошибок по components/gri/** и app/(dashboard)/gri/**

- [ ] **Step 3: Верификация в превью** (все 4 вкладки открываются; слайдеры двигаются; AI-вкладка видит те же оценки; `?tab=result` шарится по URL)

- [ ] **Step 4: Прогнать существующие тесты** — `npx vitest run` → без новых падений (сравнить с main: известные env-падения не в счёт, см. память проекта).

- [ ] **Step 5: Commit (Tasks 8-11 вместе)**

```bash
git add app/\(dashboard\)/gri components/gri app/api/gri/financial-analyst
git commit -m "feat(gri): вкладочный ремейк /gri — shell+hero, контролируемый калькулятор, честный финансовый аналитик, серверные сессии, настоящий PDF"
```

### Task 12: GriResultPanel — вкладка «Результат»

**Files:**
- Create: `components/gri/page/GriResultPanel.tsx`

- [ ] **Step 1: Компонент**

```tsx
'use client'

// Вкладка «Результат»: серверный итог диагностики из gri_assessments —
// индекс, средние по 7 блокам, TOP-5 ограничений, план 90 дней, CTA разбора.
import { GRI_SECTIONS } from '@/lib/gri-assessment/sections'
import type { AssessmentCurrent } from './GriPageShell'

export default function GriResultPanel({
  assessment,
  onGoAssess,
}: {
  assessment: AssessmentCurrent | null
  onGoAssess: () => void
}) {
  if (!assessment) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-10 text-center space-y-3">
        <p className="text-on-surface font-semibold">Диагностика ещё не пройдена</p>
        <p className="text-sm text-on-surface-variant">
          Пройдите точную диагностику из 7 блоков — здесь появятся ваш индекс,
          главные ограничения и план на 90 дней.
        </p>
        <button
          onClick={onGoAssess}
          className="px-4 py-2.5 rounded-xl bg-primary text-[#003824] text-sm font-semibold"
        >
          Пройти диагностику
        </button>
      </div>
    )
  }

  const avgs = assessment.section_avgs ?? {}

  return (
    <div className="space-y-6">
      <section className="grid sm:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
          <p className="text-xs font-mono uppercase tracking-widest text-on-surface-variant">Средние по блокам</p>
          <ul className="mt-3 space-y-2">
            {GRI_SECTIONS.map((s) => {
              const v = Number(avgs[s.id] ?? 0)
              const tone = v >= 8 ? 'bg-primary' : v >= 6 ? 'bg-amber-400' : 'bg-red-400'
              return (
                <li key={s.id} className="flex items-center gap-3">
                  <span className="flex-1 text-sm text-on-surface truncate">{s.shortTitle ?? s.id}</span>
                  <span className="w-28 h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                    <span className={`block h-full ${tone}`} style={{ width: `${(v / 10) * 100}%` }} />
                  </span>
                  <span className="w-8 text-right text-sm tabular-nums text-on-surface">{v.toFixed(1)}</span>
                </li>
              )
            })}
          </ul>
        </div>
        <TopLimits limits={assessment.top_5_limits} />
      </section>
      <ActionPlan plan={assessment.action_plan_90d} />
      <section className="rounded-2xl border border-primary/25 bg-gradient-to-r from-primary/[0.08] to-transparent p-6 text-center space-y-2">
        <p className="font-bold text-on-surface">Получите план действий на 90 дней с экспертом</p>
        <a
          href="https://tidycal.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block px-5 py-2.5 rounded-xl bg-primary text-[#003824] text-sm font-semibold"
        >
          📅 Забронировать разбор
        </a>
      </section>
    </div>
  )
}
```

`TopLimits` и `ActionPlan` — локальные под-компоненты в этом же файле: перед реализацией открой `lib/gri-calculator/top5-action-plan.ts` и возьми РЕАЛЬНЫЕ типы элементов `top_5_limits` / `action_plan_90d` (названия полей!), отрисуй по образцу существующего блока результатов в `components/gri/assessment/GRIAssessment.tsx` (нумерованные карточки TOP-5 с бейджем score, план — по неделям/шагам). Ссылку CTA взять ту же, что в GRIAssessment results (tidycal, точный URL — из существующего кода, НЕ выдумывать).

- [ ] **Step 2: Верификация в превью** (пользователь с диагностикой видит блоки; без диагностики — empty-state с CTA)

- [ ] **Step 3: Commit** — `git commit -m "feat(gri): вкладка «Результат» — серверный итог диагностики"`

### Task 13: GriDynamicsPanel — вкладка «Динамика»

**Files:**
- Create: `components/gri/page/GriDynamicsPanel.tsx`

- [ ] **Step 1: Компонент** (полный код):

```tsx
'use client'

// Вкладка «Динамика»: тренд GRI по диагностикам + сессии калькулятора +
// недельный пульс. Дельты «текущая vs предыдущая диагностика» по блокам.
import { useEffect, useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'
import { GRI_SECTIONS } from '@/lib/gri-assessment/sections'

interface HistoryRow { gri_index: number; section_avgs: Record<string, number>; created_at: string }
interface CalcSession { id: string; name: string; gri_index: number; created_at: string }
interface PulseRow { week_start: string; pulse_index: number }

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })

export default function GriDynamicsPanel() {
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [sessions, setSessions] = useState<CalcSession[]>([])
  const [pulse, setPulse] = useState<PulseRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    Promise.allSettled([
      fetch('/api/v1/gri/assessment?history=1', { credentials: 'include' }).then((r) => r.json()),
      fetch('/api/v1/gri/calc-sessions', { credentials: 'include' }).then((r) => r.json()),
      fetch('/api/v1/gri/pulse', { credentials: 'include' }).then((r) => r.json()),
    ]).then(([h, s, p]) => {
      if (!alive) return
      if (h.status === 'fulfilled') {
        const rows = h.value?.data?.history ?? h.value?.history ?? []
        setHistory(Array.isArray(rows) ? rows : [])
      }
      if (s.status === 'fulfilled') setSessions(s.value?.data?.sessions ?? [])
      if (p.status === 'fulfilled') setPulse(p.value?.data?.history ?? p.value?.history ?? [])
      setLoading(false)
    })
    return () => { alive = false }
  }, [])

  const chartData = useMemo(() => {
    const points: { date: string; ts: number; diagnostic?: number; pulse?: number }[] = []
    for (const h of history) points.push({ date: fmtDate(h.created_at), ts: +new Date(h.created_at), diagnostic: Number(h.gri_index) })
    for (const p of pulse) points.push({ date: fmtDate(p.week_start), ts: +new Date(p.week_start), pulse: Number(p.pulse_index) })
    return points.sort((a, b) => a.ts - b.ts)
  }, [history, pulse])

  const deltas = useMemo(() => {
    if (history.length < 2) return null
    const sorted = [...history].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
    const [cur, prev] = sorted
    return GRI_SECTIONS.map((s) => ({
      id: s.id,
      title: s.shortTitle ?? s.id,
      delta: Number(cur.section_avgs?.[s.id] ?? 0) - Number(prev.section_avgs?.[s.id] ?? 0),
    }))
  }, [history])

  if (loading) return <div className="animate-pulse h-[360px] bg-white/[0.03] rounded-2xl" />

  if (chartData.length === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-10 text-center">
        <p className="text-on-surface font-semibold">Пока нет замеров</p>
        <p className="text-sm text-on-surface-variant mt-1.5">
          Пройдите диагностику или снимите «Пульс недели» — динамика появится здесь.
        </p>
      </div>
    )
  }

  return (
    <div className="grid lg:grid-cols-[2fr,1fr] gap-4">
      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
        <p className="text-xs font-mono uppercase tracking-widest text-on-surface-variant mb-4">Тренд GRI</p>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} />
            <YAxis domain={[0, 10]} tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} width={26} />
            <Tooltip contentStyle={{ background: '#12151c', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12 }} />
            <Legend />
            <Line type="monotone" dataKey="diagnostic" name="Диагностика" stroke="#6effc0" strokeWidth={2} connectNulls dot={{ r: 3 }} />
            <Line type="monotone" dataKey="pulse" name="Пульс недели" stroke="#7aa2ff" strokeWidth={1.5} strokeDasharray="4 3" connectNulls dot={{ r: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </section>
      <div className="space-y-4">
        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
          <p className="text-xs font-mono uppercase tracking-widest text-on-surface-variant mb-3">Дельта к прошлой диагностике</p>
          {deltas ? (
            <ul className="space-y-1.5">
              {deltas.map((d) => (
                <li key={d.id} className="flex items-center justify-between text-sm">
                  <span className="text-on-surface-variant truncate">{d.title}</span>
                  <span className={`tabular-nums font-medium ${d.delta > 0 ? 'text-primary' : d.delta < 0 ? 'text-red-400' : 'text-on-surface-variant'}`}>
                    {d.delta > 0 ? '▲' : d.delta < 0 ? '▼' : '•'} {Math.abs(d.delta).toFixed(1)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-on-surface-variant">Нужны минимум две диагностики.</p>
          )}
        </section>
        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
          <p className="text-xs font-mono uppercase tracking-widest text-on-surface-variant mb-3">Сессии калькулятора</p>
          {sessions.length === 0 ? (
            <p className="text-sm text-on-surface-variant">Сохранённых сессий нет.</p>
          ) : (
            <ul className="space-y-1.5">
              {sessions.slice(0, 8).map((s) => (
                <li key={s.id} className="flex items-center justify-between text-sm">
                  <span className="text-on-surface truncate">{s.name || 'Без названия'}</span>
                  <span className="text-on-surface-variant tabular-nums">{Number(s.gri_index).toFixed(1)} · {fmtDate(s.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
```

Форму ответов (`data.history` vs `history`) сверить с реальными роутами перед коммитом.

- [ ] **Step 2: Превью-верификация** (график рисуется, пустое состояние корректно)
- [ ] **Step 3: Commit** — `git commit -m "feat(gri): вкладка «Динамика» — тренд диагностик, пульса и сессий"`

### Task 14: Мёртвый код + мобильная адаптация + финальная верификация

**Files:**
- Modify: `app/api/clients/[id]/gri/calculate/route.ts`
- Delete: `app/(dashboard)/gri/GriPulsePage.module.css`

- [ ] **Step 1: Legacy-эндпоинт честно отвечает 410**

Тело POST заменить на:

```ts
export async function POST() {
  return NextResponse.json(
    { ok: false, error: 'Этот способ расчёта GRI отключён. Используйте /api/v1/gri/assessment.' },
    { status: 410 },
  )
}
```

(импорты почистить; Inngest-события больше не ставятся).

- [ ] **Step 2: Удалить мёртвый CSS** — `git rm app/\(dashboard\)/gri/GriPulsePage.module.css`

- [ ] **Step 3: Мобильный проход** — preview_resize mobile (375×812): вкладки скроллятся, hero складывается в колонку, слайдеры калькулятора нажимаются пальцем (проверить существующие классы), радар не вылезает; исправить найденное.

- [ ] **Step 4: Полный прогон**

Run: `npx vitest run && npm run lint`
Expected: без новых падений относительно main (env-падения из памяти проекта — не в счёт)

- [ ] **Step 5: Верификация фичи целиком** (skill verify): в превью пройти путь — двигаю слайдеры → сохраняю сессию → вижу её в «Динамике» → скачиваю PDF (реальный файл) → загружаю CSV в AI-аналитике → применяю к оценкам → тур на /gri открывается через меню Гри и не выходит за экран → после «Готово» и перезагрузки не повторяется.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(gri): фаза 1 завершена — мёртвые пути удалены, мобильная адаптация, верификация"
```

---

## Definition of Done (Фаза 1)

- [ ] Тур: карточка всегда в пределах вьюпорта (desktop + mobile); «Готово»/«Пропустить» переживают перезагрузку и смену устройства.
- [ ] /gri: 4 вкладки, hero с реальным индексом; сессии сохраняются на сервер и видны в «Динамике»; PDF — настоящий; загрузка PDF/XLSX реально анализируется; LLM не вызывается при движении ползунков.
- [ ] `npx vitest run && npm run lint` чисты (относительно main).
- [ ] Миграция 043 применена локально; в PR отмечено «накатить на prod».
