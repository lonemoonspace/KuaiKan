import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// Kept separate from wxt.config.ts's vite config: WXT's own vite plugin
// resolves the '#imports' virtual module (auto-imports) at build time, which
// isn't available under plain vitest. We alias it to a tiny local stub
// instead (see test/mocks/imports.ts) so pure-function modules that merely
// import `storage` from '#imports' can be loaded without pulling in WXT's
// build pipeline.
export default defineConfig({
  test: {
    // `node` because the current suites are pure logic plus an in-memory
    // storage stub; component tests would need jsdom/happy-dom added here.
    environment: 'node',
    // `.tsx` as well as `.ts`: tsconfig already type-checks both, and a `.tsx`
    // suite that silently never ran was the worst kind of drift (green gate,
    // zero coverage).
    include: ['test/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      '#imports': fileURLToPath(new URL('./test/mocks/imports.ts', import.meta.url)),
      'wxt/browser': fileURLToPath(new URL('./test/mocks/wxt-browser.ts', import.meta.url)),
      '@webext-core/messaging': fileURLToPath(
        new URL('./test/mocks/webext-core-messaging.ts', import.meta.url),
      ),
    },
  },
});
