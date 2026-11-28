import { assert, beforeEach, describe, expect, it } from "vite-plus/test";
import { fakeBrowser } from "wxt/testing/fake-browser";
import type { HttpTransport } from "./openrouter-pkce.adapter.ts";
import { openPairingTab, pollExtensionPairing, startExtensionPairing } from "./pairing.adapter.ts";
import { detectExtensionBrowser } from "./pairing.ts";

const startTransport: HttpTransport = (url) => {
  expect(url).toBe("http://localhost:3001/rpc/pairing/start");
  return Promise.resolve(
    new Response(
      JSON.stringify({
        json: {
          deviceCode: "dev-secret-1234567890",
          userCode: "ABCD-EFGH",
          verificationPath: "/pair?code=ABCD-EFGH",
          expiresAt: "2026-11-26T12:10:00.000Z",
          pollIntervalMs: 2000,
        },
      }),
      { status: 200 },
    ),
  );
};

const pollTransport: HttpTransport = () =>
  Promise.resolve(
    new Response(
      JSON.stringify({
        json: {
          status: "approved",
          accessToken: "dtr_secret_token",
          tokenId: "tok-1",
          expiresAt: "2027-02-24T12:00:00.000Z",
          scopes: ["extension:decide", "extension:profile"],
          user: { id: "u1", email: "alice@detour.test", name: "Alice" },
        },
      }),
      { status: 200 },
    ),
  );

describe("pairing.adapter", () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it("detects Chrome and Firefox user agents cleanly", () => {
    expect(detectExtensionBrowser("Mozilla/5.0 Gecko/20100101 Firefox/140.0")).toBe("firefox");
    expect(detectExtensionBrowser("Mozilla/5.0 Chrome/135.0.0.0 Safari/537.36")).toBe("chrome");
    expect(detectExtensionBrowser("CustomAgent/1.0")).toBe("other");
  });

  it("starts pairing, opens a normal browser tab via fakeBrowser, and polls until approved", async () => {
    const started = await startExtensionPairing(
      {
        apiOrigin: "http://localhost:3001",
        webOrigin: "http://localhost:5173",
        browserKind: "firefox",
        deviceName: "Firefox Extension",
      },
      startTransport,
    );
    assert(started.ok);
    expect(started.value.verificationUrl).toBe("http://localhost:5173/pair?code=ABCD-EFGH");

    const tabResult = await openPairingTab(started.value.verificationUrl);
    assert(tabResult.ok);

    const polled = await pollExtensionPairing(
      { apiOrigin: "http://localhost:3001", deviceCode: started.value.deviceCode },
      pollTransport,
    );
    assert(polled.ok);
    expect(polled.value).toMatchObject({
      status: "approved",
      accessToken: "dtr_secret_token",
      user: { email: "alice@detour.test" },
    });
  });
});
