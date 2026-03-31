import Langfuse from "langfuse";

/**
 * Langfuse client for AI observability.
 * Traces every diagnostic agent call with cost, latency, and client_id.
 *
 * Self-hosted: http://localhost:3002
 * Cloud: https://cloud.langfuse.com
 */
export const langfuse = new Langfuse({
  secretKey: process.env.LANGFUSE_SECRET_KEY ?? "",
  publicKey: process.env.LANGFUSE_PUBLIC_KEY ?? "",
  baseUrl: process.env.LANGFUSE_HOST ?? "https://cloud.langfuse.com",
  flushAt: 1, // flush immediately in serverless
  flushInterval: 0,
});

/**
 * Wrap an async AI call with a Langfuse trace.
 *
 * @example
 * const result = await withTrace({
 *   name: "diagnostic-agent",
 *   userId: clientId,
 *   metadata: { diagnostic_type: "point_a" },
 *   fn: () => runDiagnosticAgent(input),
 * });
 */
export async function withTrace<T>({
  name,
  userId,
  metadata,
  fn,
}: {
  name: string;
  userId?: string;
  metadata?: Record<string, unknown>;
  fn: () => Promise<T>;
}): Promise<T> {
  const trace = langfuse.trace({
    name,
    userId,
    metadata,
  });

  try {
    const result = await fn();
    trace.update({ metadata: { ...metadata, status: "success" } });
    return result;
  } catch (error) {
    trace.update({
      metadata: {
        ...metadata,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  } finally {
    await langfuse.flushAsync();
  }
}
