/**
 * Pairing against the real Worker and a local D1 (workerd): what runs only there and not in the
 * `node:sqlite` unit tests. The extension's side is driven through the RPC wire format, as the
 * extension sends it; the web side is a signed-out visit to `/pair`, which must ask for sign-in
 * (approving needs a WorkOS account, so this journey stops there).
 */
import { expect, test } from "@playwright/test";
import * as z from "zod";

const StartOutput = z.object({
  json: z.object({
    deviceCode: z.string(),
    userCode: z.string(),
    verificationPath: z.string(),
    expiresAt: z.string(),
  }),
});

test("an extension starts pairing on D1 and a signed-out visitor is asked to sign in", async ({
  page,
  request,
}) => {
  const started = await request.post("/rpc/pairing/start", {
    data: { json: { browser: "firefox", deviceName: `E2E ${crypto.randomUUID()}` } },
  });
  expect(started.status()).toBe(200);
  const { json } = StartOutput.parse(await started.json());
  expect(Date.parse(json.expiresAt)).toBeGreaterThan(Date.now());

  // Read back from D1: the row and its timestamp column round-trip through workerd.
  const polled = await request.post("/rpc/pairing/poll", {
    data: { json: { deviceCode: json.deviceCode } },
  });
  expect(polled.status()).toBe(200);
  expect(await polled.json()).toMatchObject({
    json: { status: "pending", expiresAt: json.expiresAt },
  });

  await page.goto(json.verificationPath);
  await expect(page.getByRole("heading", { name: "Sign in to pair Detour" })).toBeVisible();
  const signIn = page.getByRole("link", { name: "Continue to sign in" });
  await expect(signIn).toHaveAttribute("href", /\/api\/auth\/sign-in\?returnTo=/);
});
