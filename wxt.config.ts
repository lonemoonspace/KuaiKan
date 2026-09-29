import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'wxt';
import { visualizer } from 'rollup-plugin-visualizer';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  hooks: {
    'build:manifestGenerated': (wxt, manifest) => {
      if (wxt.config.mode === 'development') {
        // console.log('manifest',manifest)
        manifest.name = `(DEV-${wxt.config.browser})KuaiKan 快看: AI网页总结 | 开源 | 轻量 | 隐私无忧`;
      }
    },
  },
  manifest: {
    name: 'KuaiKan 快看: AI网页总结 | 开源 | 轻量 | 隐私无忧',
    description: '(开源) KuaiKan 快看插件, 快捷AI总结页面, 支持定制提示词/接入任意大模型API, 轻量无服务纯插件, 隐私无忧',
    host_permissions: ['<all_urls>'],
    // `activeTab` and `scripting` are gone: with `<all_urls>` the first added
    // nothing, and the only `scripting` use (probing whether the panel's shadow
    // root had mounted) now asks the content script directly with `ping`.
    permissions: ['storage', 'contextMenus', 'declarativeNetRequest'],
    web_accessible_resources: [
      {
        // Only the icon directories are reachable from pages. The previous
        // `*.svg` / `*.png` globs also exposed every bundled SVG -- including
        // `public/wxt.svg`, unused by the code -- as a document any page could
        // load and, with `use_dynamic_url` off, keyed to a stable extension id.
        resources: ['icon/*', 'llm-icons/*'],
        matches: ['<all_urls>'],
        use_dynamic_url: true,
      },
    ],
  },
  vite: () => ({
    optimizeDeps: {
      entries: [
        'entrypoints/**/*.html',
        'entrypoints/**/*.{ts,tsx,js,jsx}',
        '!reference/**',
      ],
    },
    plugins: [
      // Bundle analysis is opt-in: the plugin rewrites a ~1MB stats.html on
      // every build otherwise, including `npm run zip`, for a report nobody
      // reads during a release. `npm run build -- --mode analyze` (or
      // ANALYZE=1) produces it, next to the other build output.
      ...(process.env.ANALYZE
        ? [visualizer({ filename: '.output/stats.html', open: false })]
        : []),
    ],
    build: {
      // Chrome 不采用扩展页里的 modulepreload（报 cross-world extension resource mismatch），
      // 资源都读本地磁盘，预加载本来也没收益
      modulePreload: false,
    },
    // esbuild: {
    //   charset: 'ascii',
    // },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./', import.meta.url)),
      },
    },
  }),
});
