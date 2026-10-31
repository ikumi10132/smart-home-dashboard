import legacy from '@vitejs/plugin-legacy';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 古い iPad でも開けるように、すべてのブラウザに同じ変換済みコードを配信する。
// 新旧を出し分けると、Safari 13 のように「新しい版を選ぶが構文を読めない」世代で真っ白になる。
// 下限はログイン (PKCE) に crypto.subtle が必要な iOS 11。
export default defineConfig({
  plugins: [
    react(),
    legacy({
      targets: ['ios >= 11', 'safari >= 11', 'defaults'],
      renderModernChunks: false,
    }),
  ],
  build: { cssTarget: ['safari11'] },
  server: { port: 5173, strictPort: true },
});
