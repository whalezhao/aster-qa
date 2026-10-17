import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
