import { ShieldCheck } from "lucide-react";
import { buildWorkosSignInUrl } from "../api/pairing.ts";

type AuthCardProps = {
  readonly userCode: string;
};

/**
 * Unauthenticated gate on `/pair`: delegates sign-in to WorkOS AuthKit hosted UI
 * (`/api/auth/sign-in`) and returns directly to `/pair?code=...` once authenticated.
 */
export function AuthCard({ userCode }: AuthCardProps) {
  const signInHref = buildWorkosSignInUrl(userCode);

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck aria-hidden className="size-4 text-accent" />
        <h2 className="text-lg font-medium">Sign in to pair Detour</h2>
      </div>
      <p className="text-sm text-fg-muted">
        Continue with WorkOS AuthKit to sign in or create your Detour account, then confirm this
        browser extension.
      </p>
      <a
        href={signInHref}
        className="inline-flex h-8 items-center justify-center self-start rounded-md bg-accent px-3 text-base font-medium text-accent-fg transition-colors hover:bg-accent-hover"
      >
        Continue to sign in
      </a>
    </section>
  );
}
