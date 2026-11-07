import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { localDemoPlugin } from "./server/demo/vitePlugin";

export default defineConfig({
  plugins: [react(), localDemoPlugin()],
});
