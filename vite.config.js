import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173
  },
  test: {
    coverage: {
      provider: "v8",
      include: ["lib/shared.js"],
      reporter: ["text"]
    }
  }
});
