import { defineConfig } from "vite";

export default defineConfig({
  server: { host: "0.0.0.0", port: 4738, strictPort: true },
  preview: { host: "0.0.0.0", port: 4738, strictPort: true },
  optimizeDeps: {
    exclude: ["maplibre-gl"],
  },
  build: {
    chunkSizeWarningLimit: 1200,
  },
});
