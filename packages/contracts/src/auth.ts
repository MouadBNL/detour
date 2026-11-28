import { oc } from "@orpc/contract";
import * as z from "zod";
import { SERVICE_UNAVAILABLE, UNAUTHORIZED } from "./errors.ts";

export const AuthUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
});

const ViewerSchema = z.object({
  user: AuthUserSchema,
  sessionKind: z.enum(["web_session", "extension_token"]),
  scopes: z.array(z.string()),
});

/** Current authenticated viewer (works for both web sessions and extension bearer tokens). */
const me = oc.output(ViewerSchema).errors({ SERVICE_UNAVAILABLE, UNAUTHORIZED });

export const auth = { me };
