import type { ContractRouterClient } from "@orpc/contract";
import { auth } from "./auth.ts";
import { pairing } from "./pairing.ts";
import { system } from "./system.ts";

/** The whole API. `apps/api` implements it, `apps/web` is typed from it. Add a module per key. */
export const contract = {
  auth,
  pairing,
  system,
};

/** Type of a client for the whole API, used by `apps/web` and API tests. */
export type ApiClient = ContractRouterClient<typeof contract>;

export {
  FORBIDDEN,
  NOT_FOUND,
  SERVICE_UNAVAILABLE,
  UNAUTHORIZED,
  UNAVAILABLE_REASONS,
} from "./errors.ts";
export {
  EXTENSION_SCOPES,
  ExtensionScopeSchema,
  PAIRING_BROWSERS,
  PairingBrowserSchema,
  PairingUserCodeSchema,
} from "./pairing.ts";
