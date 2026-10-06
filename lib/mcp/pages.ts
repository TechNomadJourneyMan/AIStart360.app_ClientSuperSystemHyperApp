/**
 * lib/mcp/pages.ts — the minimal HTML answer of the OAuth endpoints for errors
 * that must NOT be redirected to the client (unknown client, unregistered
 * redirect URI, CSRF refusal). Static text only, escaped, no scripts.
 */

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function oauthHtmlPage(title: string, text: string, status: number): Response {
  const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — AIStart360</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#070c1f;color:#e2e8f0;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:16px}
main{max-width:440px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);border-radius:16px;padding:24px}
h1{font-size:18px;margin:0 0 8px}p{margin:0;color:#94a3b8}</style></head>
<body><main><h1>${esc(title)}</h1><p>${esc(text)}</p></main></body></html>`
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      'X-Frame-Options': 'DENY',
    },
  })
}
