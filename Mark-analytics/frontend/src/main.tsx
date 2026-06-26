import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { NuqsAdapter } from 'nuqs/adapters/react';

import { router } from '@/app/router';
import { queryClient } from '@/services/query-client';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { supabase } from '@/services/auth';
import {
  useMarketInsightsStore,
  type MarketInsight,
} from '@/stores/marketInsights';
import '@/locales/i18n';
import '@/styles/globals.css';

// ── AIStart360 cabinet auth bridge ──────────────────────────────────────────
// When embedded in the AIStart360 portal (/market iframe), the portal posts the
// cabinet's Supabase session (same Supabase project) so the user is signed in
// here without a second login. Origins are restricted to the portal hosts.
const PORTAL_ORIGINS = new Set(
  [
    'http://localhost:53000',
    'http://localhost:3000',
    (import.meta as unknown as { env: Record<string, string | undefined> }).env
      .VITE_PORTAL_ORIGIN,
  ].filter((o): o is string => Boolean(o)),
);

window.addEventListener('message', (event: MessageEvent) => {
  if (!PORTAL_ORIGINS.has(event.origin)) return;
  const data = event.data as
    | {
        type?: string;
        access_token?: string;
        refresh_token?: string;
        items?: MarketInsight[];
      }
    | null;
  if (!data || typeof data.type !== 'string') return;

  // Cabinet auth bridge (unchanged): adopt the portal's Supabase session.
  if (data.type === 'aistart360:session') {
    if (!data.access_token || !data.refresh_token) return;
    void supabase.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });
    return;
  }

  // Market-insights bridge: the portal pushes the «Чек-лист 50 вопросов» Q&A
  // (sent on iframe load and re-sent on updates) for the map overlay to render.
  if (data.type === 'aistart360:insights') {
    useMarketInsightsStore
      .getState()
      .setItems(Array.isArray(data.items) ? data.items : []);
    return;
  }
});

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(rootEl).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <NuqsAdapter>
          <RouterProvider router={router} />
        </NuqsAdapter>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
