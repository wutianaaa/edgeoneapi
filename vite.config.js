import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        configure: (proxy, options) => {
          proxy.on('error', (err, req, res) => {
            console.log('proxy error', err);
          });
          proxy.on('proxyReq', (proxyReq, req, res) => {
            console.log('Proxying:', req.method, req.url);
          });
        }
      },
      '/v1': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true
      }
    }
  },
  test: {
    coverage: {
      provider: "v8",
      include: ["lib/shared.js"],
      reporter: ["text"]
    }
  }
});
