import { useEffect, type ReactNode } from 'react';
import { Lock, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/services/auth';
import { useUIStore } from '@/stores/ui';

interface AuthGuardProps {
  children: ReactNode;
  /** When true, automatically open the auth modal as soon as we detect an unauthenticated user. */
  autoOpenModal?: boolean;
  /** Override the paywall body. */
  fallback?: ReactNode;
}

export function AuthGuard({
  children,
  autoOpenModal = true,
  fallback,
}: AuthGuardProps) {
  const { user, loading } = useAuth();
  const setAuthModalOpen = useUIStore((s) => s.setAuthModalOpen);

  useEffect(() => {
    if (!loading && !user && autoOpenModal) {
      setAuthModalOpen(true);
    }
  }, [loading, user, autoOpenModal, setAuthModalOpen]);

  if (loading) {
    return (
      <div
        className="flex h-full min-h-[200px] w-full items-center justify-center"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-5 w-5 animate-spin text-[color:var(--muted-foreground)]" aria-hidden />
      </div>
    );
  }

  if (!user) {
    return <>{fallback ?? <Paywall />}</>;
  }

  return <>{children}</>;
}

function Paywall() {
  const { t } = useTranslation();
  const setAuthModalOpen = useUIStore((s) => s.setAuthModalOpen);

  return (
    <div className="flex h-full min-h-[300px] w-full items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <div
          aria-hidden
          className="grid h-10 w-10 place-items-center rounded-full bg-[color:var(--muted)] text-[color:var(--muted-foreground)]"
        >
          <Lock className="h-4 w-4" />
        </div>
        <h2 className="text-sm font-semibold">Sign in required</h2>
        <p className="text-xs text-[color:var(--muted-foreground)]">
          You need to sign in to access this section.
        </p>
        <Button size="sm" onClick={() => setAuthModalOpen(true)}>
          {t('auth.signIn')}
        </Button>
      </div>
    </div>
  );
}
