import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            },
            {
              name: 'antd',
              test: /node_modules[\\/](antd|@ant-design|@rc-component|rc-[a-z-]+|@rc-)[\\/]/,
            },
          ],
        },
      },
    },
  },
})
