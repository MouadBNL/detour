import { beforeEach, describe, expect, it } from "vite-plus/test";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { readPausedState, writePausedState } from "./storage.adapter.ts";

describe("storage.adapter", () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it("defaults to false when nothing is stored", async () => {
    const result = await readPausedState();
    expect(result).toEqual({ ok: true, value: false });
  });

  it("persists and reads back the paused state via browser.storage.local", async () => {
    const written = await writePausedState(true);
    expect(written).toEqual({ ok: true, value: true });

    const readBack = await readPausedState();
    expect(readBack).toEqual({ ok: true, value: true });
  });
});
