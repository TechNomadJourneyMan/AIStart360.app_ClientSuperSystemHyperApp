-- 057_action_plan_interactive.sql
-- Make the 90-day plan interactive (A4). Extends public.action_items (030) with
-- completion / snooze / replace / comment / week fields. The existing `status`
-- column ('open'|'in_progress'|'done', no CHECK constraint) is reused and its
-- vocabulary widened to include 'snoozed'|'replaced'|'dropped' — enforced in
-- app code, not a DB constraint, so nothing to alter. Spec: 02 §A4.

alter table public.action_items
  add column if not exists completed_at  timestamptz,
  add column if not exists snoozed_until date,
  add column if not exists replaced_by   uuid references public.action_items(id) on delete set null,
  add column if not exists user_comment  text,
  add column if not exists week_no        integer,     -- 1..13 from the assessment date
  add column if not exists source         text not null default 'plan';
                                                        -- 'plan' | 'bet' | 'user' | 'gri_suggested'

create index if not exists idx_action_items_user_week
  on public.action_items (user_id, week_no);
