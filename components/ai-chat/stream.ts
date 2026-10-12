/** Read the server-sent events of POST /api/v1/ai/assistant. */
export type StreamEvent =
  | { type: 'status'; text: string }
  | { type: 'proposal'; action: { id: string; kind?: string; preview?: { title: string; before: string | null; after: string; note?: string | null } } }
  | { type: 'answer'; text: string }
  | { type: 'error'; text: string }
  | { type: 'done'; conversationId: string | null }

export async function readEvents(res: Response, onEvent: (e: StreamEvent) => void): Promise<void> {
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i)
      buf = buf.slice(i + 2)
      const line = chunk.split('\n').find((l) => l.startsWith('data: '))
      if (!line) continue
      try { onEvent(JSON.parse(line.slice(6)) as StreamEvent) } catch { /* partial / malformed line */ }
    }
  }
}
