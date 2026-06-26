import {
  createContext,
  useContext,
  useMemo,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';

interface TabsContextValue {
  value: string;
  setValue: (v: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(component: string): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error(`<${component}> must be used inside <Tabs>`);
  }
  return ctx;
}

interface TabsProps extends HTMLAttributes<HTMLDivElement> {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
}

export function Tabs({
  defaultValue,
  value: controlledValue,
  onValueChange,
  className,
  children,
  ...props
}: TabsProps) {
  const [internalValue, setInternalValue] = useState<string>(
    defaultValue ?? controlledValue ?? '',
  );
  const value = controlledValue ?? internalValue;

  const ctx = useMemo<TabsContextValue>(
    () => ({
      value,
      setValue: (v) => {
        if (controlledValue === undefined) setInternalValue(v);
        onValueChange?.(v);
      },
    }),
    [value, controlledValue, onValueChange],
  );

  return (
    <TabsContext.Provider value={ctx}>
      <div className={cn('flex flex-col gap-3', className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex h-9 items-center justify-center rounded-md',
        'border border-[color:var(--border)] bg-[color:var(--muted)] p-1',
        'text-[color:var(--muted-foreground)]',
        className,
      )}
      {...props}
    />
  );
}

interface TabsTriggerProps extends HTMLAttributes<HTMLButtonElement> {
  value: string;
}

export function TabsTrigger({ value, className, children, ...props }: TabsTriggerProps) {
  const ctx = useTabsContext('TabsTrigger');
  const active = ctx.value === value;
  return (
    <button
      role="tab"
      type="button"
      aria-selected={active}
      data-state={active ? 'active' : 'inactive'}
      onClick={() => ctx.setValue(value)}
      className={cn(
        'inline-flex h-7 flex-1 items-center justify-center whitespace-nowrap rounded-sm px-3 text-xs font-medium',
        'transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)]',
        'disabled:pointer-events-none disabled:opacity-50',
        active
          ? 'bg-[color:var(--background)] text-[color:var(--foreground)] shadow-sm'
          : 'hover:text-[color:var(--foreground)]',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

interface TabsContentProps extends HTMLAttributes<HTMLDivElement> {
  value: string;
}

export function TabsContent({ value, className, children, ...props }: TabsContentProps) {
  const ctx = useTabsContext('TabsContent');
  if (ctx.value !== value) return null;
  return (
    <div
      role="tabpanel"
      className={cn(
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
