// Minimal stand-in for `@webext-core/messaging`'s `defineExtensionMessaging`.
//
// The real package imports `webextension-polyfill` at module scope, which
// throws immediately ("This script should only be loaded in a browser
// extension") outside a real extension context -- so anything that transitively
// imports lib/messaging.ts (which calls `defineExtensionMessaging()` at
// module scope) cannot be loaded under plain Node/vitest without this stub.
//
// Nothing under test actually sends/receives real messages through this, so
// the stub just needs to exist and not throw on import/call.

export function defineExtensionMessaging<_T = unknown>() {
  return {
    sendMessage: async () => {
      throw new Error('sendMessage() is not implemented in the vitest stub for @webext-core/messaging');
    },
    onMessage: (_type: string, _handler: (...args: any[]) => unknown) => {
      return () => {};
    },
  };
}
