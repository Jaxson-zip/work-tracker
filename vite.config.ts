import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // PGlite 自己加载 wasm 和数据文件，预打包会弄丢它们的路径。
  optimizeDeps: { exclude: ["@electric-sql/pglite"] },
  // 正式构建不走演示分支，不把十几 MB 的数据库打包进去。
  build: mode === "demo" ? {} : { rollupOptions: { external: [/^@electric-sql\/pglite/] } },
}));
