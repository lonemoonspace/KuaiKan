// Development-build instrumentation, see lib/summary-timing.ts.
import { SUMMARY_TIMING_ENABLED, timingNow } from '@/lib/summary-timing';

/**
 * When this service worker instance started evaluating (cold start marker).
 * 0 in release builds, where nothing consumes it -- a timeline mark earlier
 * than the session origin is dropped, so the dead value is harmless.
 */
export const serviceWorkerStartedAt = SUMMARY_TIMING_ENABLED ? timingNow() : 0;

/** When the gpt-tokenizer module finished loading in this worker instance. */
export let tokenizerLoadedAt: number | null = null;

export function markTokenizerLoaded() {
  tokenizerLoadedAt ??= timingNow();
}
