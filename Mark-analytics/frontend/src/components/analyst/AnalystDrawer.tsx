import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Send, Sparkles } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/ui';
import { useMapStore } from '@/stores/map';
import { useAnalystQuery, type AnalystAction, type AnalystToolCall } from '@/hooks/useAnalyst';
import { cn } from '@/lib/cn';

/**
 * MK Analyst drawer (Track A of `docs/aistart360/08-world-monitor-feature-parity.md` §5).
 *
 * Slide-in right-side panel with a single-turn chat over the AI Gateway.
 * Mount this once near the index route; visibility is controlled by
 * `useUIStore.analystOpen` so the FAB and Cmd+J shortcut can toggle it.
 *
 * Persistence: `conversation_id` is stored in `sessionStorage` so a refresh
 * within the same session keeps the chat coherent. Message list itself is
 * in-memory only — closing the drawer wipes the UI but the backend keeps
 * 24h of history in Redis, so the next turn still has context.
 */

interface ChatBubble {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  actions?: AnalystAction[];
  toolCalls?: AnalystToolCall[];
}

const SESSION_KEY = 'mk-analyst-conversation-id';

function readConversationId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function writeConversationId(value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SESSION_KEY, value);
  } catch {
    // sessionStorage might be unavailable in some contexts (private mode);
    // we tolerate that — the next turn just starts a fresh thread.
  }
}

function makeBubbleId(): string {
  return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function AnalystDrawer(): JSX.Element {
  const open = useUIStore((s) => s.analystOpen);
  const setOpen = useUIStore((s) => s.setAnalystOpen);
  const selectCompany = useMapStore((s) => s.selectCompany);

  const [conversationId, setConversationId] = useState<string | null>(() =>
    readConversationId(),
  );
  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const mutation = useAnalystQuery();

  // Autoscroll on new bubbles.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [bubbles, mutation.isPending]);

  // Focus the textarea when the drawer opens.
  useEffect(() => {
    if (open && inputRef.current) {
      const timer = window.setTimeout(() => inputRef.current?.focus(), 50);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [open]);

  const submit = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || mutation.isPending) return;

      setBubbles((prev) => [
        ...prev,
        { id: makeBubbleId(), role: 'user', text },
      ]);
      setDraft('');

      try {
        const response = await mutation.mutateAsync({
          query: text,
          conversation_id: conversationId ?? undefined,
        });

        if (response.conversation_id && response.conversation_id !== conversationId) {
          setConversationId(response.conversation_id);
          writeConversationId(response.conversation_id);
        }

        setBubbles((prev) => [
          ...prev,
          {
            id: makeBubbleId(),
            role: 'assistant',
            text: response.message,
            actions: response.actions,
            toolCalls: response.tool_calls,
          },
        ]);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to reach analyst';
        setBubbles((prev) => [
          ...prev,
          {
            id: makeBubbleId(),
            role: 'assistant',
            text: `Ошибка: ${message}`,
          },
        ]);
      }
    },
    [mutation, conversationId],
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void submit(draft);
    },
    [draft, submit],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // Cmd/Ctrl+Enter or plain Enter (without Shift) sends.
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void submit(draft);
      }
    },
    [draft, submit],
  );

  const handleAction = useCallback(
    (action: AnalystAction) => {
      if (action.type === 'open_company') {
        const id = action.payload?.id;
        if (typeof id === 'string' && id) {
          selectCompany(id);
          setOpen(false);
        }
        return;
      }
      if (action.type === 'apply_filter') {
        const filters = action.payload?.filters;
        applyDirectoryFilters(filters);
        return;
      }
      // Unknown action — log only.
      console.warn('[AnalystDrawer] Unknown action type', action.type, action.payload);
    },
    [selectCompany, setOpen],
  );

  const emptyState = useMemo(
    () => bubbles.length === 0 && !mutation.isPending,
    [bubbles.length, mutation.isPending],
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        closeLabel="Close MK Analyst"
        className="flex flex-col gap-0 p-0"
      >
        <SheetHeader className="pr-12">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-indigo-500" aria-hidden="true" />
            <SheetTitle>MK Analyst</SheetTitle>
          </div>
          <SheetDescription>
            Ask about companies, tenders, industries, regions. Press Cmd/Ctrl+J to toggle.
          </SheetDescription>
        </SheetHeader>

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
          aria-live="polite"
          aria-relevant="additions text"
        >
          {emptyState ? <EmptyState /> : null}
          {bubbles.map((b) => (
            <ChatBubbleView
              key={b.id}
              bubble={b}
              onAction={handleAction}
            />
          ))}
          {mutation.isPending ? <ThinkingBubble /> : null}
        </div>

        <form
          onSubmit={handleSubmit}
          className="border-t border-[color:var(--border)] p-3"
        >
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              placeholder="What do you want to know?"
              disabled={mutation.isPending}
              className={cn(
                'flex-1 resize-none rounded-md border border-[color:var(--border)]',
                'bg-[color:var(--background)] px-3 py-2 text-sm',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)]',
                'disabled:cursor-not-allowed disabled:opacity-60',
              )}
            />
            <Button
              type="submit"
              size="icon"
              disabled={mutation.isPending || draft.trim().length === 0}
              aria-label="Send"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-[color:var(--muted-foreground)]">
      <Sparkles className="h-6 w-6 text-indigo-500" aria-hidden="true" />
      <p className="font-medium text-[color:var(--foreground)]">Hi, I am MK Analyst.</p>
      <p>
        Try: <em>&ldquo;Покажи топ IT-компании в Алматы&rdquo;</em> or
        {' '}<em>&ldquo;Какие тендеры опубликованы за неделю?&rdquo;</em>.
      </p>
    </div>
  );
}

function ThinkingBubble(): JSX.Element {
  return (
    <div className="mb-3 flex justify-start">
      <div className="rounded-2xl bg-[color:var(--muted)] px-3 py-2 text-sm text-[color:var(--muted-foreground)]">
        <span className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:120ms]" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:240ms]" />
        </span>
      </div>
    </div>
  );
}

function ChatBubbleView({
  bubble,
  onAction,
}: {
  bubble: ChatBubble;
  onAction: (action: AnalystAction) => void;
}): JSX.Element {
  const isUser = bubble.role === 'user';
  return (
    <div className={cn('mb-3 flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap',
          isUser
            ? 'bg-[color:var(--primary)] text-[color:var(--primary-foreground)]'
            : 'bg-[color:var(--muted)] text-[color:var(--foreground)]',
        )}
      >
        {bubble.text}
        {!isUser && bubble.actions && bubble.actions.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {bubble.actions.map((action, idx) => (
              <ActionChip
                key={`${action.type}_${idx}`}
                action={action}
                onClick={() => onAction(action)}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ActionChip({
  action,
  onClick,
}: {
  action: AnalystAction;
  onClick: () => void;
}): JSX.Element {
  const label = describeAction(action);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-[color:var(--border)]',
        'bg-[color:var(--background)] px-2.5 py-0.5 text-xs',
        'hover:bg-[color:var(--accent)] hover:text-[color:var(--accent-foreground)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)]',
      )}
    >
      {label}
    </button>
  );
}

function describeAction(action: AnalystAction): string {
  if (action.type === 'open_company') {
    return 'Open company';
  }
  if (action.type === 'apply_filter') {
    const filters = (action.payload?.filters ?? {}) as Record<string, unknown>;
    const parts: string[] = [];
    for (const [k, v] of Object.entries(filters)) {
      const display = Array.isArray(v) ? v.join(',') : String(v);
      parts.push(`${k}=${display}`);
    }
    return parts.length > 0 ? `Filter: ${parts.join(' · ')}` : 'Apply filter';
  }
  return action.type;
}

/**
 * Track-C of the prior Phase-2 work introduced `useDirectoryFilterStore`
 * (see `frontend/src/stores/directoryFilter.ts`). It is not present on this
 * clean-room branch, so we fall back to a no-op + console.warn per the
 * Track-A spec.
 *
 * Loading the module lazily means we don't fail typecheck when the file
 * is absent.
 */
function applyDirectoryFilters(filters: unknown): void {
  if (!filters || typeof filters !== 'object') return;
  // Defer to the store if it exists at runtime. We avoid a static import so
  // bundlers don't fail when the module is missing on this branch.
  import('@/stores/directoryFilter' as string)
    .then((mod: unknown) => {
      const candidate = (mod as { useDirectoryFilterStore?: { getState?: () => { setBoth?: (f: unknown) => void } } })
        .useDirectoryFilterStore;
      const setBoth = candidate?.getState?.().setBoth;
      if (typeof setBoth === 'function') {
        setBoth(filters);
      } else {
        console.warn('[AnalystDrawer] directoryFilter store has no setBoth — filters ignored', filters);
      }
    })
    .catch(() => {
      console.warn('[AnalystDrawer] directoryFilter store not available on this branch — filters ignored', filters);
    });
}

export default AnalystDrawer;
