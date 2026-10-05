import { useEffect } from 'react';
import { useBlocker } from 'react-router';

/**
 * Ask before navigating away from a form with unsaved edits.
 *
 * Both editors save only on submit, while the layout's back button and the
 * sidebar links navigate unconditionally — a half-edited prompt, or a partially
 * typed API key, used to disappear without a word.
 *
 * `shouldBlock` is a predicate rather than a boolean so the decision is made at
 * navigation time from the caller's latest state (a submit that is about to
 * navigate away must be allowed through, and a failed submit must re-arm the
 * guard).
 */
export function useUnsavedChangesGuard(shouldBlock: () => boolean, message: string) {
  const blocker = useBlocker(shouldBlock);

  useEffect(() => {
    if (blocker.state !== 'blocked') return;

    if (window.confirm(message)) blocker.proceed();
    else blocker.reset();
  }, [blocker, message]);

  // `useBlocker` only sees in-app (react-router) navigations. Closing the tab,
  // reloading, or typing another URL bypasses it entirely, so a half-typed API
  // key used to disappear without any prompt. A `beforeunload` listener covers
  // those exits; the browser prints its own generic confirmation, so `message`
  // is deliberately not used here.
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!shouldBlock()) return;

      event.preventDefault();
      // Chrome only shows the confirmation when `returnValue` is set.
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [shouldBlock]);
}
