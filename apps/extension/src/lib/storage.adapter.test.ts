import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { DEFAULT_GUARD_STATE, type GuardState } from "./guard-state.ts";
import { ensureTrustedStorageAccess, readGuardState, writeGuardState } from "./storage.adapter.ts";

describe("storage.adapter", () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.restoreAllMocks();
  });

  it("defaults to empty unpaused guard state when storage is empty", async () => {
    const result = await readGuardState();
    expect(result).toEqual({ ok: true, value: DEFAULT_GUARD_STATE });
  });

  it("persists and reads back guard state via browser.storage.local", async () => {
    const state: GuardState = {
      paused: true,
      sites: [{ domain: "example.com" }],
      grants: [
        {
          domain: "example.com",
          reason: "quick lookup",
          grantedAtMs: 1_000,
          expiresAtMs: 61_000,
        },
      ],
      lastExpired: [],
    };
    const written = await writeGuardState(state);
    expect(written).toEqual({ ok: true, value: state });

    const readBack = await readGuardState();
    expect(readBack).toEqual({ ok: true, value: state });
  });

  it("returns enforced when storage.local.setAccessLevel is supported (Chrome)", async () => {
    const spy = vi
      .fn<(options: { accessLevel: string }) => Promise<void>>()
      .mockResolvedValue(undefined);
    const original = Object.getOwnPropertyDescriptor(fakeBrowser.storage.local, "setAccessLevel");
    Object.defineProperty(fakeBrowser.storage.local, "setAccessLevel", {
      value: spy,
      configurable: true,
      writable: true,
    });

    const result = await ensureTrustedStorageAccess();
    expect(result).toEqual({ ok: true, value: "enforced" });
    expect(spy).toHaveBeenCalledWith({ accessLevel: "TRUSTED_CONTEXTS" });

    if (original) {
      Object.defineProperty(fakeBrowser.storage.local, "setAccessLevel", original);
    }
  });

  it("returns unsupported gracefully when storage.local.setAccessLevel is absent (Firefox)", async () => {
    const original = Object.getOwnPropertyDescriptor(fakeBrowser.storage.local, "setAccessLevel");
    Object.defineProperty(fakeBrowser.storage.local, "setAccessLevel", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const result = await ensureTrustedStorageAccess();
    expect(result).toEqual({ ok: true, value: "unsupported" });

    if (original) {
      Object.defineProperty(fakeBrowser.storage.local, "setAccessLevel", original);
    }
  });

  it("returns storage_failed when setAccessLevel rejects", async () => {
    const spy = vi
      .fn<(options: { accessLevel: string }) => Promise<void>>()
      .mockRejectedValue(new Error("Access level rejected"));
    const original = Object.getOwnPropertyDescriptor(fakeBrowser.storage.local, "setAccessLevel");
    Object.defineProperty(fakeBrowser.storage.local, "setAccessLevel", {
      value: spy,
      configurable: true,
      writable: true,
    });

    const result = await ensureTrustedStorageAccess();
    expect(result.ok).toBe(false);

    if (original) {
      Object.defineProperty(fakeBrowser.storage.local, "setAccessLevel", original);
    }
  });
});
