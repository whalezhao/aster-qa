import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json';
import { LATEST_RELEASE_VERSION } from './src/releaseNotes';

// 公告和 package 版本一起发版；不一致直接失败，避免公告落后或超前于实际版本
if (LATEST_RELEASE_VERSION && LATEST_RELEASE_VERSION !== pkg.version) {
  throw new Error(
    `最新版本公告 ${LATEST_RELEASE_VERSION} 与 package.json ${pkg.version} 不一致，请先补公告或同步版本`,
  );
}

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // 按「变化频率」拆包：框架、组件库、AI 组件、图表各走各的 chunk，
        // 页面本身懒加载后首屏不再下载图表库
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
          antd: ['antd', '@ant-design/icons'],
          pro: ['@ant-design/pro-components'],
          x: ['@ant-design/x', '@ant-design/x-markdown'],
          charts: ['@ant-design/plots'],
        },
      },
    },
  },
});
