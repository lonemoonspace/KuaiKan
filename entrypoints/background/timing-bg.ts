// TEMPORARY instrumentation, see lib/summary-timing.ts.
import { timingNow } from '@/lib/summary-timing';

/** When this service worker instance started evaluating (cold start marker). */
export const serviceWorkerStartedAt = timingNow();

/** When the gpt-tokenizer module finished loading in this worker instance. */
export let tokenizerLoadedAt: number | null = null;

export function markTokenizerLoaded() {
  tokenizerLoadedAt ??= timingNow();
}
