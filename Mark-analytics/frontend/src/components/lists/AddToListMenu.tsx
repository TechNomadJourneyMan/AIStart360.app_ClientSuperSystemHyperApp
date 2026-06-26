import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookmarkPlus, Loader2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { useAuth } from '@/services/auth';
import {
  useAddSavedListItem,
  useCreateSavedList,
  useSavedLists,
} from '@/hooks/useSavedLists';

interface Props {
  companyId: string;
  /** Optional list of company IDs for multi-select bulk add. */
  companyIds?: string[];
  size?: 'sm' | 'md';
  variant?: 'default' | 'ghost' | 'outline' | 'secondary';
}

/**
 * Dropdown that lets the user save one or many companies to an existing list,
 * or create a new list inline. Intended for company-detail drawers and table
 * rows in the (future) Directory view.
 */
export function AddToListMenu({
  companyId,
  companyIds,
  size = 'sm',
  variant = 'ghost',
}: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: lists, isLoading } = useSavedLists();
  const addMutation = useAddSavedListItem();
  const createMutation = useCreateSavedList();

  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');

  if (!user) return null;

  const targets = companyIds && companyIds.length > 0 ? companyIds : [companyId];

  const addToList = async (listId: string) => {
    for (const id of targets) {
      try {
        await addMutation.mutateAsync({ list_id: listId, company_id: id });
      } catch {
        // continue with remaining targets; the last error is reflected in
        // addMutation.isError but we don't block the user.
      }
    }
  };

  const submitCreate = async () => {
    const name = draftName.trim();
    if (!name) return;
    try {
      const created = await createMutation.mutateAsync({ name });
      await addToList(created.id);
      setDraftName('');
      setCreating(false);
    } catch {
      // surfaced via mutation state
    }
  };

  const busy = addMutation.isPending || createMutation.isPending;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size={size}
          variant={variant}
          disabled={busy}
          aria-label={t('lists.addTo', { defaultValue: 'Add to list' }) ?? ''}
          title={t('lists.addTo', { defaultValue: 'Add to list' }) ?? ''}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <BookmarkPlus className="h-3.5 w-3.5" aria-hidden />
          )}
          <span className="sr-only">
            {t('lists.addTo', { defaultValue: 'Add to list' })}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          {targets.length > 1
            ? t('lists.addToBulk', {
                count: targets.length,
                defaultValue: `Add ${targets.length} companies to…`,
              })
            : t('lists.addTo', { defaultValue: 'Add to list' })}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isLoading ? (
          <div className="px-2 py-1.5 text-xs text-[color:var(--muted-foreground)]">
            {t('common.loading', { defaultValue: 'Loading…' })}
          </div>
        ) : !lists || lists.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-[color:var(--muted-foreground)]">
            {t('lists.empty', { defaultValue: 'No saved lists yet.' })}
          </div>
        ) : (
          lists.map((list) => (
            <DropdownMenuItem
              key={list.id}
              onSelect={(e) => {
                e.preventDefault();
                void addToList(list.id);
              }}
              className="flex items-center justify-between"
            >
              <span className="truncate">{list.name}</span>
              <span className="ml-2 shrink-0 rounded-sm bg-[color:var(--secondary)] px-1.5 text-[10px] tabular-nums text-[color:var(--secondary-foreground)]">
                {list.item_count}
              </span>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        {creating ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitCreate();
            }}
            className={cn('flex items-center gap-1 px-2 py-1.5')}
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
        ) : (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setCreating(true);
            }}
          >
            + {t('lists.create', { defaultValue: 'Create list' })}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default AddToListMenu;
