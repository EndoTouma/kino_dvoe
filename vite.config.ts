import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    host: true,
    proxy: { '/api': 'http://localhost:3000', '/posters': 'http://localhost:3000', '/avatars': 'http://localhost:3000' },
  },
})
