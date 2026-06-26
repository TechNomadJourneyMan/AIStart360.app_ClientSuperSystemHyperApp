import { useState, type FormEvent } from 'react';
import { Loader2, Mail, CheckCircle2, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUIStore } from '@/stores/ui';
import { supabase } from '@/services/auth';

type Mode = 'signin' | 'signup';

const MIN_PASSWORD_LENGTH = 8;

// Toggle this to enable Google OAuth in the UI.
// The button stays rendered but disabled until provider is configured in Supabase.
const ENABLE_GOOGLE_OAUTH = false;

export function AuthModal() {
  const open = useUIStore((s) => s.authModalOpen);
  const setOpen = useUIStore((s) => s.setAuthModalOpen);
  const [tab, setTab] = useState<Mode>('signin');

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tab === 'signin' ? 'Welcome back' : 'Create your account'}</DialogTitle>
          <DialogDescription>
            {tab === 'signin'
              ? 'Sign in with a magic link or your password-less account.'
              : 'Sign up with email and password to get started.'}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Mode)} defaultValue="signin">
          <TabsList className="w-full">
            <SignInTabTrigger />
            <SignUpTabTrigger />
          </TabsList>

          <TabsContent value="signin">
            <SignInForm />
          </TabsContent>
          <TabsContent value="signup">
            <SignUpForm />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function SignInTabTrigger() {
  const { t } = useTranslation();
  return <TabsTrigger value="signin">{t('auth.signIn')}</TabsTrigger>;
}

function SignUpTabTrigger() {
  const { t } = useTranslation();
  return <TabsTrigger value="signup">{t('auth.signUp')}</TabsTrigger>;
}

function SignInForm() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError('Email is required.');
      return;
    }
    setLoading(true);
    try {
      const redirectTo =
        typeof window !== 'undefined' ? window.location.origin : undefined;
      const { error: err } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
      });
      if (err) throw err;
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send magic link.');
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    setGoogleLoading(true);
    try {
      const redirectTo =
        typeof window !== 'undefined' ? window.location.origin : undefined;
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: redirectTo ? { redirectTo } : undefined,
      });
      if (err) throw err;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OAuth sign-in failed.');
    } finally {
      setGoogleLoading(false);
    }
  }

  if (sent) {
    return (
      <div
        className="flex flex-col items-center gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--muted)] p-4 text-center text-xs"
        role="status"
        aria-live="polite"
      >
        <CheckCircle2 className="h-5 w-5 text-[color:var(--primary)]" aria-hidden />
        <p className="font-medium">{t('auth.checkInbox')}</p>
        <p className="text-[color:var(--muted-foreground)]">
          We sent a sign-in link to <strong>{email}</strong>.
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setSent(false);
            setEmail('');
          }}
        >
          Use a different email
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signin-email">{t('auth.email')}</Label>
        <Input
          id="signin-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
          placeholder="you@company.com"
        />
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-[color:var(--destructive)]/40 bg-[color:var(--destructive)]/10 p-2 text-xs text-[color:var(--destructive)]"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Mail className="h-4 w-4" aria-hidden />
        )}
        {t('auth.magicLink')}
      </Button>

      <div className="relative flex items-center py-1">
        <div className="flex-1 border-t border-[color:var(--border)]" />
        <span className="px-2 text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
          or
        </span>
        <div className="flex-1 border-t border-[color:var(--border)]" />
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={handleGoogle}
        disabled={!ENABLE_GOOGLE_OAUTH || googleLoading}
        title={ENABLE_GOOGLE_OAUTH ? undefined : 'Google OAuth not configured'}
      >
        {googleLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <GoogleIcon />
        )}
        {t('auth.continueWithGoogle')}
      </Button>
    </form>
  );
}

function SignUpForm() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError('Email is required.');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const redirectTo =
        typeof window !== 'undefined' ? window.location.origin : undefined;
      const { error: err } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
      });
      if (err) throw err;
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create account.');
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div
        className="flex flex-col items-center gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--muted)] p-4 text-center text-xs"
        role="status"
        aria-live="polite"
      >
        <CheckCircle2 className="h-5 w-5 text-[color:var(--primary)]" aria-hidden />
        <p className="font-medium">Verify your email</p>
        <p className="text-[color:var(--muted-foreground)]">
          We sent a verification link to <strong>{email}</strong>. Open it to activate your account.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signup-email">{t('auth.email')}</Label>
        <Input
          id="signup-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
          placeholder="you@company.com"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signup-password">{t('auth.password')}</Label>
        <Input
          id="signup-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
          placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signup-confirm">{t('auth.confirmPassword')}</Label>
        <Input
          id="signup-confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={loading}
        />
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-[color:var(--destructive)]/40 bg-[color:var(--destructive)]/10 p-2 text-xs text-[color:var(--destructive)]"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      <Button type="submit" disabled={loading} className="w-full">
        {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        Create account
      </Button>
    </form>
  );
}

function GoogleIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.25 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.5 14.6 2.5 12 2.5 6.7 2.5 2.4 6.8 2.4 12.1S6.7 21.7 12 21.7c6.9 0 9.6-4.8 9.6-7.3 0-.5-.1-.9-.1-1.2H12z"
      />
    </svg>
  );
}
