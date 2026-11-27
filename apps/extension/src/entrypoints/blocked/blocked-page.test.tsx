import { err, ok } from "@detour/result";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ExtensionMessage, ExtensionResponse } from "../../lib/messages.ts";
import { BlockedPage } from "./blocked-page.tsx";

const sendMock = vi.hoisted(() => ({
  fn: vi.fn<(message: ExtensionMessage) => Promise<unknown>>(),
}));

vi.mock("../../lib/runtime.adapter.ts", () => ({
  sendExtensionMessage: (message: ExtensionMessage) => sendMock.fn(message),
}));

describe("BlockedPage", () => {
  beforeEach(() => {
    sendMock.fn.mockReset();
  });

  it("awaits grant_access allow-rule installation before navigating to the target url", async () => {
    const reply: ExtensionResponse = {
      ok: true,
      type: "grant_installed",
      domain: "example.com",
      expiresAtMs: 900_000,
      sessionRuleCount: 1,
    };
    sendMock.fn.mockResolvedValue(ok(reply));
    const onNavigate = vi.fn<(href: string) => void>();

    render(<BlockedPage search="?url=https://example.com/feed?a=1&b=2" onNavigate={onNavigate} />);

    expect(screen.getByRole("heading", { name: "example.com" })).toBeTruthy();

    await userEvent.click(screen.getByRole("radio", { name: /15 minutes/i }));
    await userEvent.type(screen.getByLabelText("Why now?"), "Checking docs");
    await userEvent.click(screen.getByRole("button", { name: "Request pass" }));

    expect(sendMock.fn).toHaveBeenCalledWith({
      type: "grant_access",
      domain: "example.com",
      durationMinutes: 15,
      reason: "Checking docs",
    });
    expect(onNavigate).toHaveBeenCalledWith("https://example.com/feed?a=1&b=2");
    expect(screen.getByRole("status").textContent).toBe(
      'Pass ready for 15 minutes ("Checking docs"). Opening site...',
    );
  });

  it("stays on the gate page when allow-rule installation fails", async () => {
    sendMock.fn.mockResolvedValue(err({ type: "runtime_failed", cause: "disconnected" }));
    const onNavigate = vi.fn<(href: string) => void>();

    render(<BlockedPage search="?url=https%3A%2F%2Fexample.com%2F" onNavigate={onNavigate} />);

    await userEvent.click(screen.getByRole("button", { name: "Request pass" }));

    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe(
      "Could not install pass rule. Please try again.",
    );
  });
});
