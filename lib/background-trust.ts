import { browser } from 'wxt/browser';

/**
 * Every background message handler must come from this extension.
 *
 * Web pages and other extensions cannot reach these handlers today — the
 * manifest declares no `externally_connectable`, so `runtime.onMessage` and
 * `runtime.onConnect` only see this extension's own contexts. The check is
 * defence in depth: it keeps that property explicit at each entry point instead
 * of resting on a manifest field that a future change could add, and it makes
 * the trust boundary auditable in one place. The payloads are powerful — the
 * connect bridge runs an LLM request with the user's key and an
 * attacker-chosen system prompt.
 *
 * Typed structurally on purpose: `@webext-core/messaging` hands the polyfill's
 * `MessageSender`, while `port.sender` is WXT's, and both carry `id`.
 */
type SenderLike = { id?: string } | undefined;

export function isTrustedSender(sender: SenderLike): boolean {
  return sender?.id === browser.runtime.id;
}

/**
 * Throw for a message that did not come from this extension.
 *
 * Throwing (rather than returning a fabricated value) keeps the handler
 * signatures honest and surfaces the rejection to whatever asked — which, for
 * an untrusted caller, is exactly the outcome we want.
 */
export function assertTrustedSender(sender: SenderLike): void {
  if (!isTrustedSender(sender)) {
    throw new Error('Message rejected: the sender is not this extension.');
  }
}
