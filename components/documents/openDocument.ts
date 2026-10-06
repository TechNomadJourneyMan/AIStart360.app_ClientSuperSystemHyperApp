import { documentDownloadUrl, type ClientDocument } from '@/lib/documents/client-upload'

/**
 * Open the caller's own document in a new tab via a short-lived signed URL.
 * The tab is opened synchronously (inside the click) so popup blockers allow
 * it, then pointed at the link once it is issued. Returns an error message
 * for the UI, or null on success.
 */
export async function openDocumentInNewTab(
  doc: Pick<ClientDocument, 'storage_bucket' | 'storage_path' | 'file_url'>,
): Promise<string | null> {
  const tab = window.open('', '_blank')
  if (tab) tab.opener = null
  const res = await documentDownloadUrl(doc)
  if (!res.ok) {
    tab?.close()
    return res.error
  }
  if (tab) tab.location.href = res.url
  else window.open(res.url, '_blank', 'noopener,noreferrer')
  return null
}
