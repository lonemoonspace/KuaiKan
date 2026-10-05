import React, { RefObject, useEffect, useRef } from 'react';

type ResizeDirection =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'topRight'
  | 'bottomRight'
  | 'bottomLeft'
  | 'topLeft';

interface UseResizableProps<T extends HTMLElement> {
  targetRef: RefObject<T | null>;
  enabled?: boolean;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
}

export function useResizable<T extends HTMLElement>({ 
  targetRef, 
  enabled = true,
  onResizeStart,
  onResizeEnd
}: UseResizableProps<T>) {
  const isResizingRef = useRef(false);
  const startMouse = useRef({ x: 0, y: 0 });
  const startDim = useRef({ width: 0, height: 0, left: 0, top: 0 });
  const resizeDir = useRef<ResizeDirection>('bottomRight');
  const limits = useRef({ minW: 0, maxW: Infinity, minH: 0, maxH: Infinity });

  const startResize = (event: React.PointerEvent, direction: ResizeDirection) => {
    if (!enabled || !targetRef.current || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();

    isResizingRef.current = true;
    startMouse.current = { x: event.clientX, y: event.clientY };

    const el = targetRef.current;

    startDim.current = {
      width: el.offsetWidth,
      height: el.offsetHeight,
      left: el.offsetLeft,
      top: el.offsetTop,
    };
    resizeDir.current = direction;

    const computed = window.getComputedStyle(el);
    limits.current = {
      minW: parseFloat(computed.minWidth) || 0,
      maxW: parseFloat(computed.maxWidth) || Infinity,
      minH: parseFloat(computed.minHeight) || 0,
      maxH: parseFloat(computed.maxHeight) || Infinity,
    };

    if (onResizeStart) onResizeStart();

    // Drop any previous pair before registering a new one, then record how to
    // remove exactly these handlers later.
    detach();
    const onMove = resize;
    const onUp = stopResize;
    // Pointer Events (not mouse events) so touch/pen resizing works at all, and
    // `pointercancel` -- which the browser fires when it takes the gesture over
    // for scrolling or a system gesture -- ends the resize instead of leaving
    // the panel stuck mid-drag with listeners still attached.
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    detachRef.current = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
  };

  const rafRef = useRef<number | null>(null);

  const resize = (event: PointerEvent) => {
    if (!isResizingRef.current || !targetRef.current) return;
    
    // Calculate new dimensions immediately to avoid stale event data
    const diffX = event.clientX - startMouse.current.x;
    const diffY = event.clientY - startMouse.current.y;
    const dir = resizeDir.current;
    
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(() => {
      const el = targetRef.current;
      if (!el) return;

      const { minW, maxW, minH, maxH } = limits.current;

      let newW = startDim.current.width;
      let newH = startDim.current.height;
      let widthChanged = false;

      if (dir === 'right' || dir === 'bottomRight' || dir === 'topRight') {
        newW = startDim.current.width + diffX;
        newW = Math.max(minW, Math.min(newW, maxW));
        el.style.width = `${newW}px`;
        widthChanged = true;
      }
      if (dir === 'left' || dir === 'bottomLeft' || dir === 'topLeft') {
        newW = startDim.current.width - diffX;
        newW = Math.max(minW, Math.min(newW, maxW));
        el.style.width = `${newW}px`;
        widthChanged = true;
      }
      if (dir === 'bottom' || dir === 'bottomRight' || dir === 'bottomLeft') {
        newH = startDim.current.height + diffY;
        newH = Math.max(minH, Math.min(newH, maxH));
        el.style.height = `${newH}px`;
      }
      if (dir === 'top' || dir === 'topRight' || dir === 'topLeft') {
        newH = startDim.current.height - diffY;
        newH = Math.max(minH, Math.min(newH, maxH));
        el.style.height = `${newH}px`;
        // Keep the bottom edge pinned: growing upward must move the top edge up
        // by the same amount. This branch used to change only the height, so a
        // top handle silently detached from the pointer (no such handle is
        // rendered today -- the panel offers bottom/left/bottomLeft only).
        el.style.top = `${startDim.current.top + (startDim.current.height - newH)}px`;
      }

      // Dynamic Content Constraint: physically stop shrinking if children are overflowing
      if (widthChanged) {
        const content = el.lastElementChild as HTMLElement;
        if (content && content.scrollWidth > Math.ceil(content.clientWidth)) {
          const contentWidth = content.scrollWidth + (el.offsetWidth - el.clientWidth);
          // Clamp against the same limits the drag obeyed: the content-driven
          // width can exceed the viewport cap, which used to leave the panel
          // wider than the window.
          el.style.width = `${Math.max(minW, Math.min(contentWidth, maxW))}px`;
        }
      }
    });
  };

  const stopResize = () => {
    isResizingRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (onResizeEnd) onResizeEnd();
    detach();
  };

  // `resize`/`stopResize` are new function identities on every render, so the
  // unmount cleanup below could never remove the pair that `startResize`
  // actually registered. Remember the live pair in a ref and detach that.
  const detachRef = useRef<(() => void) | null>(null);

  const detach = () => {
    detachRef.current?.();
    detachRef.current = null;
  };

  useEffect(() => {
    // Unmounting mid-drag (SPA navigation invalidating the content-script
    // context, or the host element being removed) must not leave document-level
    // listeners behind.
    return () => detach();
  }, []);

  return { startResize };
}

interface UseDraggableProps<T extends HTMLElement> {
  targetRef: RefObject<T | null>;
  enabled?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export function useDraggable<T extends HTMLElement>({ 
  targetRef, 
  enabled = true,
  onDragStart,
  onDragEnd
}: UseDraggableProps<T>) {
  const isDraggingRef = useRef(false);
  const startMouse = useRef({ x: 0, y: 0 });
  const startPos = useRef({ left: 0, top: 0 });
  const THRESHOLD = 10;

  const startDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (!enabled || !targetRef.current || event.button !== 0) return;

    const target = event.target as HTMLElement;
    const dragHandle = target.closest('[data-drag-handle]');
    if (!dragHandle) return;

    const controlEl = target.closest('button, select, input, textarea, a');
    if (controlEl) return;

    startMouse.current = { x: event.clientX, y: event.clientY };
    const rect = targetRef.current.getBoundingClientRect();
    startPos.current = { left: rect.left, top: rect.top };
    isDraggingRef.current = true;

    // Pointer capture keeps the drag alive when the pointer leaves the window
    // (a mouse released over the browser chrome used to leave `isDragging` set
    // and the panel following the cursor) and is what makes touch/pen dragging
    // possible. Best-effort: capture throws if the pointer id is already gone.
    const captureTarget = event.currentTarget;
    const pointerId = event.pointerId;
    try {
      captureTarget.setPointerCapture(pointerId);
    } catch {
      // Capture is an optimisation; the document-level listeners below still
      // drive the drag without it.
    }

    if (onDragStart) onDragStart();

    detach();
    const onMove = drag;
    const onUp = endDrag;
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    detachRef.current = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      if (captureTarget.hasPointerCapture?.(pointerId)) {
        captureTarget.releasePointerCapture(pointerId);
      }
    };
  };

  const drag = (event: PointerEvent) => {
    if (!isDraggingRef.current || !targetRef.current) return;
    const el = targetRef.current;
    
    const clientWidth = document.documentElement.clientWidth;
    const clientHeight = document.documentElement.clientHeight;
    const elementWidth = el.clientWidth;
    
    let newX = startPos.current.left + (event.clientX - startMouse.current.x);
    let newY = startPos.current.top + (event.clientY - startMouse.current.y);

    if (newX < 0) newX = 0;
    else if (newX + elementWidth + THRESHOLD > clientWidth) {
      newX = clientWidth - elementWidth - THRESHOLD;
    }

    const HEADER_HEIGHT = 50; // Ensure header is visible
    if (newY < 0) newY = 0;
    else if (newY + HEADER_HEIGHT > clientHeight) {
      newY = clientHeight - HEADER_HEIGHT;
    }

    const newRight = clientWidth - (newX + elementWidth);

    el.style.right = `${newRight}px`;
    el.style.top = `${newY}px`;
    el.style.left = 'auto';
    el.style.bottom = 'auto';
    el.style.transform = 'none';
  };

  const endDrag = () => {
    isDraggingRef.current = false;
    if (onDragEnd) onDragEnd();
    detach();
  };

  // Same identity problem as useResizable: remember the registered pair so the
  // unmount cleanup can actually remove it.
  const detachRef = useRef<(() => void) | null>(null);

  const detach = () => {
    detachRef.current?.();
    detachRef.current = null;
  };

  useEffect(() => {
    return () => detach();
  }, []);

  return { startDrag };
}
