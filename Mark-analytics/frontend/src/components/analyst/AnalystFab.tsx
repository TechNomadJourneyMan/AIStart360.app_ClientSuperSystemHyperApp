import { Sparkles } from 'lucide-react';
import { useUIStore } from '@/stores/ui';
import { cn } from '@/lib/cn';

/**
 * Floating action button — "Ask MK Analyst" trigger pinned to the bottom-right
 * of the index route. Pairs with the Cmd+J global shortcut.
 *
 * Track A of `docs/aistart360/08-world-monitor-feature-parity.md` §5.
 */
export function AnalystFab(): JSX.Element {
  const open = useUIStore((s) => s.analystOpen);
  const setOpen = useUIStore((s) => s.setAnalystOpen);

  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-label="Ask MK Analyst"
      aria-expanded={open}
      title="Ask MK Analyst (⌘J)"
      className={cn(
        'fixed bottom-5 right-5 z-30 flex h-12 items-center gap-2 rounded-full px-4',
        'bg-[color:var(--primary)] text-[color:var(--primary-foreground)] shadow-lg',
        'hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)]',
        'transition-opacity',
      )}
    >
      <Sparkles className="h-4 w-4" aria-hidden="true" />
      <span className="text-sm font-medium">Ask MK Analyst</span>
    </button>
  );
}

export default AnalystFab;
