'use client'

/**
 * /expert/mcp — MCP tokens of an expert (same API and UI as GIGA «MCP-доступ»;
 * /api/mcp/tokens admits experts through lib/expert-auth.ts).
 */
import { McpTokensPage } from '@/components/giga-panel/mcp/McpTokensPage'

export default function Page() {
  return (
    <div className="rounded-2xl bg-[#070c1f] p-4 md:p-6">
      <McpTokensPage />
    </div>
  )
}
