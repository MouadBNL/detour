import { err, ok } from "@detour/result";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ExtensionMessage, ExtensionResponse } from "../../lib/messages.ts";
import { BlockedPage } from "./blocked-page.tsx";

const sendMock = vi.hoisted(() => ({
  fn: vi.fn<(message: ExtensionMessage) => Promise<unknown>>(),
}));

vi.mock("../../lib/runtime.adapter.ts", () => ({
  sendExtensionMessage: (message: ExtensionMessage) => sendMock.fn(message),
}));

function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

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

    renderWithQuery(
      <BlockedPage
        search="?url=https://example.com/feed?a=1&b=2"
        onNavigate={onNavigate}
        isFramed={false}
      />,
    );

    expect(screen.getByRole("heading", { name: "example.com" })).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(4);

    await userEvent.click(screen.getByRole("radio", { name: /15 minutes/i }));
    await userEvent.type(screen.getByLabelText("Why now?"), "  Checking docs ");
    await userEvent.click(screen.getByRole("button", { name: "Request pass" }));

    expect((await screen.findByRole("status")).textContent).toBe(
      'Pass ready for 15 minutes ("Checking docs"). Opening site...',
    );
    expect(sendMock.fn).toHaveBeenCalledWith({
      type: "grant_access",
      domain: "example.com",
      durationMinutes: 15,
      reason: "Checking docs",
    });
    expect(onNavigate).toHaveBeenCalledWith("https://example.com/feed?a=1&b=2");
  });

  it("offers a 30 minute pass", async () => {
    sendMock.fn.mockResolvedValue(
      ok({
        ok: true,
        type: "grant_installed",
        domain: "example.com",
        expiresAtMs: 1,
        sessionRuleCount: 1,
      }),
    );
    const onNavigate = vi.fn<(href: string) => void>();
    renderWithQuery(
      <BlockedPage search="?url=https://example.com/" onNavigate={onNavigate} isFramed={false} />,
    );

    await userEvent.click(screen.getByRole("radio", { name: /30 minutes/i }));
    await userEvent.click(screen.getByRole("button", { name: "Request pass" }));

    expect((await screen.findByRole("status")).textContent).toBe(
      "Pass ready for 30 minutes. Opening site...",
    );
    expect(sendMock.fn).toHaveBeenCalledWith(expect.objectContaining({ durationMinutes: 30 }));
  });

  it("stays on the gate page when the background worker cannot be reached", async () => {
    sendMock.fn.mockResolvedValue(err({ type: "runtime_failed", cause: "disconnected" }));
    const onNavigate = vi.fn<(href: string) => void>();

    renderWithQuery(
      <BlockedPage
        search="?url=https%3A%2F%2Fexample.com%2F"
        onNavigate={onNavigate}
        isFramed={false}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Request pass" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not install pass rule. Could not reach the Detour background worker.",
    );
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("shows the background worker's refusal when the site is not guarded", async () => {
    sendMock.fn.mockResolvedValue(
      ok({
        ok: false,
        errorType: "site_not_guarded",
        message: "example.com is not on your guarded list.",
      }),
    );
    const onNavigate = vi.fn<(href: string) => void>();

    renderWithQuery(
      <BlockedPage search="?url=https://example.com/" onNavigate={onNavigate} isFramed={false} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Request pass" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not install pass rule. example.com is not on your guarded list.",
    );
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("rejects a reason over 300 characters without sending anything", async () => {
    renderWithQuery(<BlockedPage search="?url=https://example.com/" isFramed={false} />);
    const reason = screen.getByLabelText("Why now?");

    await userEvent.click(reason);
    await userEvent.paste("x".repeat(301));
    await userEvent.click(screen.getByRole("button", { name: "Request pass" }));

    expect(await screen.findByText("Keep your reason under 300 characters.")).toBeTruthy();
    expect(reason.getAttribute("aria-invalid")).toBe("true");
    expect(reason.getAttribute("aria-describedby")).toBeTruthy();
    expect(sendMock.fn).not.toHaveBeenCalled();
  });

  it("offers no pass form when the target url is missing or invalid", () => {
    renderWithQuery(<BlockedPage search="?url=javascript:alert(1)" isFramed={false} />);

    expect(screen.getByRole("heading", { name: "Detour gate" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Request pass" })).toBeNull();
    expect(screen.queryByText(/Requested \d+ minutes/u)).toBeNull();
  });

  it("refuses to offer a pass when embedded in another page", () => {
    renderWithQuery(<BlockedPage search="?url=https://example.com/" isFramed />);

    expect(screen.queryByRole("button", { name: "Request pass" })).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText(/Open the site directly in its own tab/u)).toBeTruthy();
  });
});
