import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  imports: false,
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: "Detour",
    description: "An intentional speed bump for distracting websites.",
    permissions: ["storage"],
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              id: "detour@detour.app",
              strict_min_version: "140.0",
              data_collection_permissions: {
                required: ["none"],
              },
            },
          },
        }
      : {}),
  }),
  vite: () => ({
    plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  }),
});
