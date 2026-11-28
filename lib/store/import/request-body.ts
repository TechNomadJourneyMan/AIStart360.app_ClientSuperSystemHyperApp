export const MAX_STORE_FILE_BYTES = 4 * 1024 * 1024
const MAX_MULTIPART_BYTES = MAX_STORE_FILE_BYTES + 256 * 1024

// Railway has no Vercel request ceiling. Bound the stream before parsing,
// including when a client omits Content-Length or uses chunked transfer.
export async function readStoreImportForm(request: Request): Promise<
  { form: FormData } | { status: 400 | 413 | 415; code: string; message: string }
> {
  const contentType = request.headers.get('content-type')
  if (!contentType || !/^multipart\/form-data\s*;[^\r\n]*boundary=/i.test(contentType)) {
    return { status: 415, code: 'unsupported_media_type', message: 'Ожидается multipart/form-data' }
  }
  const tooLarge = { status: 413 as const, code: 'file_too_large', message: 'Файл больше 4 МБ' }
  if (Number(request.headers.get('content-length')) > MAX_MULTIPART_BYTES) return tooLarge
  const invalid = { status: 400 as const, code: 'invalid_multipart', message: 'Не удалось прочитать форму загрузки' }
  if (!request.body) return invalid

  const reader = request.body.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > MAX_MULTIPART_BYTES) {
        void reader.cancel().catch(() => {})
        return tooLarge
      }
      parts.push(chunk.value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const part of parts) {
      bytes.set(part, offset)
      offset += part.byteLength
    }
    return { form: await new Response(bytes, { headers: { 'content-type': contentType } }).formData() }
  } catch {
    return invalid
  } finally {
    reader.releaseLock()
  }
}
