import { oc } from "@orpc/contract";
import * as z from "zod";
import { AuthUserSchema } from "./auth.ts";
import { FORBIDDEN, NOT_FOUND, SERVICE_UNAVAILABLE, UNAUTHORIZED } from "./errors.ts";

export const PAIRING_BROWSERS = ["chrome", "firefox", "other"] as const;
export const PairingBrowserSchema = z.enum(PAIRING_BROWSERS);

export const EXTENSION_SCOPES = ["extension:decide", "extension:profile"] as const;
export const ExtensionScopeSchema = z.enum(EXTENSION_SCOPES);

export const PAIRING_CONFLICT_REASONS = ["already_decided", "expired"] as const;

const PairingConflict = {
  status: 409,
  message: "This pairing request can no longer be changed",
  data: z.object({ reason: z.enum(PAIRING_CONFLICT_REASONS) }),
};

export const PairingUserCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/i, "Use the 8-character code shown in the extension");

const StartInput = z.object({
  browser: PairingBrowserSchema,
  deviceName: z.string().trim().min(1).max(80),
});

const StartOutput = z.object({
  deviceCode: z.string(),
  userCode: z.string(),
  verificationPath: z.string(),
  expiresAt: z.date(),
  pollIntervalMs: z.number().int().positive(),
});

const PollInput = z.object({
  deviceCode: z.string().min(16).max(256),
});

const PollOutput = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending"), expiresAt: z.date() }),
  z.object({ status: z.literal("expired") }),
  z.object({ status: z.literal("denied") }),
  z.object({
    status: z.literal("approved"),
    accessToken: z.string(),
    tokenId: z.string(),
    expiresAt: z.date(),
    scopes: z.array(ExtensionScopeSchema),
    user: AuthUserSchema,
  }),
]);

const LookupInput = z.object({
  userCode: PairingUserCodeSchema,
});

const LookupOutput = z.object({
  userCode: z.string(),
  browser: PairingBrowserSchema,
  deviceName: z.string(),
  status: z.enum(["pending", "approved", "consumed", "denied", "expired"]),
  expiresAt: z.date(),
});

const DecideInput = z.object({
  userCode: PairingUserCodeSchema,
});

const DecideOutput = z.object({
  status: z.enum(["approved", "denied"]),
});

const PairedDeviceSchema = z.object({
  id: z.string(),
  browser: PairingBrowserSchema,
  deviceName: z.string(),
  scopes: z.array(ExtensionScopeSchema),
  createdAt: z.date(),
  expiresAt: z.date(),
  lastUsedAt: z.date().nullable(),
});

const RevokeDeviceInput = z.object({
  tokenId: z.uuid(),
});

const RevokeDeviceOutput = z.object({
  revoked: z.literal(true),
});

const start = oc.input(StartInput).output(StartOutput).errors({ SERVICE_UNAVAILABLE });
const poll = oc.input(PollInput).output(PollOutput).errors({ SERVICE_UNAVAILABLE, NOT_FOUND });
const lookup = oc
  .input(LookupInput)
  .output(LookupOutput)
  .errors({ SERVICE_UNAVAILABLE, UNAUTHORIZED, FORBIDDEN, NOT_FOUND });
const approve = oc.input(DecideInput).output(DecideOutput).errors({
  SERVICE_UNAVAILABLE,
  UNAUTHORIZED,
  FORBIDDEN,
  NOT_FOUND,
  CONFLICT: PairingConflict,
});
const deny = oc.input(DecideInput).output(DecideOutput).errors({
  SERVICE_UNAVAILABLE,
  UNAUTHORIZED,
  FORBIDDEN,
  NOT_FOUND,
  CONFLICT: PairingConflict,
});
const listDevices = oc
  .output(z.array(PairedDeviceSchema))
  .errors({ SERVICE_UNAVAILABLE, UNAUTHORIZED, FORBIDDEN });
const revokeDevice = oc
  .input(RevokeDeviceInput)
  .output(RevokeDeviceOutput)
  .errors({ SERVICE_UNAVAILABLE, UNAUTHORIZED, FORBIDDEN, NOT_FOUND });

export const pairing = {
  start,
  poll,
  lookup,
  approve,
  deny,
  listDevices,
  revokeDevice,
};
