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
      el.style.width = `${floatingState.width}px`;
      el.style.height = `${floatingState.height}px`;
      el.style.left = floatingState.left || '';
      el.style.top = floatingState.top || '';
      el.style.right = floatingState.right || '';
      el.style.bottom = floatingState.bottom || '';

      // A position saved on another monitor / window size can land the panel
      // outside the viewport with no handle to drag it back. If the header is
      // not reachable, fall back to the default anchor (keeping the size).
      if (!isHeaderReachable(el)) {
        el.style.left = '';
        el.style.top = '4em';
        el.style.right = '4em';
        el.style.bottom = '';
      }
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
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !isFloatingLoaded || !floatingState) return;

    let frame = 0;
    const keepReachable = () => {
      frame = 0;

      const maxWidth = document.documentElement.clientWidth;
      const maxHeight = document.documentElement.clientHeight;

      let corrected = false;
      if (el.offsetWidth > maxWidth) {
        el.style.width = `${maxWidth}px`;
        corrected = true;
      }
      if (el.offsetHeight > maxHeight) {
        el.style.height = `${maxHeight}px`;
        corrected = true;
      }

      if (!isHeaderReachable(el)) {
        el.style.left = '';
        el.style.top = '4em';
        el.style.right = '4em';
        el.style.bottom = '';
        corrected = true;
      }

      // Persist the correction. The snapshot is reused across window sizes, so
      // without writing it back the panel snapped straight back to the
      // unreachable geometry on the next load and had to be rescued again.
      if (corrected) saveFloatingState();
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
  }, [isFloatingLoaded, floatingState, saveFloatingState]);

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
