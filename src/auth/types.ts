/**
 * Authentication seam. Every request passes through `headers()`; providers that can refresh
 * credentials (OAuth) return true from `refresh()` after a 401 so the client retries once.
 */

export interface AuthProvider {
  readonly type: string;
  headers(): Promise<Readonly<Record<string, string>>>;
  refresh?(): Promise<boolean>;
  /**
   * The headers `headers()` would add, for `--dry-run` previews. Only providers that know them
   * without network access (Basic) have it; a token flow (OAuth) leaves its headers out.
   */
  previewHeaders?(): Readonly<Record<string, string>>;
  /** Whose credentials are sent and where they came from, for the hint of a 401; never secrets. */
  readonly principal?: Principal;
  /**
   * Why no credentials are sent although some were configured (`Basic auth is switched off by
   * OPERATE_AUTH=none`, a password without a username), for the hint of a 401.
   */
  readonly off?: string;
}

export interface Principal {
  readonly user: string;
  /** `flag`, `env` or `profile`; `profile for the user, env for the password` when they differ. */
  readonly source: string;
}
