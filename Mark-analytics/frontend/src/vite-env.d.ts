/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_MAPTILER_KEY: string;
  readonly VITE_ENABLE_DEVTOOLS?: string;
  readonly VITE_ENABLE_ADMIN?: string;
  /**
   * Track G — when set to `'true'` or `'1'`, widget hooks hit the real
   * `/api/v1/widgets/*` backend. Otherwise they return in-memory mocks.
   */
  readonly VITE_WIDGETS_API_READY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
