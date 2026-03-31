import { createAnthropic } from "@ai-sdk/anthropic";

/**
 * Configured Anthropic/Claude provider for Vercel AI SDK.
 * Uses claude-sonnet-4.5 by default (best cost/quality ratio for diagnostics).
 */
export const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? "",
});

export const CLAUDE_MODELS = {
  /** Fast, cost-efficient — for simple classification & routing */
  haiku: "claude-haiku-3-5" as const,
  /** Balanced — main diagnostic agent model */
  sonnet: "claude-sonnet-4-5" as const,
  /** Highest quality — for final report generation */
  opus: "claude-opus-4" as const,
} as const;

export type ClaudeModel = (typeof CLAUDE_MODELS)[keyof typeof CLAUDE_MODELS];

/** Default model for diagnostic workflows */
export const DEFAULT_MODEL = CLAUDE_MODELS.sonnet;
