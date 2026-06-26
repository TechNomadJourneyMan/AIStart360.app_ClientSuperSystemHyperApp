import { useEffect, type ReactNode } from 'react';
import { useUIStore } from '@/stores/ui';

interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * Syncs the current theme from the store to `<html data-theme="...">`.
 * Initial value is set pre-paint in `index.html` to avoid FOUC.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const theme = useUIStore((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('mk-theme', theme);
    } catch {
      // localStorage unavailable; ignore.
    }
  }, [theme]);

  return <>{children}</>;
}
