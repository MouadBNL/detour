import { defineBackground } from "wxt/utils/define-background";
import { readPausedState } from "../lib/storage.adapter.ts";

export default defineBackground(() => {
  void readPausedState().then((result) => {
    if (result.ok) {
      console.info(`Detour background ready (paused=${String(result.value)}).`);
      return;
    }
    console.warn("Detour failed to read initial state.", result.error.cause);
  });
});
