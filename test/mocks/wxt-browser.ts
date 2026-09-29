// Minimal in-memory stand-in for `wxt/browser`, used to exercise pure modules
// that talk to extension APIs under vitest/Node without a real extension
// backend.
//
// `storage.local` mirrors just the slice of chrome.storage.local that
// lib/migration.ts's `runFullMigration()` calls: get(null | string | string[]),
// set(items), remove(keys). `runtime.connect` returns a MockPort so the AI SDK
// bridge transport can be driven frame by frame. Extend either only when a
// future test needs more.

type StorageData = Record<string, unknown>;

let store: StorageData = {};

export function __resetMockStorage(initial: StorageData = {}) {
  store = { ...initial };
}

export function __getMockStorage(): StorageData {
  return { ...store };
}

/**
 * Stand-in for a `browser.runtime.Port`: only the surface the transport touches
 * is implemented (both event objects, `postMessage`, `disconnect`), plus the
 * test-side helpers `emitMessage` / `emitDisconnect`.
 *
 * The listener hooks are arrow-function properties on purpose: a real
 * `port.onMessage.addListener(fn)` binds `this` to `onMessage`, which would
 * break instance-field access from a plain method.
 */
export class MockPort {
  readonly posted: unknown[] = [];
  disconnected = false;

  private readonly messageListeners: Array<(message: unknown) => void> = [];
  private readonly disconnectListeners: Array<() => void> = [];

  readonly onMessage = {
    addListener: (listener: (message: unknown) => void) => {
      this.messageListeners.push(listener);
    },
    removeListener: (listener: (message: unknown) => void) => {
      const index = this.messageListeners.indexOf(listener);
      if (index >= 0) this.messageListeners.splice(index, 1);
    },
  };

  readonly onDisconnect = {
    addListener: (listener: () => void) => {
      this.disconnectListeners.push(listener);
    },
    removeListener: (listener: () => void) => {
      const index = this.disconnectListeners.indexOf(listener);
      if (index >= 0) this.disconnectListeners.splice(index, 1);
    },
  };

  postMessage(message: unknown) {
    this.posted.push(message);
  }

  disconnect() {
    this.disconnected = true;
    this.emitDisconnect();
  }

  /** Test helper: deliver a background frame to the current listeners. */
  emitMessage(message: unknown) {
    for (const listener of [...this.messageListeners]) listener(message);
  }

  /** Test helper: simulate the other side closing the port. */
  emitDisconnect() {
    for (const listener of [...this.disconnectListeners]) listener();
  }

  get listenerCount(): number {
    return this.messageListeners.length + this.disconnectListeners.length;
  }
}

let portFactory: () => MockPort = () => new MockPort();

/** Point `browser.runtime.connect()` at one port instance for a test. */
export function __setMockPortFactory(factory: () => MockPort) {
  portFactory = factory;
}

let failNextRemove = false;

/** Make the next `storage.local.remove()` reject, for failure-path tests. */
export function __failNextStorageRemove() {
  failNextRemove = true;
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
        if (failNextRemove) {
          failNextRemove = false;
          throw new Error('mock storage remove failed');
        }

        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const key of keyList) {
          delete store[key];
        }
      },
    },
  },
  runtime: {
    connect: () => portFactory(),
  },
};
