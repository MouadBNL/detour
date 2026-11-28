import { Button } from "@detour/ui";
import { KeyRound, Link2 } from "lucide-react";
import { useId, useState } from "react";
import {
  createOpenRouterPkceSession,
  exchangeOpenRouterCode,
  type PkceSession,
} from "../../lib/openrouter-pkce.adapter.ts";
import { parseOpenRouterCallbackUrl } from "../../lib/openrouter-pkce.ts";
import {
  openPairingTab,
  pollExtensionPairing,
  startExtensionPairing,
} from "../../lib/pairing.adapter.ts";
import { detectExtensionBrowser, type PairingStartResult } from "../../lib/pairing.ts";

const DEFAULT_API_ORIGIN = "http://localhost:3001";
const DEFAULT_WEB_ORIGIN = "http://localhost:5173";

function PairingSection() {
  const [pairing, setPairing] = useState<PairingStartResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleStart() {
    const browserKind = detectExtensionBrowser(navigator.userAgent);
    const started = await startExtensionPairing({
      apiOrigin: DEFAULT_API_ORIGIN,
      webOrigin: DEFAULT_WEB_ORIGIN,
      browserKind,
      deviceName: browserKind === "firefox" ? "Firefox Extension" : "Chrome Extension",
    });
    if (!started.ok) {
      setMessage("Could not start pairing with the Detour API.");
      return;
    }
    setPairing(started.value);
    const opened = await openPairingTab(started.value.verificationUrl);
    setMessage(
      opened.ok
        ? `Confirm code ${started.value.userCode} in the tab that opened.`
        : `Open ${started.value.verificationUrl} and confirm code ${started.value.userCode}.`,
    );
  }

  async function handlePoll() {
    if (pairing === null) return;
    const polled = await pollExtensionPairing({
      apiOrigin: DEFAULT_API_ORIGIN,
      deviceCode: pairing.deviceCode,
    });
    if (!polled.ok) {
      setMessage("Could not check pairing status.");
      return;
    }
    setMessage(
      polled.value.status === "approved"
        ? `Paired as ${polled.value.user.email}.`
        : `Status: ${polled.value.status}.`,
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center gap-2">
        <Link2 className="size-4 text-accent" aria-hidden="true" />
        <h2 className="text-base font-medium">Managed account (tab pairing)</h2>
      </div>
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => void handleStart()}>
          Pair with Detour account
        </Button>
        {pairing !== null ? (
          <Button variant="secondary" onClick={() => void handlePoll()}>
            Check approval
          </Button>
        ) : null}
      </div>
      {message !== null ? <output className="text-sm text-fg-muted">{message}</output> : null}
    </section>
  );
}

function OpenRouterSection() {
  const codeInputId = useId();
  const [pkce, setPkce] = useState<PkceSession | null>(null);
  const [authCode, setAuthCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function handleStart() {
    const session = await createOpenRouterPkceSession({ keyLabel: "Detour" });
    if (!session.ok) {
      setMessage("Could not initialize OpenRouter PKCE session.");
      return;
    }
    setPkce(session.value);
    const opened = await openPairingTab(session.value.authUrl);
    setMessage(
      opened.ok
        ? "Authorize Detour in OpenRouter, then paste the one-time code below."
        : `Open ${session.value.authUrl}, authorize Detour, then paste the one-time code below.`,
    );
  }

  async function handleExchange() {
    if (pkce === null || authCode.trim().length === 0) return;
    const trimmed = authCode.trim();
    const resolvedCode =
      trimmed.startsWith("http://") || trimmed.startsWith("https://")
        ? parseOpenRouterCallbackUrl(trimmed, pkce.state)
        : null;
    if (resolvedCode !== null && !resolvedCode.ok) {
      setMessage("Callback URL is missing a valid code or failed state verification.");
      return;
    }
    const exchanged = await exchangeOpenRouterCode({
      code: resolvedCode === null ? trimmed : resolvedCode.value.code,
      codeVerifier: pkce.codeVerifier,
    });
    setMessage(
      exchanged.ok
        ? "OpenRouter connected. Key received directly by the extension."
        : "OpenRouter rejected the code. Restart the flow and try again.",
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 text-accent" aria-hidden="true" />
        <h2 className="text-base font-medium">BYOK via OpenRouter PKCE</h2>
      </div>
      <Button variant="secondary" className="self-start" onClick={() => void handleStart()}>
        Connect OpenRouter (headless PKCE)
      </Button>
      {pkce !== null ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={codeInputId} className="text-sm text-fg-muted">
            One-time OpenRouter code
          </label>
          <input
            id={codeInputId}
            className="rounded-md border border-line bg-canvas px-3 py-2 text-sm text-fg"
            value={authCode}
            onChange={(event) => setAuthCode(event.target.value)}
          />
          <Button variant="primary" className="self-start" onClick={() => void handleExchange()}>
            Finish OpenRouter setup
          </Button>
        </div>
      ) : null}
      {message !== null ? <output className="text-sm text-fg-muted">{message}</output> : null}
    </section>
  );
}

export function ConnectPage() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 bg-canvas p-6 text-fg">
      <h1 className="text-2xl font-semibold">Connect Detour</h1>
      <PairingSection />
      <OpenRouterSection />
    </main>
  );
}
