import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// host: true exposes the dev server on your local network (LAN) so you can open
// the printed "Network" URL on your phone while developing.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
  },
});
