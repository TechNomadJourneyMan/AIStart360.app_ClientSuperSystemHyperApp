-- =============================================================================
-- Migration 002: Fix handle_new_user trigger
-- Problem: trigger always set status = 'pending_approval' regardless of role.
--          owner/admin/expert should be 'approved' immediately.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role   TEXT;
  v_status TEXT;
BEGIN
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'client');

  -- clients always require approval; other roles are auto-approved
  IF v_role = 'client' THEN
    v_status := 'pending_approval';
  ELSE
    v_status := COALESCE(NEW.raw_user_meta_data->>'status', 'approved');
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    v_role,
    v_status
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;
