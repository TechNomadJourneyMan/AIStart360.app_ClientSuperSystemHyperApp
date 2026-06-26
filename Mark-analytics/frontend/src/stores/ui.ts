import { create } from 'zustand';

export type Theme = 'light' | 'dark';

interface UIState {
  theme: Theme;
  sidebarCollapsed: boolean;
  authModalOpen: boolean;
  searchOpen: boolean;
  analystOpen: boolean;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setAuthModalOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  toggleSearchOpen: () => void;
  setAnalystOpen: (open: boolean) => void;
  toggleAnalystOpen: () => void;
}

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = window.localStorage.getItem('mk-theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // ignore
  }
  return 'dark';
}

export const useUIStore = create<UIState>((set, get) => ({
  theme: readInitialTheme(),
  sidebarCollapsed: false,
  authModalOpen: false,
  searchOpen: false,
  analystOpen: false,
  setTheme: (theme) => set({ theme }),
  toggleTheme: () => set({ theme: get().theme === 'dark' ? 'light' : 'dark' }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
  setAuthModalOpen: (authModalOpen) => set({ authModalOpen }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  toggleSearchOpen: () => set({ searchOpen: !get().searchOpen }),
  setAnalystOpen: (analystOpen) => set({ analystOpen }),
  toggleAnalystOpen: () => set({ analystOpen: !get().analystOpen }),
}));

// Backwards-compat alias (some specs reference `useUiStore` lowercase).
export const useUiStore = useUIStore;
