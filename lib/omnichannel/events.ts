export const OMNICHANNEL_MESSAGE_RECEIVED_EVENT =
  "omnichannel/message.received" as const;
export const OMNICHANNEL_BACKFILL_REQUESTED_EVENT =
  "omnichannel/backfill.requested" as const;

export interface OmnichannelMessageReceivedEventData {
  message_id: string;
  conversation_id: string;
  /** Historical imports are always analysed as drafts and are never sent. */
  force_draft?: boolean;
  /** Internal queue hint: run_at already covered the configured reply delay. */
  delay_already_applied?: boolean;
}

export interface OmnichannelBackfillRequestedEventData {
  channel: "instagram" | "whatsapp";
  requested_by: string;
  requested_at: string;
  batch?: number;
}
