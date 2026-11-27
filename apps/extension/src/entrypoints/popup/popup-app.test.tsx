import { ok } from "@detour/result";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ExtensionMessage, ExtensionResponse, ExtensionStatus } from "../../lib/messages.ts";
import { PopupApp } from "./popup-app.tsx";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn<(message: ExtensionMessage) => Promise<unknown>>(),
  requestPermission: vi.fn<(domain: string) => Promise<unknown>>(),
}));

vi.mock("../../lib/runtime.adapter.ts", () => ({
  sendExtensionMessage: (message: ExtensionMessage) => mocks.sendMessage(message),
}));

vi.mock("../../lib/permissions.adapter.ts", () => ({
  requestDomainPermission: (domain: string) => mocks.requestPermission(domain),
}));

function makeStatus(overrides: Partial<ExtensionStatus> = {}): ExtensionStatus {
  return {
    state: { paused: false, sites: [], grants: [], lastExpired: [] },
    grantedDomains: [],
    revokedDomains: [],
    storageAccess: "enforced",
    dynamicRuleCount: 0,
    sessionRuleCount: 0,
    nextAlarmAtMs: null,
    ...overrides,
  };
}

describe("PopupApp", () => {
  beforeEach(() => {
    mocks.sendMessage.mockReset();
    mocks.requestPermission.mockReset();
  });

  it("loads status, toggles pause, and surfaces revoked host permissions", async () => {
    const initial: ExtensionResponse = {
      ok: true,
      type: "status",
      status: makeStatus({
        state: {
          paused: false,
          sites: [{ domain: "example.com" }],
          grants: [],
          lastExpired: [],
        },
        revokedDomains: ["example.com"],
        dynamicRuleCount: 1,
      }),
    };
    const pausedReply: ExtensionResponse = {
      ok: true,
      type: "status",
      status: makeStatus({
        state: {
          paused: true,
          sites: [{ domain: "example.com" }],
          grants: [],
          lastExpired: [],
        },
        revokedDomains: ["example.com"],
        dynamicRuleCount: 0,
      }),
    };
    mocks.sendMessage.mockResolvedValueOnce(ok(initial)).mockResolvedValueOnce(ok(pausedReply));

    render(<PopupApp />);

    expect(await screen.findByText("example.com")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Re-grant" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Pause Detour" }));

    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Detour is paused.");
    expect(screen.getByRole("button", { name: "Resume Detour" })).toBeTruthy();
  });

  it("requests optional host permission when adding a new guarded domain", async () => {
    const initial: ExtensionResponse = { ok: true, type: "status", status: makeStatus() };
    const afterAdd: ExtensionResponse = {
      ok: true,
      type: "status",
      status: makeStatus({
        state: {
          paused: false,
          sites: [{ domain: "news.ycombinator.com" }],
          grants: [],
          lastExpired: [],
        },
        grantedDomains: ["news.ycombinator.com"],
        dynamicRuleCount: 1,
      }),
    };
    mocks.sendMessage.mockResolvedValueOnce(ok(initial)).mockResolvedValueOnce(ok(afterAdd));
    mocks.requestPermission.mockResolvedValueOnce(ok(true));

    render(<PopupApp />);

    await userEvent.type(screen.getByLabelText("Domain to guard"), "news.ycombinator.com");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(mocks.requestPermission).toHaveBeenCalledWith("news.ycombinator.com");
    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      "Guarding news.ycombinator.com.",
    );
    expect(screen.getByText("news.ycombinator.com")).toBeTruthy();
  });
});
