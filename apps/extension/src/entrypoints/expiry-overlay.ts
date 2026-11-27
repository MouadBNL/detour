import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import overlayCss from "../lib/expiry-overlay.css?inline";
import type { ExpiredGrantContext } from "../lib/guard-state.ts";
import type { FollowupVerdict } from "../lib/messages.ts";
import { sendExtensionMessage } from "../lib/runtime.adapter.ts";

const OVERLAY_HOST_ID = "detour-expiry-overlay-host";

const VERDICT_OPTIONS: readonly { readonly verdict: FollowupVerdict; readonly label: string }[] = [
  { verdict: "worth_it", label: "Got what I came for" },
  { verdict: "drifted", label: "Drifted" },
  { verdict: "not_worth_it", label: "Wasn't worth it" },
];

function createButton(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = primary ? "detour-btn detour-btn-primary" : "detour-btn";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function renderOverlay(context: ExpiredGrantContext | null): void {
  document.getElementById(OVERLAY_HOST_ID)?.remove();

  const host = document.createElement("div");
  host.id = OVERLAY_HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = overlayCss;
  shadow.append(style);

  const card = document.createElement("section");
  card.className = "detour-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", "Detour pass expired");

  const domain = context?.domain ?? window.location.hostname;
  const eyebrow = document.createElement("p");
  eyebrow.className = "detour-eyebrow";
  eyebrow.textContent = `Detour · ${domain}`;

  const title = document.createElement("h2");
  title.className = "detour-title";
  title.textContent =
    context !== null ? `${String(context.durationMinutes)} min elapsed` : "Time is up";

  const quote = document.createElement("p");
  quote.className = "detour-quote";
  quote.textContent =
    context && context.reason.length > 0
      ? `You came here for "${context.reason}".`
      : "Your pass for this site has expired.";

  const actions = document.createElement("div");
  actions.className = "detour-actions";

  const submitVerdict = (verdict: FollowupVerdict): void => {
    void sendExtensionMessage({ type: "submit_followup", domain, verdict }).then(() => {
      host.remove();
    });
  };

  for (const option of VERDICT_OPTIONS) {
    actions.append(createButton(option.label, false, () => submitVerdict(option.verdict)));
  }
  actions.append(createButton("2 more minutes to wrap up", true, () => submitVerdict("wrapup_2m")));

  card.append(eyebrow, title, quote, actions);
  shadow.append(card);
  document.documentElement.append(host);
}

export default defineUnlistedScript(() => {
  void sendExtensionMessage({ type: "get_expiry_context" }).then((reply) => {
    const context =
      reply.ok && reply.value.ok && reply.value.type === "expiry_context"
        ? reply.value.context
        : null;
    renderOverlay(context);
  });
});
