-- 044_crm_clients.sql — лёгкая CRM владельца (см. Фаза 2 плана).
-- Применение: node scripts/apply-migration.js supabase/migrations/044_crm_clients.sql

CREATE TABLE IF NOT EXISTS public.crm_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,                       -- нормализованный E.164, nullable
  phone_raw TEXT,                   -- как ввёл пользователь
  email TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','in_progress','waiting','customer','sleeping','lost')),
  source TEXT,                      -- 'manual'|'csv'|'mini_gri'|'bitrix24'|'amocrm'|...
  avg_check NUMERIC,                -- средний чек / сумма сделки (для «выручка под риском»)
  note TEXT,
  next_contact_at TIMESTAMPTZ,
  last_contact_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_clients_user_status ON public.crm_clients (user_id, status);
CREATE INDEX IF NOT EXISTS idx_crm_clients_user_next ON public.crm_clients (user_id, next_contact_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_clients_user_phone
  ON public.crm_clients (user_id, phone) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.crm_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.crm_clients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('call','message','meeting','note','status_change')),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_interactions_client ON public.crm_interactions (client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.crm_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.crm_clients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  due_at TIMESTAMPTZ NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_crm_reminders_user_due ON public.crm_reminders (user_id, status, due_at);

-- RLS: own CRUD + staff read — на все три таблицы (шаблон 027/042).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['crm_clients','crm_interactions','crm_reminders'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_sel_own ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_sel_own ON public.%I FOR SELECT USING (auth.uid() = user_id)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_ins_own ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_ins_own ON public.%I FOR INSERT WITH CHECK (auth.uid() = user_id)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_upd_own ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_upd_own ON public.%I FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_del_own ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_del_own ON public.%I FOR DELETE USING (auth.uid() = user_id)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_sel_staff ON public.%I', t, t);
    EXECUTE format($f$CREATE POLICY %I_sel_staff ON public.%I FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('super_admin','admin','manager','analyst')))$f$, t, t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
