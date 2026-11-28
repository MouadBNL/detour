import type { ApiClient, contract } from "@detour/contracts";
import { isDefinedError, safe } from "@orpc/client";
import { describe, expect, it } from "vite-plus/test";
import { createTestApp } from "../../testing/test-app.ts";

type Contract = typeof contract;
type ProcedureLeaf = { readonly "~orpc": { readonly errorMap: object } };
type RefusalEntry =
  | { readonly access: "public"; readonly call: (client: ApiClient) => Promise<unknown> }
  | { readonly access: "protected"; readonly call: (client: ApiClient) => Promise<unknown> };

/**
 * Typed from the root contract so adding any new procedure fails type-checking until its
 * signed-out refusal policy is explicitly declared and tested here (`docs/backend.md`).
 */
type RefusalTable<T> = {
  readonly [K in keyof T]: T[K] extends ProcedureLeaf ? RefusalEntry : RefusalTable<T[K]>;
};

const REFUSAL_TABLE: RefusalTable<Contract> = {
  system: {
    health: {
      access: "public",
      call: (client) => client.system.health(),
    },
  },
  auth: {
    me: {
      access: "protected",
      call: (client) => client.auth.me(),
    },
  },
  pairing: {
    start: {
      access: "public",
      call: (client) => client.pairing.start({ browser: "chrome", deviceName: "Chrome" }),
    },
    poll: {
      access: "public",
      call: (client) => client.pairing.poll({ deviceCode: "0123456789abcdef0123456789abcdef" }),
    },
    lookup: {
      access: "protected",
      call: (client) => client.pairing.lookup({ userCode: "ABCD-EFGH" }),
    },
    approve: {
      access: "protected",
      call: (client) => client.pairing.approve({ userCode: "ABCD-EFGH" }),
    },
    deny: {
      access: "protected",
      call: (client) => client.pairing.deny({ userCode: "ABCD-EFGH" }),
    },
    listDevices: {
      access: "protected",
      call: (client) => client.pairing.listDevices(),
    },
    revokeDevice: {
      access: "protected",
      call: (client) =>
        client.pairing.revokeDevice({ tokenId: "00000000-0000-4000-8000-000000000000" }),
    },
  },
};

type Flattened = { readonly path: string; readonly entry: RefusalEntry };

const ALL_ENTRIES: readonly Flattened[] = Object.entries(REFUSAL_TABLE).flatMap(([group, procs]) =>
  Object.entries(procs).map(([name, entry]) => ({ path: `${group}.${name}`, entry })),
);

const PROTECTED_ENTRIES = ALL_ENTRIES.filter((item) => item.entry.access === "protected");
const PUBLIC_ENTRIES = ALL_ENTRIES.filter((item) => item.entry.access === "public");

describe("auth refusal table", () => {
  for (const { path, entry } of PROTECTED_ENTRIES) {
    it(`${path} refuses signed-out callers with UNAUTHORIZED`, async () => {
      const t = await createTestApp();
      const [error] = await safe(entry.call(t.client));
      expect(isDefinedError(error)).toBe(true);
      expect(error).toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    });
  }

  for (const { path, entry } of PUBLIC_ENTRIES) {
    it(`${path} stays accessible when signed out`, async () => {
      const t = await createTestApp();
      const [error] = await safe(entry.call(t.client));
      const unauthorized =
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "UNAUTHORIZED";
      expect(unauthorized).toBe(false);
    });
  }
});

describe("extension CORS", () => {
  it("allows Chrome and Firefox extension origins on /rpc CORS preflight without credentials", async () => {
    const t = await createTestApp();
    for (const origin of [
      "chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef",
      "moz-extension://12345678-1234-1234-1234-1234567890ab",
    ]) {
      const response = await t.fetch("/rpc/auth/me", {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization,content-type",
        },
      });
      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
      expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    }
  });
});
