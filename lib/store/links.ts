export function storeHref(path: string, companyId?: string | null): string {
  return companyId ? `${path}?companyId=${encodeURIComponent(companyId)}` : path
}
