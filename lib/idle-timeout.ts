/**
 * Idle watchdog for the LLM stream.
 *
 * Providers can accept the connection and then stop producing frames entirely
 * (a wedged proxy, a saturated local Ollama, a gateway that silently drops
 * packets). Nothing in the AI SDK surfaces that as an error on its own, so the
 * panel would spin forever. This timer is armed before the request goes out,
 * reset on every frame the provider produces, and fires once when the stream
 * has been silent for too long.
 *
 * Kept as a tiny pure module so the timing behaviour can be unit tested without
 * a live model or a fake port.
 */
export const PROVIDER_IDLE_TIMEOUT_MS = 120_000;

export type IdleWatchdog = {
  /** (Re)start the countdown. Safe to call repeatedly. */
  reset: () => void;
  /** Cancel the countdown for good. */
  dispose: () => void;
};

export function createIdleWatchdog(
  timeoutMs: number,
  onTimeout: () => void,
): IdleWatchdog {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const reset = () => {
    if (disposed) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (disposed) return;
      onTimeout();
    }, timeoutMs);
  };

  const dispose = () => {
    disposed = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return { reset, dispose };
}
