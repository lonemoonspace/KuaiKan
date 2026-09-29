import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIdleWatchdog } from '@/lib/idle-timeout';

describe('createIdleWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not fire before the timeout elapses', () => {
    const onTimeout = vi.fn();
    const watchdog = createIdleWatchdog(1000, onTimeout);

    watchdog.reset();
    vi.advanceTimersByTime(999);

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('fires once the stream has been silent for the whole timeout', () => {
    const onTimeout = vi.fn();
    const watchdog = createIdleWatchdog(1000, onTimeout);

    watchdog.reset();
    vi.advanceTimersByTime(1000);

    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('restarts the countdown on every reset, so an active stream never times out', () => {
    const onTimeout = vi.fn();
    const watchdog = createIdleWatchdog(1000, onTimeout);

    watchdog.reset();
    for (let i = 0; i < 5; i += 1) {
      vi.advanceTimersByTime(900);
      watchdog.reset();
    }

    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('fires only once even if time keeps passing', () => {
    const onTimeout = vi.fn();
    const watchdog = createIdleWatchdog(1000, onTimeout);

    watchdog.reset();
    vi.advanceTimersByTime(10_000);

    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('never fires after dispose', () => {
    const onTimeout = vi.fn();
    const watchdog = createIdleWatchdog(1000, onTimeout);

    watchdog.reset();
    watchdog.dispose();
    vi.advanceTimersByTime(10_000);

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('ignores resets after dispose', () => {
    const onTimeout = vi.fn();
    const watchdog = createIdleWatchdog(1000, onTimeout);

    watchdog.dispose();
    watchdog.reset();
    vi.advanceTimersByTime(10_000);

    expect(onTimeout).not.toHaveBeenCalled();
  });
});
