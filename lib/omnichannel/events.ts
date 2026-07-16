export const OMNICHANNEL_MESSAGE_RECEIVED_EVENT =
  "omnichannel/message.received" as const;
export const OMNICHANNEL_BACKFILL_REQUESTED_EVENT =
  "omnichannel/backfill.requested" as const;

export interface OmnichannelMessageReceivedEventData {
  message_id: string;
  conversation_id: string;
  /** Historical imports are always analysed as drafts and are never sent. */
  force_draft?: boolean;
  /** Internal hint: a durable queue/timer already covered the reply delay. */
  delay_already_applied?: boolean;
  /**
   * Internal execution fence. Durable runtimes supply a value unique to the
   * concrete run/lease so two recoveries of one provider message cannot both
   * cross the final database send claim.
   */
  processing_owner?: string;
}

export interface OmnichannelBackfillRequestedEventData {
  channel: "instagram" | "whatsapp";
  requested_by: string;
  requested_at: string;
  batch?: number;
}
