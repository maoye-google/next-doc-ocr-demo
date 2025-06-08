import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Allow access from network (Docker)
    port: parseInt(process.env.PORT || '5173'),
    proxy: {
      // Optional: If you want to proxy API requests during development
      '/api': {
        target: `http://${process.env.BACKEND_HOST || 'localhost'}:${process.env.BACKEND_PORT || 8000}`,
        changeOrigin: true,
        // rewrite: (path) => path.replace(/^\/api/, '')
      }
    },
    allowedHosts: ['doc-ocr.maoye.demo.altostrat.com'],
  },
  build: {
    outDir: 'build' // Output directory for 'npm run build'
  },
  optimizeDeps: {
    include: ['pdfjs-dist']
  },
  worker: {
    format: 'es'
  }
})
