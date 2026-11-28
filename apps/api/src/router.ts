import { authRouter } from "./modules/auth/index.ts";
import { pairingRouter } from "./modules/pairing/index.ts";
import { systemRouter } from "./modules/system/index.ts";
import { os } from "./orpc/implementer.ts";

/** `.router()` checks the whole tree against the contract, at compile time and at runtime. */
export const router = os.router({
  auth: authRouter,
  pairing: pairingRouter,
  system: systemRouter,
});
