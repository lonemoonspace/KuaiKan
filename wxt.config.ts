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
    permissions: ['activeTab', 'storage', 'contextMenus', 'scripting', 'declarativeNetRequest'],
    web_accessible_resources: [
      {
        resources: ['icon/*', 'llm-icons/*', '*.svg', '*.png'],
        matches: ['<all_urls>'],
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
    plugins: [visualizer({ filename: 'stats.html', open: false })],
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
