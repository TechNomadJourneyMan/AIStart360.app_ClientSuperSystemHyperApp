import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Search as SearchIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * shadcn-style Command primitives built on top of `cmdk` + Radix Dialog.
 * Used by SearchModal to render an accessible Cmd+K palette.
 */

const Command = forwardRef<
  ElementRef<typeof CommandPrimitive>,
  ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      'flex h-full w-full flex-col overflow-hidden rounded-md',
      'bg-[color:var(--popover)] text-[color:var(--popover-foreground)]',
      className,
    )}
    {...props}
  />
));
Command.displayName = CommandPrimitive.displayName;

type DialogRootProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Root>;

interface CommandDialogProps extends DialogRootProps {
  children: ReactNode;
  ariaLabel?: string;
}

function CommandDialog({ children, ariaLabel, ...props }: CommandDialogProps) {
  return (
    <DialogPrimitive.Root {...props}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-black/60 backdrop-blur-sm',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          )}
        />
        <DialogPrimitive.Content
          aria-label={ariaLabel ?? 'Command palette'}
          className={cn(
            'fixed left-1/2 top-[20%] z-50 w-[95vw] max-w-[640px]',
            '-translate-x-1/2 overflow-hidden rounded-lg border',
            'border-[color:var(--border)] bg-[color:var(--popover)]',
            'text-[color:var(--popover-foreground)] shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            {ariaLabel ?? 'Search'}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Global search across companies, persons, and tenders.
          </DialogPrimitive.Description>
          <Command
            className={cn(
              '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5',
              '[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold',
              '[&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider',
              '[&_[cmdk-group-heading]]:text-[color:var(--muted-foreground)]',
              '[&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2',
              '[&_[cmdk-item]_svg]:h-4 [&_[cmdk-item]_svg]:w-4',
              '[&_[cmdk-input-wrapper]_svg]:h-4 [&_[cmdk-input-wrapper]_svg]:w-4',
            )}
          >
            {children}
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

interface CommandInputProps
  extends ComponentPropsWithoutRef<typeof CommandPrimitive.Input> {
  loading?: boolean;
  rightSlot?: ReactNode;
}

const CommandInput = forwardRef<
  ElementRef<typeof CommandPrimitive.Input>,
  CommandInputProps
>(({ className, loading, rightSlot, ...props }, ref) => (
  <div
    className={cn(
      'flex items-center gap-2 border-b border-[color:var(--border)] px-3',
    )}
    {...({ 'cmdk-input-wrapper': '' } as Record<string, string>)}
  >
    <SearchIcon
      className="h-4 w-4 shrink-0 text-[color:var(--muted-foreground)]"
      aria-hidden
    />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        'flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none',
        'placeholder:text-[color:var(--muted-foreground)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
    {loading ? (
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full',
          'border-2 border-[color:var(--muted-foreground)] border-t-transparent',
        )}
        aria-label="Loading"
        role="status"
      />
    ) : null}
    {rightSlot}
  </div>
));
CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = forwardRef<
  ElementRef<typeof CommandPrimitive.List>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn(
      'max-h-[420px] overflow-y-auto overflow-x-hidden p-1',
      className,
    )}
    {...props}
  />
));
CommandList.displayName = CommandPrimitive.List.displayName;

const CommandEmpty = forwardRef<
  ElementRef<typeof CommandPrimitive.Empty>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className="py-8 text-center text-xs text-[color:var(--muted-foreground)]"
    {...props}
  />
));
CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

const CommandGroup = forwardRef<
  ElementRef<typeof CommandPrimitive.Group>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      'overflow-hidden p-1 text-[color:var(--foreground)]',
      className,
    )}
    {...props}
  />
));
CommandGroup.displayName = CommandPrimitive.Group.displayName;

const CommandSeparator = forwardRef<
  ElementRef<typeof CommandPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 h-px bg-[color:var(--border)]', className)}
    {...props}
  />
));
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

const CommandItem = forwardRef<
  ElementRef<typeof CommandPrimitive.Item>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5',
      'text-sm outline-none',
      'data-[selected=true]:bg-[color:var(--accent)]',
      'data-[selected=true]:text-[color:var(--accent-foreground)]',
      'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
      className,
    )}
    {...props}
  />
));
CommandItem.displayName = CommandPrimitive.Item.displayName;

function CommandShortcut({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'ml-auto text-[10px] tracking-widest text-[color:var(--muted-foreground)]',
        className,
      )}
      {...props}
    />
  );
}
CommandShortcut.displayName = 'CommandShortcut';

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
};
