import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  base: './',
  optimizeDeps: {
    include: [
      'react',
      'react-dom/client',
      'lucide-react',
      'zustand',
      'webm-muxer',
      '@techstark/opencv-js',
    ],
  },
  server: {
    port: 4175,
    strictPort: true,
    watch: { ignored: ['**/test-results/**', '**/.detection-check/**'] },
  },
  build: { chunkSizeWarningLimit: 1000 },
});
