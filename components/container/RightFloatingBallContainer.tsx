import React, { useRef, useState, useEffect } from 'react';
import { X } from 'lucide-react';
import useWxtStorage from '@/hooks/useWxtStorage';
import { cn } from '@/lib/utils';
import { getUiMessages } from '@/lib/i18n';
import { type StorageItemKey } from '#imports';

interface RightFloatingBallContainerProps {
  /**
   * The storage suffix key to persist the vertical position.
   * e.g., 'page' will save as 'local:right-floating-ball-top-page'.
   */
  storageKey?: string;
  
  /**
   * Additional tailwind classes for the container.
   */
  className?: string;
  
  /**
   * Initial close button visibility behavior (if you want to override default).
   */
  initClosedBtnHidden?: boolean;
  
  /**
   * Fired when the close button is clicked.
   */
  onClose?: () => void;
  
  /**
   * Contents of the floating ball.
   */
  children?: React.ReactNode;
}

const THRESHOLD = 16; // Padding from the viewport edges

export default function RightFloatingBallContainer({
  storageKey = 'page',
  className,
  onClose,
  children,
}: RightFloatingBallContainerProps) {
  const uiMessages = getUiMessages();
  const floatingBallRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);

  // Storage key: local:right-floating-ball-top-[key]
  const storageKeyFull = `local:right-floating-ball-top-${storageKey}` as StorageItemKey;
  const [positionY, setPositionY, isLoaded] = useWxtStorage<string>(storageKeyFull, '75%');

  // Drag coordinates tracing refs
  const dragStartRef = useRef({
    mouseX: 0,
    mouseY: 0,
    elementLeft: 0,
    elementTop: 0,
  });

  // Position positioning style applying when storage loads
  useEffect(() => {
    if (isLoaded && floatingBallRef.current && !isDraggingRef.current) {
      floatingBallRef.current.style.top = positionY;
    }
  }, [isLoaded, positionY]);

  // Common drag start
  const handleDragStart = (clientX: number, clientY: number) => {
    const el = floatingBallRef.current;
    if (!el) return;

    isDraggingRef.current = true;
    setIsDragging(true);

    // Capture starting state
    dragStartRef.current = {
      mouseX: clientX,
      mouseY: clientY,
      elementLeft: el.offsetLeft,
      elementTop: el.offsetTop,
    };

    // Ensure style properties are set in px for absolute movement
    el.style.left = `${el.offsetLeft}px`;
    el.style.right = 'auto';

    // Text selection is suppressed on our own element (see the render below)
    // rather than by adding `select-none` to the page's <body>: the extension's
    // Tailwind CSS is injected into its shadow root, so that class never
    // applies on a normal page -- and on a page that happens to use Tailwind it
    // would make the whole site unselectable.
  };

  // Common drag move
  const handleDragMove = (clientX: number, clientY: number) => {
    if (!isDraggingRef.current) return;
    const el = floatingBallRef.current;
    if (!el) return;

    const deltaX = clientX - dragStartRef.current.mouseX;
    const deltaY = clientY - dragStartRef.current.mouseY;

    let newX = dragStartRef.current.elementLeft + deltaX;
    let newY = dragStartRef.current.elementTop + deltaY;

    // Viewport dimensions
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const elW = el.offsetWidth;
    const elH = el.offsetHeight;

    // Boundary constraints
    newX = Math.max(THRESHOLD, Math.min(winW - elW - THRESHOLD, newX));
    newY = Math.max(THRESHOLD, Math.min(winH - elH - THRESHOLD, newY));

    // Update style directly for 60fps performance
    el.style.left = `${newX}px`;
    el.style.top = `${(100 * newY) / winH}%`;
  };

  // Common drag end
  const handleDragEnd = () => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDragging(false);

    const el = floatingBallRef.current;
    if (!el) return;

    // Snap to the right edge smoothly
    el.style.left = '';
    el.style.right = `${THRESHOLD}px`;

    // Persist new vertical position
    setPositionY(el.style.top);
  };

  // Pointer Events with pointer capture: every move/up/cancel comes back to this
  // element even when the pointer leaves the window or a touch is cancelled by
  // a system gesture. The previous document-level mousemove/mouseup pair (and a
  // touch pair without touchcancel) could miss the release entirely, leaving
  // the ball stuck in the dragging state with listeners still attached.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-close-btn]')) return;

    const el = floatingBallRef.current;
    if (!el) return;

    handleDragStart(e.clientX, e.clientY);
    el.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    handleDragMove(e.clientX, e.clientY);
  };

  const onPointerUpOrCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;

    try {
      floatingBallRef.current?.releasePointerCapture?.(e.pointerId);
    } catch {
      // Already released (e.g. the pointer was cancelled).
    }

    handleDragEnd();
  };

  if (!isLoaded) return null;

  return (
    <div
      ref={floatingBallRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUpOrCancel}
      onPointerCancel={onPointerUpOrCancel}
      style={{
        right: `${THRESHOLD}px`,
        cursor: isDragging ? 'grabbing' : 'grab',
        touchAction: 'none',
      }}
      className={cn(
        'fixed z-50 group flex items-center justify-center rounded-full select-none',
        // Suppress selection only while dragging, and only on our own element.
        isDragging && 'select-none',
        // Enable smooth sliding transition when not actively dragging
        !isDragging && 'transition-all duration-300 cubic-bezier(0.16, 1, 0.3, 1)',
        className
      )}
    >
      {/* Close button with premium hover animation */}
      <button
        data-close-btn
        onClick={(e) => {
          e.stopPropagation();
          onClose?.();
        }}
        className="absolute -top-1 -left-1 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-zinc-800/90 hover:bg-zinc-950 text-white shadow-md backdrop-blur-sm transition-all duration-200 opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100"
        title={uiMessages.content.hideFloatingBall}
        type="button"
      >
        <X size={10} strokeWidth={3} />
      </button>

      {/* Embedded Floating Ball Content */}
      {children}
    </div>
  );
}
