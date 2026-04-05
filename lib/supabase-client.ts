import { createClient as createSupabaseClient } from '@/lib/supabase/client'

export function createClient() {
  return createSupabaseClient()
}
