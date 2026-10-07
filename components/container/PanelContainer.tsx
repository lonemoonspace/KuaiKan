import React, { useRef, useEffect, useCallback } from 'react';
import { useResizable, useDraggable } from './internal/interactions';
import useWxtStorage from '@/hooks/useWxtStorage';
import { type StorageItemKey } from '#imports';

interface PanelContainerProps {
  children: React.ReactNode;
  storageKey?: string | null;
}

type FloatingState = { width: number; height: number; left: string; top: string; right: string; bottom: string };

const MIN_VISIBLE_HEADER = 50;

// Default size in the panel's px-based reference unit (em here would follow
// whatever font-size the element inherits). 34 units ≈ 30 Chinese characters
// per line of summary text.
const DEFAULT_PANEL_WIDTH = 'calc(34 * var(--webpage-summary-panel-srem))';
const DEFAULT_PANEL_HEIGHT = 'calc(36 * var(--webpage-summary-panel-srem))';

function isHeaderReachable(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  return (
    rect.top >= 0 &&
    rect.top + MIN_VISIBLE_HEADER <= viewportHeight &&
    rect.left + MIN_VISIBLE_HEADER <= viewportWidth &&
    rect.right >= MIN_VISIBLE_HEADER
  );
}

/**
 * Put the saved geometry back on the panel, shrunk to fit the current
 * viewport. A position saved on another monitor / window size can land the
 * panel outside the viewport with no handle to drag it back; if the header is
 * not reachable, fall back to the default anchor (keeping the size).
 */
function applyFloatingState(el: HTMLElement, state: FloatingState) {
  const maxWidth = document.documentElement.clientWidth;
  const maxHeight = document.documentElement.clientHeight;

  el.style.width = `${Math.min(state.width, maxWidth)}px`;
  el.style.height = `${Math.min(state.height, maxHeight)}px`;
  el.style.left = state.left || '';
  el.style.top = state.top || '';
  el.style.right = state.right || '';
  el.style.bottom = state.bottom || '';

  if (!isHeaderReachable(el)) {
    el.style.left = '';
    el.style.top = '4em';
    el.style.right = '4em';
    el.style.bottom = '';
  }
}

function UnifiedPanelRenderer({ children, storageKey }: { children: React.ReactNode, storageKey?: string | null }) {
  const containerRef = useRef<HTMLDivElement>(null);

  const floatingStateKey = storageKey ? (`local:${storageKey}-floating-state` as StorageItemKey) : null;

  const [floatingState, setFloatingState, isFloatingLoaded] = useWxtStorage<FloatingState | null>(floatingStateKey, null);

  const saveFloatingState = useCallback(() => {
    if (containerRef.current) {
      const el = containerRef.current;
      setFloatingState({
        width: el.offsetWidth,
        height: el.offsetHeight,
        left: el.style.left,
        top: el.style.top,
        right: el.style.right,
        bottom: el.style.bottom,
      });
    }
  }, [setFloatingState]);

  const { startDrag } = useDraggable({
    targetRef: containerRef,
    onDragEnd: saveFloatingState
  });

  const { startResize } = useResizable({
    targetRef: containerRef,
    onResizeEnd: saveFloatingState
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !isFloatingLoaded) return;

    if (floatingState) {
      applyFloatingState(el, floatingState);
    } else {
      el.style.width = DEFAULT_PANEL_WIDTH;
      el.style.height = DEFAULT_PANEL_HEIGHT;
      el.style.left = '';
      el.style.top = '4em';
      el.style.right = '4em';
      el.style.bottom = '';
    }
    el.style.transform = 'none';
  }, [isFloatingLoaded, floatingState]);

  // A position that was reachable when it was saved can end up outside the
  // viewport once the window shrinks (the snapshot is in px and is reused
  // across window sizes). The check above only runs when the snapshot is
  // applied, so without this the panel became unreachable until a reload.
  //
  // The correction is display-only and always starts from the saved geometry:
  // persisting it (as an earlier version did) let a temporary shrink — a
  // half-screen snap, docked DevTools — permanently overwrite the user's panel
  // size and position, and wrote storage on every resize frame. Loading
  // re-runs the same rescue, so the saved snapshot never has to be rewritten.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !isFloatingLoaded || !floatingState) return;

    let frame = 0;
    const keepReachable = () => {
      frame = 0;
      applyFloatingState(el, floatingState);
    };

    const handleResize = () => {
      if (frame) return;
      // rAF-coalesced: a resize drag fires this continuously.
      frame = requestAnimationFrame(keepReachable);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [isFloatingLoaded, floatingState]);

  if (!isFloatingLoaded) return null;

  return (
    <div
      ref={containerRef}
      onPointerDown={startDrag}
      className="flex flex-col z-[2147483647] fixed bg-background rounded-xl shadow-[0_12px_48px_rgba(0,0,0,0.14)] border border-border max-w-[100vw] max-h-[100vh] min-w-[384px] min-h-[224px]"
    >
      <div className="absolute bottom-0 left-0 w-full h-1.5 cursor-ns-resize z-50 touch-none" onPointerDown={(e) => startResize(e, 'bottom')} />
      <div className="absolute top-0 left-0 w-1.5 h-full cursor-ew-resize z-50 touch-none" onPointerDown={(e) => startResize(e, 'left')} />
      <div className="absolute bottom-0 left-0 w-3 h-3 cursor-sw-resize z-50 touch-none" onPointerDown={(e) => startResize(e, 'bottomLeft')} />

      {children}
    </div>
  );
}

export function PanelContainer({ children, storageKey }: PanelContainerProps) {
  return (
    <UnifiedPanelRenderer storageKey={storageKey}>
      {children}
    </UnifiedPanelRenderer>
  );
}
