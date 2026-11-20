import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { rKernelPlugin } from './server/rKernelHost.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), rKernelPlugin()],
  server: {
    // Kernel middleware is registered by rKernelPlugin via configureServer.
  },
})
