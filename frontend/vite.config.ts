import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base = nombre del repo, para servir bien desde GitHub Pages.
export default defineConfig({
  plugins: [react()],
  base: "/recuperacion-facturas/",
});
