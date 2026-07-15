-- Recover a WhatsApp Web delivery when a worker dies after claiming its audit
-- row but before enqueueing the durable processing event. Recent claims remain
-- exclusive; stale claims can be retried from the bridge's durable outbox.

CREATE OR REPLACE FUNCTION public.claim_omnichannel_webhook_event(
  p_event_id UUID
)
RETURNS TABLE (claimed BOOLEAN)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH acquired AS (
    UPDATE public.omnichannel_webhook_events
       SET status = 'processing',
           error = NULL,
           processed_at = NULL
     WHERE id = p_event_id
       AND (
         status IN ('received', 'failed')
         OR (
           status = 'processing'
           AND updated_at < now() - interval '2 minutes'
         )
       )
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM acquired) AS claimed;
$$;

REVOKE ALL ON FUNCTION public.claim_omnichannel_webhook_event(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_omnichannel_webhook_event(UUID)
  TO service_role;

COMMENT ON FUNCTION public.claim_omnichannel_webhook_event(UUID) IS
  'Atomically claims received/failed webhook events and reclaims processing events stale for two minutes.';

NOTIFY pgrst, 'reload schema';
