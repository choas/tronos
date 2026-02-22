import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solid()],
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
})
