import type { Result } from "@detour/result";
import overlayCss from "./expiry-overlay.css?inline";
import type { ExpiredGrantContext } from "./guard-state.ts";
import type { ExtensionMessage, ExtensionResponse, FollowupVerdict } from "./messages.ts";
import type { RuntimeError } from "./runtime.adapter.ts";

const OVERLAY_HOST_ID = "detour-expiry-overlay-host";
const WRAPUP_LABEL = "2 more minutes to wrap up";
const KEY_EVENTS = ["keydown", "keyup", "keypress"] as const;

const VERDICT_OPTIONS: readonly { readonly verdict: FollowupVerdict; readonly label: string }[] = [
  { verdict: "worth_it", label: "Got what I came for" },
  { verdict: "drifted", label: "Drifted" },
  { verdict: "not_worth_it", label: "Wasn't worth it" },
];

type SendMessage = (message: ExtensionMessage) => Promise<Result<ExtensionResponse, RuntimeError>>;

type OverlayParts = {
  readonly host: HTMLDivElement;
  readonly shadow: ShadowRoot;
  readonly card: HTMLElement;
  readonly errorBanner: HTMLParagraphElement;
  readonly verdictButtons: readonly HTMLButtonElement[];
  readonly wrapupButton: HTMLButtonElement;
};

/** Unmounts the overlay mounted by this script instance (re-injection replaces it cleanly). */
let unmountActive: (() => void) | null = null;

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = "",
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function createButton(label: string, primary: boolean): HTMLButtonElement {
  const button = createElement("button", primary ? "detour-btn detour-btn-primary" : "detour-btn");
  button.type = "button";
  button.textContent = label;
  return button;
}

function renderParts(context: ExpiredGrantContext | null): OverlayParts {
  const host = document.createElement("div");
  host.id = OVERLAY_HOST_ID;
  // Closed: host-page scripts get `host.shadowRoot === null`, so they cannot read the stated
  // reason or click the follow-up buttons programmatically.
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = overlayCss;

  const card = createElement("section", "detour-card");
  card.tabIndex = -1;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", "Detour pass expired");

  const domain = context?.domain ?? window.location.hostname;
  const eyebrow = createElement("p", "detour-eyebrow", `Detour · ${domain}`);
  const title = createElement(
    "h2",
    "detour-title",
    context !== null ? `${String(context.durationMinutes)} min elapsed` : "Time is up",
  );
  const quote = createElement(
    "p",
    "detour-quote",
    context && context.reason.length > 0
      ? `You came here for "${context.reason}".`
      : "Your pass for this site has expired.",
  );
  const errorBanner = createElement("p", "detour-error");
  errorBanner.setAttribute("role", "alert");
  errorBanner.hidden = true;

  const actions = createElement("div", "detour-actions");
  const verdictButtons = VERDICT_OPTIONS.map((option) => createButton(option.label, false));
  const wrapupButton = createButton(WRAPUP_LABEL, true);
  if (context?.wrapupUsed === true) disableWrapup(wrapupButton, "Wrap-up already used");
  actions.append(...verdictButtons, wrapupButton);

  card.append(eyebrow, title, quote, errorBanner, actions);
  shadow.append(style, card);
  return { host, shadow, card, errorBanner, verdictButtons, wrapupButton };
}

function disableWrapup(button: HTMLButtonElement, label: string): void {
  button.disabled = true;
  button.dataset["locked"] = "true";
  button.textContent = label;
}

function allButtons(parts: OverlayParts): readonly HTMLButtonElement[] {
  return [...parts.verdictButtons, parts.wrapupButton];
}

function enabledButtons(parts: OverlayParts): readonly HTMLButtonElement[] {
  return allButtons(parts).filter((button) => !button.disabled);
}

function setBusy(parts: OverlayParts, busy: boolean): void {
  parts.card.setAttribute("aria-busy", String(busy));
  for (const button of allButtons(parts)) {
    button.disabled = busy || button.dataset["locked"] === "true";
  }
}

function focusFirst(parts: OverlayParts): void {
  (enabledButtons(parts)[0] ?? parts.card).focus();
}

function trapTab(parts: OverlayParts, event: KeyboardEvent): void {
  event.preventDefault();
  const buttons = enabledButtons(parts);
  const first = buttons[0];
  const last = buttons.at(-1);
  if (first === undefined || last === undefined) {
    parts.card.focus();
    return;
  }
  const current = parts.shadow.activeElement;
  const index = buttons.findIndex((button) => button === current);
  if (event.shiftKey) {
    (index <= 0 ? last : (buttons[index - 1] ?? last)).focus();
    return;
  }
  (index === -1 || index === buttons.length - 1 ? first : (buttons[index + 1] ?? first)).focus();
}

function failureMessage(reply: Awaited<ReturnType<SendMessage>>): string {
  if (!reply.ok) return "Couldn't reach Detour. Check your connection to the extension and retry.";
  if (!reply.value.ok && reply.value.errorType === "wrapup_unavailable") {
    return "Wrap-up time isn't available for this pass. Choose another option.";
  }
  return "Detour couldn't save your answer. Try again or choose another option.";
}

/**
 * Mounts the expiry follow-up modal in a closed Shadow DOM with focus trapping, key isolation
 * from host-page shortcuts, and error-retaining retry. The returned `shadow` reference exists so
 * callers (tests) can drive the closed root; the entrypoint ignores it, so nothing reaches the
 * host page's DOM or `window`.
 */
export function mountExpiryOverlay(
  context: ExpiredGrantContext | null,
  sendMessage: SendMessage,
): { readonly host: HTMLElement; readonly shadow: ShadowRoot; readonly unmount: () => void } {
  unmountActive?.();
  document.getElementById(OVERLAY_HOST_ID)?.remove();

  const active = document.activeElement;
  const previousFocus = active instanceof HTMLElement ? active : null;
  const parts = renderParts(context);
  let mounted = true;

  const onKey = (event: KeyboardEvent): void => {
    if (!parts.host.isConnected) {
      unmount();
      return;
    }
    // Keep host-page keyboard shortcuts from firing while the modal is open; default actions
    // (Enter/Space activating a focused button) still run.
    event.stopPropagation();
    if (event.type === "keydown" && event.key === "Tab") trapTab(parts, event);
  };

  function unmount(): void {
    if (!mounted) return;
    mounted = false;
    for (const type of KEY_EVENTS) window.removeEventListener(type, onKey, true);
    parts.host.remove();
    if (unmountActive === unmount) unmountActive = null;
    if (previousFocus?.isConnected === true) previousFocus.focus();
  }

  const submitVerdict = async (verdict: FollowupVerdict, button: HTMLButtonElement) => {
    setBusy(parts, true);
    parts.card.focus();
    const reply = await sendMessage({ type: "submit_followup", verdict });
    if (!mounted) return;
    if (reply.ok && reply.value.ok) {
      unmount();
      return;
    }
    if (reply.ok && !reply.value.ok && reply.value.errorType === "wrapup_unavailable") {
      disableWrapup(parts.wrapupButton, "Wrap-up unavailable");
    }
    setBusy(parts, false);
    parts.errorBanner.textContent = failureMessage(reply);
    parts.errorBanner.hidden = false;
    if (button.disabled) focusFirst(parts);
    else button.focus();
  };

  VERDICT_OPTIONS.forEach((option, index) => {
    const button = parts.verdictButtons[index];
    button?.addEventListener("click", () => void submitVerdict(option.verdict, button));
  });
  parts.wrapupButton.addEventListener(
    "click",
    () => void submitVerdict("wrapup_2m", parts.wrapupButton),
  );

  for (const type of KEY_EVENTS) window.addEventListener(type, onKey, true);
  document.documentElement.append(parts.host);
  unmountActive = unmount;
  focusFirst(parts);
  return { host: parts.host, shadow: parts.shadow, unmount };
}
