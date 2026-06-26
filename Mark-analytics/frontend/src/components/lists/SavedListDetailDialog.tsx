import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Loader2, Pencil, Trash2, X, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import {
  downloadSavedListCsv,
  useDeleteSavedList,
  useRemoveSavedListItem,
  useRenameSavedList,
  useSavedList,
  useUpdateSavedListItemNote,
  type SavedListItem,
} from '@/hooks/useSavedLists';

interface Props {
  id: string;
  onClose: () => void;
}

export function SavedListDetailDialog({ id, onClose }: Props) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useSavedList(id);
  const renameMutation = useRenameSavedList();
  const deleteMutation = useDeleteSavedList();

  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (data) setDraftName(data.name);
  }, [data]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) onClose();
  };

  const submitRename = async () => {
    if (!data) return;
    const next = draftName.trim();
    if (!next || next === data.name) {
      setRenaming(false);
      return;
    }
    try {
      await renameMutation.mutateAsync({ id, name: next });
      setRenaming(false);
    } catch {
      // surfaced via mutation state
    }
  };

  const handleDelete = async () => {
    if (!data) return;
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        t('lists.confirmDelete', {
          defaultValue: 'Delete this list? This cannot be undone.',
        }) ?? '',
      );
      if (!ok) return;
    }
    try {
      await deleteMutation.mutateAsync({ id });
      handleOpenChange(false);
    } catch {
      // surfaced via mutation state
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadSavedListCsv(id);
    } finally {
      setExporting(false);
    }
  };

  const items = useMemo(() => data?.items ?? [], [data]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-2xl"
        aria-describedby="saved-list-description"
      >
        <DialogHeader>
          {renaming ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitRename();
              }}
              className="flex items-center gap-2"
            >
              <Input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                maxLength={120}
                className="h-7 text-sm"
              />
              <Button type="submit" size="sm" disabled={renameMutation.isPending}>
                {renameMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : (
                  <Check className="h-3.5 w-3.5" aria-hidden />
                )}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRenaming(false);
                  if (data) setDraftName(data.name);
                }}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </form>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <DialogTitle className="truncate">
                {data?.name ?? t('common.loading', { defaultValue: 'Loading…' })}
              </DialogTitle>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setRenaming(true)}
                  disabled={!data}
                  aria-label={t('lists.rename', { defaultValue: 'Rename' }) ?? ''}
                  title={t('lists.rename', { defaultValue: 'Rename' }) ?? ''}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void handleExport()}
                  disabled={!data || exporting}
                  aria-label={t('lists.export', { defaultValue: 'Export CSV' }) ?? ''}
                  title={t('lists.export', { defaultValue: 'Export CSV' }) ?? ''}
                >
                  {exporting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Download className="h-3.5 w-3.5" aria-hidden />
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void handleDelete()}
                  disabled={!data || deleteMutation.isPending}
                  aria-label={t('lists.delete', { defaultValue: 'Delete' }) ?? ''}
                  title={t('lists.delete', { defaultValue: 'Delete' }) ?? ''}
                  className="text-[color:var(--destructive)]"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
            </div>
          )}
          <DialogDescription id="saved-list-description">
            {data
              ? t('lists.itemCount', {
                  count: data.item_count,
                  defaultValue: `${data.item_count} companies`,
                })
              : null}
          </DialogDescription>
        </DialogHeader>

        <div
          className={cn(
            'max-h-[60vh] overflow-y-auto rounded-md border border-[color:var(--border)]',
          )}
          data-testid="saved-list-items"
        >
          {isLoading ? (
            <div className="p-4 text-center text-xs text-[color:var(--muted-foreground)]">
              {t('common.loading', { defaultValue: 'Loading…' })}
            </div>
          ) : isError ? (
            <div className="p-4 text-center text-xs text-[color:var(--destructive)]">
              {t('common.error', { defaultValue: 'Error' })}
            </div>
          ) : items.length === 0 ? (
            <div className="p-4 text-center text-xs text-[color:var(--muted-foreground)]">
              {t('lists.empty', { defaultValue: 'No saved lists yet.' })}
            </div>
          ) : (
            <ul className="divide-y divide-[color:var(--border)]">
              {items.map((item) => (
                <SavedListItemRow key={item.company_id} listId={id} item={item} />
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface RowProps {
  listId: string;
  item: SavedListItem;
}

function SavedListItemRow({ listId, item }: RowProps) {
  const { t } = useTranslation();
  const removeMutation = useRemoveSavedListItem();
  const noteMutation = useUpdateSavedListItemNote();

  const [editingNote, setEditingNote] = useState(false);
  const [draftNote, setDraftNote] = useState(item.note ?? '');

  useEffect(() => {
    setDraftNote(item.note ?? '');
  }, [item.note]);

  const submitNote = async () => {
    try {
      await noteMutation.mutateAsync({
        list_id: listId,
        company_id: item.company_id,
        note: draftNote.trim() ? draftNote.trim() : null,
      });
      setEditingNote(false);
    } catch {
      // surfaced via mutation state
    }
  };

  const submitRemove = async () => {
    try {
      await removeMutation.mutateAsync({
        list_id: listId,
        company_id: item.company_id,
      });
    } catch {
      // surfaced via mutation state
    }
  };

  return (
    <li className="flex flex-col gap-1 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-[color:var(--foreground)]">
            {item.company_name ?? item.company_id}
          </div>
          <div className="truncate text-[10px] uppercase tracking-wider text-[color:var(--muted-foreground)]">
            {[item.company_country, item.industry_label]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEditingNote((v) => !v)}
            aria-label={t('lists.editNote', { defaultValue: 'Edit note' }) ?? ''}
            title={t('lists.editNote', { defaultValue: 'Edit note' }) ?? ''}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void submitRemove()}
            disabled={removeMutation.isPending}
            aria-label={t('lists.removeItem', { defaultValue: 'Remove' }) ?? ''}
            title={t('lists.removeItem', { defaultValue: 'Remove' }) ?? ''}
            className="text-[color:var(--destructive)]"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      {editingNote ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitNote();
          }}
          className="flex items-center gap-1"
        >
          <Input
            autoFocus
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
            placeholder={t('lists.notePlaceholder', { defaultValue: 'Note…' }) ?? ''}
            className="h-7 text-xs"
            maxLength={2000}
          />
          <Button type="submit" size="sm" disabled={noteMutation.isPending}>
            {noteMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <Check className="h-3.5 w-3.5" aria-hidden />
            )}
          </Button>
        </form>
      ) : item.note ? (
        <p className="text-xs italic text-[color:var(--muted-foreground)]">
          {item.note}
        </p>
      ) : null}
    </li>
  );
}

export default SavedListDetailDialog;
