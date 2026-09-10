// Minimal in-memory stand-in for `wxt/browser`'s `browser.storage.local`,
// used only to exercise lib/migration.ts's `runFullMigration()` under
// vitest/Node without a real extension storage backend.
//
// This intentionally mirrors just the slice of the chrome.storage.local API
// that runFullMigration() calls: get(null | string | string[]), set(items),
// remove(keys). Extend it only if a future test needs more.

type StorageData = Record<string, unknown>;

let store: StorageData = {};

export function __resetMockStorage(initial: StorageData = {}) {
  store = { ...initial };
}

export function __getMockStorage(): StorageData {
  return { ...store };
}

export const browser = {
  storage: {
    local: {
      get: async (keys?: null | string | string[]): Promise<StorageData> => {
        if (keys == null) return { ...store };
        const keyList = Array.isArray(keys) ? keys : [keys];
        const result: StorageData = {};
        for (const key of keyList) {
          if (key in store) result[key] = store[key];
        }
        return result;
      },
      set: async (items: StorageData): Promise<void> => {
        store = { ...store, ...items };
      },
      remove: async (keys: string | string[]): Promise<void> => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const key of keyList) {
          delete store[key];
        }
      },
    },
  },
};
