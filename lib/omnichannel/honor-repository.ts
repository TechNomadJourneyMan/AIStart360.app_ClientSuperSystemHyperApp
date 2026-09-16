import { createServiceClient } from "@/lib/supabase-service";
import {
  shouldUseOmnichannelPostgres,
  omnichannelPostgresPool,
} from "./postgres-runtime";
import type { HonorConfig } from "./honor-policy";
/** Proof survives manual finalization, which replaces ai_reason. */
export async function recordHonorCatalogVerification(
  messageId: string,
  config: HonorConfig,
): Promise<void> {
  if (shouldUseOmnichannelPostgres()) {
    await omnichannelPostgresPool().query(
      "SELECT public.honor_mark_catalog_verified($1::uuid,$2::jsonb)",
      [messageId, JSON.stringify(config)],
    );
  } else {
    const r = await createServiceClient().rpc("honor_mark_catalog_verified", {
      p_message_id: messageId,
      p_config: config,
    });
    if (r.error) throw new Error("honor_catalog_proof_not_saved");
  }
}
