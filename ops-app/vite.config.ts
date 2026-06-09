import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/ops/',
  build: {
    outDir: '../ops',
    emptyOutDir: true,
  },
})
