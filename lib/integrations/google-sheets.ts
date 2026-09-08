/**
 * lib/integrations/google-sheets.ts — mirror survey answers into a Google Sheet
 * through a Google Apps Script web app (no Sheets API, no service account).
 *
 * The sheet owner pastes scripts/google-apps-script/survey-sheet.gs into the
 * spreadsheet's Apps Script editor, deploys it as a Web App («Anyone» access)
 * and copies the /exec URL here. The portal POSTs JSON; the script writes the
 * header row and upserts the row whose column A equals `values[0]` (user_id).
 *
 * Env:
 *   GOOGLE_APPS_SCRIPT_WEBHOOK_URL  — https://script.google.com/macros/s/…/exec
 *   GOOGLE_APPS_SCRIPT_SECRET       — optional shared secret (Script Properties
 *                                     → WEBHOOK_SECRET on the Apps Script side)
 *   GOOGLE_SHEETS_SURVEY_TAB        — tab name (default «Анкета»)
 *   GOOGLE_SHEETS_SPREADSHEET_ID    — optional, only for building the link shown
 *                                     in notifications before the first sync
 *
 * Delivery is best-effort: every public function resolves, never throws.
 */

const TIMEOUT_MS = 10_000

export interface SheetsConfig {
  webhookUrl: string
  secret: string | null
  tab: string
  spreadsheetId: string | null
}

export function getSheetsConfig(env: NodeJS.ProcessEnv = process.env): SheetsConfig | null {
  const webhookUrl = env.GOOGLE_APPS_SCRIPT_WEBHOOK_URL?.trim()
  if (!webhookUrl || !/^https:\/\/script\.google\.com\/.+\/exec\/?$/.test(webhookUrl)) return null
  return {
    webhookUrl,
    secret: env.GOOGLE_APPS_SCRIPT_SECRET?.trim() || null,
    tab: env.GOOGLE_SHEETS_SURVEY_TAB?.trim() || 'Анкета',
    spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() || null,
  }
}

export function googleSheetsConfigured(): boolean {
  return getSheetsConfig() !== null
}

/** Link to the spreadsheet when the id is known (Apps Script also returns it). */
export function spreadsheetUrl(cfg: Pick<SheetsConfig, 'spreadsheetId'> | null = getSheetsConfig()): string | null {
  return cfg?.spreadsheetId ? `https://docs.google.com/spreadsheets/d/${cfg.spreadsheetId}/edit` : null
}

export interface UpsertRowResult {
  ok: boolean
  action?: 'inserted' | 'updated'
  rowNumber?: number
  url: string | null
  error?: string
}

/** Payload contract shared with scripts/google-apps-script/survey-sheet.gs. */
export interface SheetWebhookPayload {
  secret?: string
  tab: string
  headers: string[]
  values: string[]
}

/**
 * Sends one row to the Apps Script web app. The script writes `headers` to
 * row 1 (when missing or changed) and upserts `values` by column A.
 */
export async function upsertRowByKey(
  headers: string[],
  values: string[],
  cfg: SheetsConfig | null = getSheetsConfig(),
): Promise<UpsertRowResult> {
  if (!cfg) return { ok: false, url: null, error: 'google apps script webhook not configured' }
  if (!values.length) return { ok: false, url: spreadsheetUrl(cfg), error: 'empty row' }

  const payload: SheetWebhookPayload = { tab: cfg.tab, headers, values }
  if (cfg.secret) payload.secret = cfg.secret

  try {
    // Apps Script answers a POST with a 302 to script.googleusercontent.com;
    // fetch follows it and the JSON body arrives from the redirected URL.
    const res = await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight quirks on the Apps Script side
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const text = await res.text()
    let json: { ok?: boolean; action?: 'inserted' | 'updated'; row?: number; url?: string; error?: string } = {}
    try {
      json = JSON.parse(text)
    } catch {
      return { ok: false, url: spreadsheetUrl(cfg), error: `apps script returned non-JSON (${res.status}): ${text.slice(0, 200)}` }
    }
    if (!res.ok || !json.ok) {
      return { ok: false, url: json.url ?? spreadsheetUrl(cfg), error: json.error ?? `apps script HTTP ${res.status}` }
    }
    return { ok: true, action: json.action, rowNumber: json.row, url: json.url ?? spreadsheetUrl(cfg) }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error('[google-sheets] apps script upsert failed:', error)
    return { ok: false, url: spreadsheetUrl(cfg), error }
  }
}
