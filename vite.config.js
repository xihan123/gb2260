import { rmSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const siteRoot = resolve(import.meta.dirname, "site/src");
const sitePublic = resolve(import.meta.dirname, "site/public");
const siteAssets = resolve(sitePublic, "assets");

function cleanBuiltAssets() {
  return {
    name: "clean-built-assets",
    apply: "build",
    buildStart() {
      rmSync(siteAssets, { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  plugins: [cleanBuiltAssets(), react()],
  root: siteRoot,
  base: "./",
  publicDir: false,
  build: {
    outDir: sitePublic,
    emptyOutDir: false,
    rollupOptions: {
      input: {
        main: resolve(siteRoot, "index.html"),
        notFound: resolve(siteRoot, "404.html"),
      },
    },
  },
});
