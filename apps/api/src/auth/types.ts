export type AuthUser = {
  readonly id: string;
  readonly email: string;
  readonly name: string;
};

export type WebSession = {
  readonly kind: "web_session";
  readonly sessionId: string;
  readonly user: AuthUser;
};

export type ExtensionTokenSession = {
  readonly kind: "extension_token";
  readonly tokenId: string;
  readonly scopes: readonly string[];
  readonly user: AuthUser;
};

export type RequestSession = WebSession | ExtensionTokenSession;

/** A verified web session, plus the re-sealed cookie when the access token had to be refreshed. */
export type VerifiedWebSession = {
  readonly session: WebSession;
  readonly refreshedSealedSession: string | null;
};
