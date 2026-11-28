import legacy from '@vitejs/plugin-legacy';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { legacyCss } from './legacy-css';

// 古い iPad (iOS 12 以降) でも開けるように、すべてのブラウザに同じ変換済みのコードを配る。
// 新旧を出し分けると、Safari 13 のように「新しい版を選ぶが構文を読めない」世代で真っ白になるため。
export default defineConfig({
  plugins: [
    react(),
    legacy({
      targets: ['ios >= 12', 'safari >= 12', 'defaults'],
      renderModernChunks: false,
    }),
  ],
  css: { postcss: { plugins: [legacyCss()] } },
  build: { cssTarget: ['safari12', 'ios12'] },
  server: { port: 5173, strictPort: true },
});
