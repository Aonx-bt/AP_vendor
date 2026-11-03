import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import path from "node:path";

export default defineConfig(({ mode }) => ({
  // `vite build --mode artifact` makes one self-contained HTML file (demo mode, in-memory routing)
  plugins: mode === "artifact" ? [react(), viteSingleFile()] : [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "supabase/functions/_shared"),
    },
  },
  test: { include: ["supabase/functions/_shared/**/*.test.ts", "src/**/*.test.ts"] },
}) as any);
