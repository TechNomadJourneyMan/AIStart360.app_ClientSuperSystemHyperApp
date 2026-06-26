import { createClient, type Session, type User } from '@supabase/supabase-js';
import { useEffect } from 'react';
import { create } from 'zustand';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;

const SUPABASE_URL = env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY ?? '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    '[auth] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set; auth calls will fail at runtime.',
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export async function getAccessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[auth] getSession error', error);
    return null;
  }
  return data.session?.access_token ?? null;
}

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  setSession: (s: Session | null) => void;
  setLoading: (b: boolean) => void;
}

const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  loading: true,
  setSession: (session) => set({ session, user: session?.user ?? null, loading: false }),
  setLoading: (loading) => set({ loading }),
}));

let listenerAttached = false;

function ensureListener(): void {
  if (listenerAttached) return;
  listenerAttached = true;

  void supabase.auth
    .getSession()
    .then(({ data }) => useAuthStore.getState().setSession(data.session ?? null));

  supabase.auth.onAuthStateChange((_event, session) => {
    useAuthStore.getState().setSession(session ?? null);
  });
}

export interface UseAuthResult {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

export function useAuth(): UseAuthResult {
  const session = useAuthStore((s) => s.session);
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);

  useEffect(() => {
    ensureListener();
  }, []);

  return {
    session,
    user,
    loading,
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };
}
