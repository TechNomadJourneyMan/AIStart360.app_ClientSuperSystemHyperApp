import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListPlus, BookmarkCheck, Loader2 } from 'lucide-react';
import {
  useCreateSavedList,
  useSavedLists,
  type SavedListSummary,
} from '@/hooks/useSavedLists';
import { useAuth } from '@/services/auth';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SavedListDetailDialog } from './SavedListDetailDialog';

/**
 * Sidebar section showing the current user's saved Companies lists.
 *
 * Renders inside the AppShell left rail. Hidden for anonymous users.
 */
export function SavedListsSidebar() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data, isLoading, isError } = useSavedLists();
  const createMutation = useCreateSavedList();

  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [openListId, setOpenListId] = useState<string | null>(null);

  if (!user) return null;

  const submitCreate = async () => {
    const name = draftName.trim();
    if (!name) return;
    try {
      await createMutation.mutateAsync({ name });
      setDraftName('');
      setCreating(false);
    } catch {
      // error surfaced via createMutation.isError
    }
  };

  return (
    <section
      data-testid="saved-lists-sidebar"
      className={cn(
        'flex flex-col gap-2 border-t border-[color:var(--border)] px-3 pb-3 pt-2',
        'text-xs',
      )}
    >
      <header className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
          <BookmarkCheck className="h-3 w-3" aria-hidden />
          {t('lists.title', { defaultValue: 'My lists' })}
        </span>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          aria-label={t('lists.create', { defaultValue: 'Create list' })}
          title={t('lists.create', { defaultValue: 'Create list' }) ?? ''}
          className={cn(
            'grid h-5 w-5 place-items-center rounded-sm',
            'text-[color:var(--muted-foreground)] hover:bg-[color:var(--accent)]',
            'hover:text-[color:var(--accent-foreground)]',
          )}
        >
          <ListPlus className="h-3.5 w-3.5" aria-hidden />
        </button>
      </header>

      {creating ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitCreate();
          }}
          className="flex items-center gap-1"
        >
          <Input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder={
              t('lists.newName', { defaultValue: 'New list name' }) ?? ''
            }
            className="h-7 text-xs"
            maxLength={120}
          />
          <Button
            type="submit"
            size="sm"
            disabled={createMutation.isPending || !draftName.trim()}
          >
            {createMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              t('lists.add', { defaultValue: 'Add' })
            )}
          </Button>
        </form>
      ) : null}

      {isLoading ? (
        <span className="text-[color:var(--muted-foreground)]">
          {t('common.loading', { defaultValue: 'Loading…' })}
        </span>
      ) : isError ? (
        <span className="text-[color:var(--destructive)]">
          {t('common.error', { defaultValue: 'Error' })}
        </span>
      ) : !data || data.length === 0 ? (
        <span className="text-[color:var(--muted-foreground)]">
          {t('lists.empty', { defaultValue: 'No saved lists yet.' })}
        </span>
      ) : (
        <ul className="flex flex-col gap-0.5" data-testid="saved-lists">
          {data.map((list) => (
            <SavedListRow
              key={list.id}
              list={list}
              onOpen={() => setOpenListId(list.id)}
            />
          ))}
        </ul>
      )}

      {openListId ? (
        <SavedListDetailDialog
          id={openListId}
          onClose={() => setOpenListId(null)}
        />
      ) : null}
    </section>
  );
}

interface RowProps {
  list: SavedListSummary;
  onOpen: () => void;
}

function SavedListRow({ list, onOpen }: RowProps) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'flex w-full items-center justify-between rounded-sm px-2 py-1 text-left',
          'hover:bg-[color:var(--accent)] hover:text-[color:var(--accent-foreground)]',
        )}
      >
        <span className="truncate text-xs">{list.name}</span>
        <span className="ml-2 shrink-0 rounded-sm bg-[color:var(--secondary)] px-1.5 py-0.5 text-[10px] tabular-nums text-[color:var(--secondary-foreground)]">
          {list.item_count}
        </span>
      </button>
    </li>
  );
}

export default SavedListsSidebar;
