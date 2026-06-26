import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, FileText, UserSquare2 } from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { useUIStore } from '@/stores/ui';
import { useMapStore } from '@/stores/map';
import { useSearch, type SearchHit } from '@/hooks/useSearch';
import { cn } from '@/lib/cn';

/**
 * Cmd+K global search palette. Mounted once at the root and toggled via
 * `useUIStore.searchOpen`. Keyboard shortcut handling lives in the root
 * route so it works regardless of whether the modal is mounted/open.
 */
export function SearchModal() {
  const { t } = useTranslation();
  const open = useUIStore((s) => s.searchOpen);
  const setOpen = useUIStore((s) => s.setSearchOpen);
  const selectCompany = useMapStore((s) => s.selectCompany);

  const [rawQuery, setRawQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  // Reset query when modal closes so re-open starts fresh.
  useEffect(() => {
    if (!open) {
      setRawQuery('');
      setDebounced('');
    }
  }, [open]);

  // 300ms debounce.
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(rawQuery), 300);
    return () => window.clearTimeout(handle);
  }, [rawQuery]);

  const { data, isFetching, isError } = useSearch({ query: debounced });

  const handleSelectCompany = useCallback(
    (id: string) => {
      selectCompany(id);
      setOpen(false);
    },
    [selectCompany, setOpen],
  );

  const handleComingSoon = useCallback(() => {
    setOpen(false);
  }, [setOpen]);

  const hasResults = useMemo(() => {
    if (!data) return false;
    return data.companies.length + data.persons.length + data.tenders.length > 0;
  }, [data]);

  const showEmptyPrompt = debounced.trim().length < 2;
  const showNoMatches =
    !showEmptyPrompt && !isFetching && !isError && !hasResults;

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      ariaLabel={t('search.placeholder')}
    >
      <CommandInput
        value={rawQuery}
        onValueChange={setRawQuery}
        placeholder={t('search.placeholder') ?? 'Search…'}
        loading={isFetching}
      />
      {/*
        We disable cmdk's default client-side filter via `shouldFilter={false}`
        is set on the Command primitive elsewhere if needed; since the server
        already filters, mark every item static via `value={item.id}` and let
        cmdk highlight without filtering. Setting shouldFilter on the root:
      */}
      <CommandList>
        {showEmptyPrompt ? (
          <CommandEmpty>{t('search.empty')}</CommandEmpty>
        ) : null}

        {isError ? (
          <div
            className={cn(
              'px-3 py-6 text-center text-xs text-[color:var(--destructive)]',
            )}
            role="alert"
          >
            {t('common.error')}
          </div>
        ) : null}

        {showNoMatches ? (
          <CommandEmpty>{t('search.noMatches')}</CommandEmpty>
        ) : null}

        {data && data.companies.length > 0 ? (
          <CommandGroup heading={t('search.group.companies') ?? 'Companies'}>
            {data.companies.map((hit) => (
              <SearchResultItem
                key={`company-${hit.id}`}
                hit={hit}
                onSelect={() => handleSelectCompany(hit.id)}
              />
            ))}
          </CommandGroup>
        ) : null}

        {data && data.persons.length > 0 ? (
          <CommandGroup heading={t('search.group.persons') ?? 'Persons'}>
            {data.persons.map((hit) => (
              <SearchResultItem
                key={`person-${hit.id}`}
                hit={hit}
                onSelect={handleComingSoon}
                comingSoon
              />
            ))}
          </CommandGroup>
        ) : null}

        {data && data.tenders.length > 0 ? (
          <CommandGroup heading={t('search.group.tenders') ?? 'Tenders'}>
            {data.tenders.map((hit) => (
              <SearchResultItem
                key={`tender-${hit.id}`}
                hit={hit}
                onSelect={handleComingSoon}
                comingSoon
              />
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}

interface SearchResultItemProps {
  hit: SearchHit;
  onSelect: () => void;
  comingSoon?: boolean;
}

function SearchResultItem({ hit, onSelect, comingSoon }: SearchResultItemProps) {
  const { t } = useTranslation();
  const Icon =
    hit.type === 'companies'
      ? Building2
      : hit.type === 'persons'
        ? UserSquare2
        : FileText;

  const typeLabel =
    hit.type === 'companies'
      ? (t('search.group.companies') ?? 'Companies')
      : hit.type === 'persons'
        ? (t('search.group.persons') ?? 'Persons')
        : (t('search.group.tenders') ?? 'Tenders');

  const subtitle = buildSubtitle(hit);

  return (
    <CommandItem
      // Use a stable unique value so cmdk doesn't collapse duplicates by title.
      value={`${hit.type}:${hit.id}:${hit.title}`}
      onSelect={onSelect}
    >
      <Icon
        className="shrink-0 text-[color:var(--muted-foreground)]"
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm leading-tight text-[color:var(--foreground)]">
          {hit.title}
        </span>
        {subtitle ? (
          <span className="truncate text-[11px] leading-tight text-[color:var(--muted-foreground)]">
            {subtitle}
          </span>
        ) : null}
      </div>
      {comingSoon ? (
        <span
          className={cn(
            'ml-2 rounded-sm border border-[color:var(--border)] px-1.5 py-0.5',
            'text-[9px] uppercase tracking-wider text-[color:var(--muted-foreground)]',
          )}
        >
          {t('common.comingSoon')}
        </span>
      ) : null}
      <span
        className={cn(
          'ml-2 rounded-sm bg-[color:var(--secondary)] px-1.5 py-0.5',
          'text-[9px] uppercase tracking-wider text-[color:var(--secondary-foreground)]',
        )}
      >
        {typeLabel}
      </span>
    </CommandItem>
  );
}

function buildSubtitle(hit: SearchHit): string | null {
  if (hit.subtitle) return hit.subtitle;
  if (hit.type === 'companies') {
    return [hit.bin, hit.industry, hit.region_kato].filter(Boolean).join(' · ') || null;
  }
  if (hit.type === 'persons') {
    return [hit.role, hit.company_id].filter(Boolean).join(' · ') || null;
  }
  if (hit.type === 'tenders') {
    return [hit.status, hit.amount != null ? String(hit.amount) : null]
      .filter(Boolean)
      .join(' · ') || null;
  }
  return null;
}

export default SearchModal;
