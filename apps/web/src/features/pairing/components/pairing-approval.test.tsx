import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { renderWithApp } from "../../../testing/render-with-app.tsx";
import { rpcError, rpcOutput } from "../../../testing/rpc-responses.ts";
import { PairingApproval } from "./pairing-approval.tsx";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PairingApproval", () => {
  it("directs signed-out users to WorkOS AuthKit with returnTo preserved", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith("/rpc/auth/me")) return Promise.resolve(rpcError("UNAUTHORIZED", 401));
        return Promise.resolve(new Response(null, { status: 404 }));
      }),
    );

    await renderWithApp(<PairingApproval initialCode="ABCD-EFGH" />);

    const link = await screen.findByRole("link", { name: "Continue to sign in" });
    expect(link.getAttribute("href")).toBe("/api/auth/sign-in?returnTo=%2Fpair%3Fcode%3DABCD-EFGH");
  });

  it("lets a signed-in user inspect and approve a pending browser extension", async () => {
    const user = userEvent.setup();

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith("/rpc/auth/me")) {
          return Promise.resolve(
            rpcOutput({
              user: { id: "user_01wos", email: "alice@detour.test", name: "Alice" },
              sessionKind: "web_session",
              scopes: ["web:full"],
            }),
          );
        }
        if (url.endsWith("/rpc/pairing/lookup")) {
          return Promise.resolve(
            rpcOutput(
              {
                userCode: "ABCD-EFGH",
                browser: "firefox",
                deviceName: "Firefox on Linux",
                status: "pending",
                expiresAt: "2026-11-26T12:10:00.000Z",
              },
              ["expiresAt"],
            ),
          );
        }
        if (url.endsWith("/rpc/pairing/approve")) {
          return Promise.resolve(rpcOutput({ status: "approved" }));
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      }),
    );

    await renderWithApp(<PairingApproval initialCode="ABCD-EFGH" />);

    const approveButton = await screen.findByRole("button", { name: "Approve extension" });
    expect(screen.getByText(/Firefox on Linux/)).toBeDefined();
    await user.click(approveButton);

    expect(await screen.findByText(/Extension approved\. You can close this tab/)).toBeDefined();
  });
});
