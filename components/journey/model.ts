import {
  journeyStateSchema,
  type JourneyFact,
  type JourneyFile,
  type JourneyGoal,
  type JourneyMessage,
  type JourneyPhase,
  type JourneyRoadmapItem,
  type JourneyState,
  type JourneySuggestion,
  type JourneyWidget,
  type JourneyWidgetKind,
} from '@/lib/journey/schema'
import { JOURNEY_WIDGET_KINDS as SERVER_WIDGET_KINDS } from '@/lib/journey/widget-registry'

export type JourneyPhaseView = JourneyPhase
export type ProviderMode = JourneyState['provider']['mode']
export type PersistenceMode = JourneyState['persistence']['mode']
export type FactStatus = JourneyFact['status']

export type JourneyFactView = JourneyFact
export type JourneyGoalView = JourneyGoal
export type JourneyRoadmapView = JourneyRoadmapItem
export type JourneyMessageView = JourneyMessage
export type JourneyFileView = JourneyFile
export type JourneyFileStatus = JourneyFile['status']
export type JourneySuggestionView = JourneySuggestion
export type JourneyWidgetView = JourneyWidget
export type JourneyWorkspaceView = JourneyState
// Browser identity supports two authentication modes:
// - legacy guest workspaces keep a high-entropy access token for backwards
//   compatibility only. It is exposed to page JavaScript, so it must never be
//   used for signed-in or linked-device credentials and still relies on a
//   restrictive CSP/XSS posture;
// - linked devices keep only the non-secret workspace id while the device
//   credential stays in an HttpOnly cookie.
export interface JourneyIdentity {
  workspaceId: string
  accessToken?: string
}
export type { JourneyWidgetKind }

export const JOURNEY_WIDGET_KINDS = SERVER_WIDGET_KINDS

export const LOCAL_STATE_KEY = 'aistart360:journey:state:v1'
export const LOCAL_IDENTITY_KEY = 'aistart360:journey:identity:v1'

export function journeyStateStorageKey(workspaceId: string): string {
  return `${LOCAL_STATE_KEY}:${workspaceId}`
}

export const SUPPORTED_FILE_EXTENSIONS = ['pdf', 'docx', 'csv', 'txt']
export const MAX_FILE_BYTES = 4 * 1024 * 1024

export function createIdentity(): JourneyIdentity {
  const id = safeUuid()
  return { workspaceId: `guest-${id}`, accessToken: `guest-token-${safeUuid()}` }
}

export function createEmptyWorkspace(workspaceId: string): JourneyWorkspaceView {
  const now = new Date().toISOString()

  return {
    version: 1,
    workspaceId,
    phase: 'empty',
    companyName: '',
    businessDescription: '',
    messages: [
      {
        id: `welcome-${workspaceId}`,
        role: 'assistant',
        text: 'Расскажите о компании своими словами. Я буду задавать по одному вопросу, а подтверждённые факты постепенно соберу в Точку A.',
        createdAt: now,
      },
    ],
    facts: [],
    goals: [],
    roadmap: [],
    widgets: [],
    manualWidgetIds: [],
    widgetOrder: [],
    files: [],
    suggestions: [
      {
        id: 'start-company',
        label: 'Начать с компании',
        value: 'Расскажу, чем занимается компания и кому мы продаём.',
        target: 'point-a',
        status: 'active',
      },
      {
        id: 'start-file',
        label: 'Загрузить отчёт',
        value: 'Сначала загружу документ с данными о бизнесе.',
        target: 'chat',
        status: 'active',
      },
    ],
    provider: {
      mode: 'demo',
      label: 'Демо-логика',
    },
    persistence: {
      mode: 'local',
      label: 'Сохранение на устройстве',
      reason: 'Серверная сессия ещё не подтверждена.',
    },
    updatedAt: now,
  }
}

function safeUuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function makeId(prefix: string): string {
  return `${prefix}-${safeUuid()}`
}

export function isWidgetKind(value: unknown): value is JourneyWidgetKind {
  return typeof value === 'string' && (JOURNEY_WIDGET_KINDS as readonly string[]).includes(value)
}

export function isJourneyWorkspaceView(value: unknown): value is JourneyWorkspaceView {
  return journeyStateSchema.safeParse(value).success
}
