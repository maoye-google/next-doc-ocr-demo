import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Allow access from network (Docker)
    port: 3000,      // Port Vite will run on
    proxy: {
      // Optional: If you want to proxy API requests during development
      // '/api': {
      //   target: 'http://localhost:8000', // Your backend URL
      //   changeOrigin: true,
      //   rewrite: (path) => path.replace(/^\/api/, '')
      // }
    }
  },
  build: {
    outDir: 'build' // Output directory for 'npm run build'
  }
})
