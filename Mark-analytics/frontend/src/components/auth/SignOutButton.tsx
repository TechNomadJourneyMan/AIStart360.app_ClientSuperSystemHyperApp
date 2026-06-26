import { useState } from 'react';
import { LogOut, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button, type ButtonProps } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/services/auth';

type Variant = ButtonProps['variant'];
type Size = ButtonProps['size'];

interface SignOutButtonProps {
  variant?: Variant;
  size?: Size;
  className?: string;
  showLabel?: boolean;
}

export function SignOutButton({
  variant = 'outline',
  size = 'sm',
  className,
  showLabel = true,
}: SignOutButtonProps) {
  const { t } = useTranslation();
  const { signOut } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    try {
      await signOut();
      qc.removeQueries({ queryKey: ['me'] });
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        onClick={() => setOpen(true)}
        aria-label={t('auth.signOut')}
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden />
        {showLabel && t('auth.signOut')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('auth.signOut')}?</DialogTitle>
            <DialogDescription>
              You will need to sign in again to access your data.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleConfirm}
              disabled={loading}
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              {t('auth.signOut')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
