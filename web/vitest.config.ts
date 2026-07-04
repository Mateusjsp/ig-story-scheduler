import { defineConfig } from "vitest/config";
import path from "node:path";

// Resolve o alias "@/..." (mesmo mapeamento do tsconfig) nos testes.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
