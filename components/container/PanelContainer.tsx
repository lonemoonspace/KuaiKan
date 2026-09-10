import React, { useRef, useEffect } from 'react';
import { useResizable, useDraggable } from './internal/interactions';
import useWxtStorage from '@/hooks/useWxtStorage';
import { type StorageItemKey } from '#imports';

interface PanelContainerProps {
  children: React.ReactNode;
  storageKey?: string | null;
}

type FloatingState = { width: number; height: number; left: string; top: string; right: string; bottom: string };

function UnifiedPanelRenderer({ children, storageKey }: { children: React.ReactNode, storageKey?: string | null }) {
  const containerRef = useRef<HTMLDivElement>(null);

  const floatingStateKey = storageKey ? (`local:${storageKey}-floating-state` as StorageItemKey) : null;

  const [floatingState, setFloatingState, isFloatingLoaded] = useWxtStorage<FloatingState | null>(floatingStateKey, null);

  const saveFloatingState = () => {
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
  };

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
    } else {
      el.style.width = '30em';
      el.style.height = '36em';
      el.style.left = '';
      el.style.top = '4em';
      el.style.right = '4em';
      el.style.bottom = '';
    }
    el.style.transform = 'none';
  }, [isFloatingLoaded, floatingState]);

  if (!isFloatingLoaded) return null;

  return (
    <div
      ref={containerRef}
      onMouseDown={startDrag}
      className="flex flex-col z-[2147483647] fixed bg-background rounded-xl shadow-[0_12px_48px_rgba(0,0,0,0.12)] border border-zinc-200/60 max-w-[100vw] max-h-[100vh] min-w-[384px] min-h-[224px]"
    >
      <div className="absolute bottom-0 left-0 w-full h-1.5 cursor-ns-resize z-50" onMouseDown={(e) => startResize(e, 'bottom')} />
      <div className="absolute top-0 left-0 w-1.5 h-full cursor-ew-resize z-50" onMouseDown={(e) => startResize(e, 'left')} />
      <div className="absolute bottom-0 left-0 w-3 h-3 cursor-sw-resize z-50" onMouseDown={(e) => startResize(e, 'bottomLeft')} />

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
