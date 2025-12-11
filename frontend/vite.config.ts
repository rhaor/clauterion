import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Split Firebase SDK into its own chunk (large library)
          'firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/functions'],
          // Split react-markdown into its own chunk (used in TopicDetail)
          'react-markdown': ['react-markdown'],
          // Split React Query into its own chunk
          'react-query': ['@tanstack/react-query'],
          // Split React Router into its own chunk
          'react-router': ['react-router-dom'],
        },
      },
    },
    // Increase chunk size warning limit to 600KB (reasonable for modern apps)
    chunkSizeWarningLimit: 600,
  },
})
