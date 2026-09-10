// Minimal stand-in for WXT's virtual `#imports` module, used only so that
// files which import `storage` from '#imports' (e.g. lib/logger.ts,
// lib/site-rules-storage.ts) can be loaded under vitest/Node without pulling
// in the real browser.storage.local bridge.
//
// Kept intentionally tiny: none of the pure functions under test in
// test/lib/** or test/background/** actually read/write through `storage` at
// the paths we exercise, so no-op stubs are sufficient. If a future test
// needs real persistence behaviour, extend this (or mock per-test) instead of
// growing this file into a full storage emulator.

export const storage = {
  watch: (_key: string, _callback: (newValue: unknown, oldValue: unknown) => void) => {
    return () => {};
  },
  getItem: async <T = unknown>(_key: string): Promise<T | null> => null,
  setItem: async (_key: string, _value: unknown): Promise<void> => {},
  removeItem: async (_key: string): Promise<void> => {},
  getItems: async (_keys: string[]): Promise<unknown[]> => [],
};
