/**
 * Manual run of agents in GIGA — pure rules (tests/unit/giga-crm/agents-run-model.test.ts).
 *
 * Diagnostic pipeline stages (lib/diagnostics/pipeline.ts: «Сбор данных»,
 * «Метрики и индекс», …) work only inside a diagnostic session; started on
 * their own they failed with NO_SESSION. They are not run manually: the
 * dialog offers «Запустить диагностику компании» instead — a manual run of the
 * orchestrator, which opens the session and runs every stage in order (the
 * same thing the admin bot's «Запустить диагностику» does).
 */
import { ORCHESTRATOR_KEY, STAGE_LABELS, isDiagnosticStage } from '@/lib/diagnostics/pipeline'

export const DIAGNOSTIC_ORCHESTRATOR_KEY = ORCHESTRATOR_KEY

/** The stage label when `agentKey` is a diagnostic pipeline stage, else null. */
export function pipelineStageLabel(agentKey: string | null | undefined): string | null {
  return isDiagnosticStage(agentKey) ? STAGE_LABELS[agentKey] : null
}

/** Run URL + body that starts a full diagnostic of a company. */
export function diagnosticRunRequest(companyId: string, stageLabel?: string | null): { url: string; body: Record<string, unknown> } {
  return {
    url: `/api/giga-admin/agents/${ORCHESTRATOR_KEY}/run`,
    body: { companyId, input: { reason: stageLabel ? `ручной запуск из GIGA (этап «${stageLabel}»)` : 'ручной запуск из GIGA' } },
  }
}

/** Human explanations of agent error codes (shown next to the code). */
const ERROR_CODE_TEXT: Record<string, string> = {
  NO_SESSION: 'Этап диагностики был запущен отдельно, без диагностики компании. Этапы выполняются только внутри диагностики — запустите диагностику компании целиком.',
  NO_API_KEY: 'Нет доступной модели ИИ: у провайдеров нет рабочего ключа.',
  BUDGET_EXCEEDED: 'Исчерпан дневной бюджет ИИ — задача остановлена.',
  TIMEOUT: 'Модель ИИ не ответила вовремя.',
  RATE_LIMITED: 'Провайдер ИИ временно ограничил частоту запросов.',
}

export function errorCodeText(code: string | null | undefined): string | null {
  return code ? ERROR_CODE_TEXT[code] ?? null : null
}
