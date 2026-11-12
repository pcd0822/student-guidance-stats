import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// 빌드 결과물은 app/static 에 둔다(사용자는 Node 없이 Python 만으로 실행).
// 개발 때는 npm run dev → /api 를 백엔드(python -m app --no-open --port 8765)로 넘긴다.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  base: '/',
  build: {
    outDir: path.resolve(__dirname, '../app/static'),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8765' },
  },
})
