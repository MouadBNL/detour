import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  plugins: [
    await WxtVitest({ root: import.meta.dirname }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  test: {
    projects: [
      { extends: true, test: { name: "unit", include: ["src/**/*.test.ts"] } },
      {
        extends: true,
        test: {
          name: "dom",
          include: ["src/**/*.test.tsx"],
          environment: "happy-dom",
          setupFiles: ["./src/test-setup.ts"],
        },
      },
    ],
  },
  run: {
    tasks: {
      "check:static": {
        command: "wxt prepare && vp check",
        cache: {
          input: [{ auto: true }, "!.wxt/**"],
          output: [{ auto: true }, "!.wxt/**"],
        },
      },
    },
  },
});
