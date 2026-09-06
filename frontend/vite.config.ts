import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 700,
    modulePreload: {
      resolveDependencies(_filename, dependencies, { hostType }) {
        if (hostType !== "html") return dependencies;
        return dependencies.filter(
          (dependency) =>
            !dependency.includes("three-core") &&
            !dependency.includes("react-three"),
        );
      },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("vite/preload-helper")) return "vite-runtime";
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/node_modules/three/")) return "three-core";
          if (
            id.includes("/node_modules/@react-three/") ||
            id.includes("/node_modules/three-stdlib/")
          ) {
            return "react-three";
          }
          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/scheduler/")
          ) {
            return "react-runtime";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/media": "http://127.0.0.1:8000",
    },
  },
});
