import { os } from "../../orpc/implementer.ts";
import { authenticated } from "../../orpc/procedures.ts";

const me = os.auth.me.use(authenticated).handler(({ context }) => {
  const scopes =
    context.session.kind === "extension_token" ? [...context.session.scopes] : ["web:full"];
  return {
    user: context.user,
    sessionKind: context.session.kind,
    scopes,
  };
});

export const authRouter = { me };
