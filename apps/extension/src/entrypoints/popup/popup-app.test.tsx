import { err, ok, type Result } from "@detour/result";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { GuardState } from "../../lib/guard-state.ts";
import type { ExtensionMessage, ExtensionResponse, ExtensionStatus } from "../../lib/messages.ts";
import type { PermissionsError } from "../../lib/permissions.adapter.ts";
import { PopupApp } from "./popup-app.tsx";

type PermissionReply = Result<boolean, PermissionsError>;

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn<(message: ExtensionMessage) => Promise<unknown>>(),
  requestPermission: vi.fn<(domain: string) => Promise<PermissionReply>>(),
}));

vi.mock("../../lib/runtime.adapter.ts", () => ({
  sendExtensionMessage: (message: ExtensionMessage) => mocks.sendMessage(message),
}));

vi.mock("../../lib/permissions.adapter.ts", () => ({
  requestDomainPermission: (domain: string) => mocks.requestPermission(domain),
}));

function makeState(overrides: Partial<GuardState> = {}): GuardState {
  return {
    paused: false,
    sites: [],
    grants: [],
    lastExpired: [],
    pendingSweepDomains: [],
    ...overrides,
  };
}

function statusReply(overrides: Partial<ExtensionStatus> = {}) {
  const response: ExtensionResponse = {
    ok: true,
    type: "status",
    status: {
      state: makeState(),
      sites: [],
      storageAccess: "enforced",
      dynamicRuleCount: 0,
      sessionRuleCount: 0,
      nextAlarmAtMs: null,
      ...overrides,
    },
  };
  return ok(response);
}

function guarding(domain: string, hostAccess: "granted" | "revoked", paused = false) {
  return statusReply({
    state: makeState({ paused, sites: [{ domain }] }),
    sites: [{ domain, hostAccess }],
    dynamicRuleCount: paused ? 0 : 1,
  });
}

function renderPopup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PopupApp />
    </QueryClientProvider>,
  );
}

describe("PopupApp", () => {
  beforeEach(() => {
    mocks.sendMessage.mockReset();
    mocks.requestPermission.mockReset();
  });

  it("shows a loading state until the background worker answers", async () => {
    mocks.sendMessage.mockResolvedValueOnce(guarding("example.com", "granted"));

    renderPopup();

    expect(screen.getByText("Loading Detour status…")).toBeTruthy();
    expect(await screen.findByText("example.com")).toBeTruthy();
    expect(screen.queryByText("Loading Detour status…")).toBeNull();
    expect(mocks.sendMessage).toHaveBeenCalledWith({ type: "get_status" });
  });

  it("reports a status load failure with the background worker's reason", async () => {
    mocks.sendMessage.mockResolvedValueOnce(err({ type: "runtime_failed", cause: "gone" }));

    renderPopup();

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not load Detour status. Could not reach the Detour background worker.",
    );
  });

  it("toggles pause and shows the saved state", async () => {
    mocks.sendMessage
      .mockResolvedValueOnce(guarding("example.com", "granted"))
      .mockResolvedValueOnce(guarding("example.com", "granted", true));

    renderPopup();
    await userEvent.click(await screen.findByRole("button", { name: "Pause Detour" }));

    expect(mocks.sendMessage).toHaveBeenLastCalledWith({ type: "set_paused", paused: true });
    expect((await screen.findByRole("status")).textContent).toBe("Detour is paused.");
    expect(screen.getByRole("button", { name: "Resume Detour" })).toBeTruthy();
  });

  it("re-grants host access for a revoked site, then reconciles", async () => {
    mocks.sendMessage
      .mockResolvedValueOnce(guarding("example.com", "revoked"))
      .mockResolvedValueOnce(guarding("example.com", "granted"));
    mocks.requestPermission.mockResolvedValueOnce(ok(true));

    renderPopup();
    await userEvent.click(await screen.findByRole("button", { name: "Re-grant" }));

    expect(mocks.requestPermission).toHaveBeenCalledWith("example.com");
    expect(mocks.sendMessage).toHaveBeenLastCalledWith({ type: "reconcile_now" });
    expect((await screen.findByRole("status")).textContent).toBe(
      "Restored host access for example.com.",
    );
    expect(screen.queryByRole("button", { name: "Re-grant" })).toBeNull();
  });

  it("removes a site from its own row", async () => {
    mocks.sendMessage
      .mockResolvedValueOnce(
        statusReply({
          state: makeState({ sites: [{ domain: "a.com" }, { domain: "b.com" }] }),
          sites: [
            { domain: "a.com", hostAccess: "granted" },
            { domain: "b.com", hostAccess: "granted" },
          ],
        }),
      )
      .mockResolvedValueOnce(guarding("b.com", "granted"));

    renderPopup();
    await userEvent.click(await screen.findByRole("button", { name: "Remove a.com" }));

    expect(mocks.sendMessage).toHaveBeenLastCalledWith({ type: "remove_site", domain: "a.com" });
    expect(await screen.findByText("b.com")).toBeTruthy();
    expect(screen.queryByText("a.com")).toBeNull();
  });

  it("rejects an invalid domain with a field error and sends nothing", async () => {
    mocks.sendMessage.mockResolvedValueOnce(statusReply());

    renderPopup();
    const input = screen.getByLabelText("Domain to guard");
    await userEvent.type(input, "not a domain");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("Enter a valid domain like example.com.")).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBeTruthy();
    expect(mocks.requestPermission).not.toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("sends add_site without waiting for the host permission prompt", async () => {
    const prompt = Promise.withResolvers<PermissionReply>();
    mocks.sendMessage
      .mockResolvedValueOnce(statusReply())
      .mockResolvedValueOnce(guarding("news.ycombinator.com", "granted"));
    mocks.requestPermission.mockReturnValueOnce(prompt.promise);

    renderPopup();
    await userEvent.type(screen.getByLabelText("Domain to guard"), "News.YCombinator.com/newest");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(mocks.requestPermission).toHaveBeenCalledWith("news.ycombinator.com");
    expect(mocks.sendMessage).toHaveBeenLastCalledWith({
      type: "add_site",
      domain: "news.ycombinator.com",
    });

    prompt.resolve(ok(true));

    expect((await screen.findByRole("status")).textContent).toBe("Guarding news.ycombinator.com.");
    const list = screen.getByRole("list", { name: "Guarded sites" });
    expect(within(list).getByText("news.ycombinator.com")).toBeTruthy();
  });

  it("surfaces an add_site failure even when host access was granted", async () => {
    mocks.sendMessage.mockResolvedValueOnce(statusReply()).mockResolvedValueOnce(
      ok({
        ok: false,
        errorType: "storage_failed",
        message: "Extension storage operation failed.",
      }),
    );
    mocks.requestPermission.mockResolvedValueOnce(ok(true));

    renderPopup();
    const input = screen.getByLabelText("Domain to guard");
    await userEvent.type(input, "example.com");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not add example.com. Extension storage operation failed.",
    );
    expect(input).toHaveProperty("value", "example.com");
  });
});
