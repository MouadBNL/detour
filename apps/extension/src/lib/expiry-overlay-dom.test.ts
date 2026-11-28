// @vitest-environment happy-dom
import { err, ok, type Result } from "@detour/result";
import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { mountExpiryOverlay } from "./expiry-overlay-dom.ts";
import type { ExpiredGrantContext } from "./guard-state.ts";
import type { ExtensionMessage, ExtensionResponse } from "./messages.ts";
import type { RuntimeError } from "./runtime.adapter.ts";

type Reply = Result<ExtensionResponse, RuntimeError>;

const REASON = "check the release notes";

const context = (overrides: Partial<ExpiredGrantContext> = {}): ExpiredGrantContext => ({
  domain: "news.example",
  reason: REASON,
  durationMinutes: 5,
  expiredAtMs: 1_000,
  wrapupUsed: false,
  ...overrides,
});

const recorded: Reply = ok({
  ok: true,
  type: "followup_recorded",
  domain: "news.example",
  verdict: "worth_it",
});

function buttons(shadow: ShadowRoot): HTMLButtonElement[] {
  return [...shadow.querySelectorAll("button")];
}

function button(shadow: ShadowRoot, name: RegExp): HTMLButtonElement {
  const match = buttons(shadow).find((candidate) => name.test(candidate.textContent));
  assert(match !== undefined, `button ${String(name)} not found`);
  return match;
}

function alertText(shadow: ShadowRoot): string {
  const banner = shadow.querySelector('[role="alert"]');
  assert(banner instanceof HTMLElement);
  return banner.hidden ? "" : banner.textContent;
}

function pressTab(target: Element, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Tab",
    shiftKey,
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

function deferred(): { promise: Promise<Reply>; resolve: (reply: Reply) => void } {
  const settle: { resolve: (reply: Reply) => void } = { resolve: () => undefined };
  const promise = new Promise<Reply>((res) => {
    settle.resolve = res;
  });
  return { promise, resolve: (reply) => settle.resolve(reply) };
}

let pageInput: HTMLInputElement;

beforeEach(() => {
  pageInput = document.createElement("input");
  document.body.append(pageInput);
  pageInput.focus();
});

afterEach(() => {
  document.documentElement.querySelector("#detour-expiry-overlay-host")?.remove();
  document.body.replaceChildren();
});

describe("mountExpiryOverlay", () => {
  it("uses a closed shadow root so the host page cannot read the stated reason", () => {
    const send = vi.fn<(message: ExtensionMessage) => Promise<Reply>>();
    const { host, shadow, unmount } = mountExpiryOverlay(context(), send);

    expect(host.isConnected).toBe(true);
    expect(host.shadowRoot).toBeNull();
    expect(document.documentElement.textContent).not.toContain(REASON);
    expect(shadow.textContent).toContain(REASON);
    unmount();
  });

  it("sends the verdict without a domain, then removes the overlay and restores focus", async () => {
    const send = vi.fn<(message: ExtensionMessage) => Promise<Reply>>().mockResolvedValue(recorded);
    const { host, shadow } = mountExpiryOverlay(context(), send);

    button(shadow, /Got what I came for/).click();
    await vi.waitFor(() => expect(host.isConnected).toBe(false));

    expect(send).toHaveBeenCalledExactlyOnceWith({ type: "submit_followup", verdict: "worth_it" });
    expect(document.activeElement).toBe(pageInput);
  });

  it("disables every button while a request is in flight", async () => {
    const pending = deferred();
    const send = vi
      .fn<(message: ExtensionMessage) => Promise<Reply>>()
      .mockReturnValue(pending.promise);
    const { host, shadow } = mountExpiryOverlay(context(), send);

    button(shadow, /Drifted/).click();
    expect(buttons(shadow).every((candidate) => candidate.disabled)).toBe(true);
    button(shadow, /Drifted/).click();
    expect(send).toHaveBeenCalledTimes(1);

    pending.resolve(recorded);
    await vi.waitFor(() => expect(host.isConnected).toBe(false));
  });

  it("keeps the overlay open on transport failure and lets a retry dismiss it", async () => {
    const send = vi
      .fn<(message: ExtensionMessage) => Promise<Reply>>()
      .mockResolvedValueOnce(err({ type: "runtime_failed", cause: "disconnected" }))
      .mockResolvedValueOnce(recorded);
    const { host, shadow } = mountExpiryOverlay(context(), send);

    button(shadow, /Drifted/).click();
    await vi.waitFor(() => expect(alertText(shadow)).toMatch(/couldn't reach detour/i));

    expect(host.isConnected).toBe(true);
    expect(buttons(shadow).every((candidate) => !candidate.disabled)).toBe(true);

    button(shadow, /Drifted/).click();
    await vi.waitFor(() => expect(host.isConnected).toBe(false));
    expect(send).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(pageInput);
  });

  it("disables wrap-up after wrapup_unavailable while keeping verdicts retryable", async () => {
    const send = vi
      .fn<(message: ExtensionMessage) => Promise<Reply>>()
      .mockResolvedValueOnce(
        ok({ ok: false, errorType: "wrapup_unavailable", message: "already used" }),
      )
      .mockResolvedValueOnce(recorded);
    const { host, shadow } = mountExpiryOverlay(context(), send);

    button(shadow, /2 more minutes/).click();
    await vi.waitFor(() => expect(alertText(shadow)).toMatch(/wrap-up/i));

    expect(host.isConnected).toBe(true);
    expect(button(shadow, /Wrap-up unavailable/).disabled).toBe(true);
    expect(button(shadow, /Wasn't worth it/).disabled).toBe(false);

    button(shadow, /Wasn't worth it/).click();
    await vi.waitFor(() => expect(host.isConnected).toBe(false));
    expect(send).toHaveBeenLastCalledWith({ type: "submit_followup", verdict: "not_worth_it" });
  });

  it("shows a generic retry error for other background failures", async () => {
    const send = vi
      .fn<(message: ExtensionMessage) => Promise<Reply>>()
      .mockResolvedValue(ok({ ok: false, errorType: "tabs_scripting_failed", message: "nope" }));
    const { host, shadow, unmount } = mountExpiryOverlay(context(), send);

    button(shadow, /2 more minutes/).click();
    await vi.waitFor(() => expect(alertText(shadow)).toMatch(/try again/i));

    expect(host.isConnected).toBe(true);
    expect(button(shadow, /2 more minutes/).disabled).toBe(false);
    unmount();
  });

  it("disables the wrap-up button upfront when it was already used", () => {
    const send = vi.fn<(message: ExtensionMessage) => Promise<Reply>>();
    const { shadow, unmount } = mountExpiryOverlay(context({ wrapupUsed: true }), send);

    const wrapup = button(shadow, /Wrap-up already used/);
    expect(wrapup.disabled).toBe(true);
    wrapup.click();
    expect(send).not.toHaveBeenCalled();
    unmount();
  });

  it("focuses the first button and wraps Tab / Shift+Tab inside the dialog", () => {
    const pageKeys = vi.fn<(event: KeyboardEvent) => void>();
    document.addEventListener("keydown", pageKeys);
    const send = vi.fn<(message: ExtensionMessage) => Promise<Reply>>();
    const { shadow, unmount } = mountExpiryOverlay(context({ wrapupUsed: true }), send);
    const [first, second, third] = buttons(shadow);
    assert(first !== undefined && second !== undefined && third !== undefined);

    expect(shadow.activeElement).toBe(first);
    expect(pressTab(first).defaultPrevented).toBe(true);
    expect(shadow.activeElement).toBe(second);
    pressTab(second);
    expect(shadow.activeElement).toBe(third);
    // The wrap-up button is disabled, so Tab wraps from the last enabled button to the first.
    pressTab(third);
    expect(shadow.activeElement).toBe(first);
    pressTab(first, true);
    expect(shadow.activeElement).toBe(third);
    expect(pageKeys).not.toHaveBeenCalled();

    unmount();
    expect(document.activeElement).toBe(pageInput);
    pressTab(pageInput);
    expect(pageKeys).toHaveBeenCalledTimes(1);
    document.removeEventListener("keydown", pageKeys);
  });

  it("replaces a previous overlay on re-mount without leaking it", () => {
    const send = vi.fn<(message: ExtensionMessage) => Promise<Reply>>();
    const firstMount = mountExpiryOverlay(context(), send);
    const secondMount = mountExpiryOverlay(context(), send);

    expect(firstMount.host.isConnected).toBe(false);
    expect(document.querySelectorAll("#detour-expiry-overlay-host")).toHaveLength(1);
    secondMount.unmount();
    expect(document.activeElement).toBe(pageInput);
  });
});
