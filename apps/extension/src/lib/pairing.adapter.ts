/**
 * Cross-browser tab-based pairing adapter for the extension.
 * Calls the API's oRPC endpoints over standard fetch (no cookies, no `launchWebAuthFlow`)
 * and opens a normal browser tab to `apps/web/pair?code=...`.
 */
import { err, ok, type Result } from "@detour/result";
import { browser } from "wxt/browser";
import type { HttpTransport } from "./openrouter-pkce.adapter.ts";
import {
  buildPairingVerificationUrl,
  type ExtensionBrowserKind,
  type PairingOriginError,
  type PairingPollState,
  type PairingStartResult,
} from "./pairing.ts";

export type PairingRequestError =
  | PairingOriginError
  | { readonly type: "network_error"; readonly cause: unknown }
  | { readonly type: "http_error"; readonly status: number }
  | { readonly type: "invalid_response" };

export type TabOpenError = { readonly type: "tab_open_failed"; readonly cause: unknown };

const defaultTransport: HttpTransport = (url, init) => globalThis.fetch(url, init);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

const readString = (record: Readonly<Record<string, unknown>>, key: string): string | null =>
  typeof record[key] === "string" ? record[key] : null;

const readNumber = (record: Readonly<Record<string, unknown>>, key: string): number | null =>
  typeof record[key] === "number" ? record[key] : null;

async function callRpcJson(
  apiOrigin: string,
  path: string,
  body: unknown,
  headers: Record<string, string>,
  transport: HttpTransport,
): Promise<Result<Readonly<Record<string, unknown>>, PairingRequestError>> {
  if (!URL.canParse(apiOrigin)) return err({ type: "invalid_origin" });
  const url = new URL(`/rpc/${path}`, apiOrigin).href;
  let response: Response;
  try {
    response = await transport(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ json: body }),
    });
  } catch (cause) {
    return err({ type: "network_error", cause });
  }
  if (!response.ok) return err({ type: "http_error", status: response.status });
  try {
    const parsed: unknown = await response.json();
    if (!isRecord(parsed) || !isRecord(parsed["json"])) return err({ type: "invalid_response" });
    return ok(parsed["json"]);
  } catch {
    return err({ type: "invalid_response" });
  }
}

export async function startExtensionPairing(
  input: {
    readonly apiOrigin: string;
    readonly webOrigin: string;
    readonly browserKind: ExtensionBrowserKind;
    readonly deviceName: string;
  },
  transport: HttpTransport = defaultTransport,
): Promise<Result<PairingStartResult, PairingRequestError>> {
  const rpc = await callRpcJson(
    input.apiOrigin,
    "pairing/start",
    { browser: input.browserKind, deviceName: input.deviceName },
    {},
    transport,
  );
  if (!rpc.ok) return rpc;
  const data = rpc.value;
  const deviceCode = readString(data, "deviceCode");
  const userCode = readString(data, "userCode");
  const verificationPath = readString(data, "verificationPath");
  const expiresAt = readString(data, "expiresAt");
  const pollIntervalMs = readNumber(data, "pollIntervalMs");
  if (
    deviceCode === null ||
    userCode === null ||
    verificationPath === null ||
    expiresAt === null ||
    pollIntervalMs === null
  ) {
    return err({ type: "invalid_response" });
  }

  const verificationUrl = buildPairingVerificationUrl(input.webOrigin, verificationPath);
  if (!verificationUrl.ok) return verificationUrl;

  return ok({
    deviceCode,
    userCode,
    verificationUrl: verificationUrl.value,
    expiresAt,
    pollIntervalMs,
  });
}

function parseApprovedPoll(data: Readonly<Record<string, unknown>>): PairingPollState | null {
  const accessToken = readString(data, "accessToken");
  const tokenId = readString(data, "tokenId");
  const expiresAt = readString(data, "expiresAt");
  const rawScopes = data["scopes"];
  const rawUser = data["user"];
  if (
    accessToken === null ||
    tokenId === null ||
    expiresAt === null ||
    !Array.isArray(rawScopes) ||
    !rawScopes.every((item) => typeof item === "string") ||
    !isRecord(rawUser)
  ) {
    return null;
  }
  const id = readString(rawUser, "id");
  const email = readString(rawUser, "email");
  const name = readString(rawUser, "name");
  if (id === null || email === null || name === null) return null;
  return {
    status: "approved",
    accessToken,
    tokenId,
    expiresAt,
    scopes: rawScopes,
    user: { id, email, name },
  };
}

export async function pollExtensionPairing(
  input: { readonly apiOrigin: string; readonly deviceCode: string },
  transport: HttpTransport = defaultTransport,
): Promise<Result<PairingPollState, PairingRequestError>> {
  const rpc = await callRpcJson(
    input.apiOrigin,
    "pairing/poll",
    { deviceCode: input.deviceCode },
    {},
    transport,
  );
  if (!rpc.ok) return rpc;
  const data = rpc.value;
  const status = readString(data, "status");
  if (status === "pending") {
    const expiresAt = readString(data, "expiresAt");
    return expiresAt === null
      ? err({ type: "invalid_response" })
      : ok({ status: "pending", expiresAt });
  }
  if (status === "expired") return ok({ status: "expired" });
  if (status === "denied") return ok({ status: "denied" });
  if (status === "approved") {
    const approved = parseApprovedPoll(data);
    return approved === null ? err({ type: "invalid_response" }) : ok(approved);
  }
  return err({ type: "invalid_response" });
}

export async function openPairingTab(
  url: string,
): Promise<Result<number | undefined, TabOpenError>> {
  try {
    const tab = await browser.tabs.create({ url });
    return ok(tab.id);
  } catch (cause) {
    return err({ type: "tab_open_failed", cause });
  }
}
