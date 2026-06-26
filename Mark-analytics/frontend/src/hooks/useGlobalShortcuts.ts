import { useEffect } from 'react';
import { useUIStore } from '@/stores/ui';

/**
 * Registers global keyboard shortcuts:
 *   - Cmd+K (mac) / Ctrl+K (win/linux) → toggle search modal.
 *   - Cmd+J (mac) / Ctrl+J (win/linux) → toggle MK Analyst drawer
 *     (Track A of docs/aistart360/08-world-monitor-feature-parity.md §5).
 *
 * Esc handling inside the modal/drawer is delegated to Radix Dialog.
 *
 * We intentionally allow Cmd/Ctrl+K and Cmd/Ctrl+J to fire even when focus
 * is inside an input or textarea (this matches Linear/Notion/Raycast
 * behavior). Other future single-key shortcuts MUST guard with
 * `isEditableTarget`.
 */
export function useGlobalShortcuts(): void {
  const toggleSearchOpen = useUIStore((s) => s.toggleSearchOpen);
  const toggleAnalystOpen = useUIStore((s) => s.toggleAnalystOpen);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const key = event.key?.toLowerCase();
      const isModifier = event.metaKey || event.ctrlKey;

      if (isModifier && key === 'k') {
        // Cmd/Ctrl+K is reserved globally; never let the browser hijack it
        // (Chrome address bar focus on some platforms).
        event.preventDefault();
        toggleSearchOpen();
        return;
      }

      if (isModifier && key === 'j') {
        // Cmd/Ctrl+J opens MK Analyst. Browser's default (downloads / dev
        // tools jump) is unhelpful here, so we preventDefault.
        event.preventDefault();
        toggleAnalystOpen();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [toggleSearchOpen, toggleAnalystOpen]);
}

/**
 * Returns true if the event target is a form control where typing keystrokes
 * should not trigger app-wide single-key shortcuts.
 *
 * Cmd/Ctrl combos bypass this check by design.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export default useGlobalShortcuts;
