import { afterEach, describe, expect, it, vi } from 'vitest';
import { beginSummaryTiming, mergeBackgroundTiming } from '@/lib/summary-timing';

// SUMMARY_TIMING_ENABLED is `import.meta.env.DEV`, which vitest (running
// through vite) evaluates to true, so these entry points behave as in a dev
// build.
describe('summary-timing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports exactly once after the final background frame, not on the first', () => {
    const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});

    beginSummaryTiming();
    mergeBackgroundTiming({ 后台收到请求: performance.timeOrigin + performance.now() }, false);
    expect(tableSpy).not.toHaveBeenCalled();

    mergeBackgroundTiming({ 后台发起模型请求: performance.timeOrigin + performance.now() }, true);
    expect(tableSpy).toHaveBeenCalledTimes(1);

    // A later call (e.g. a stray duplicate frame) must not re-report.
    mergeBackgroundTiming({ 后台发起模型请求: performance.timeOrigin + performance.now() }, true);
    expect(tableSpy).toHaveBeenCalledTimes(1);
  });
});
