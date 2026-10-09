/**
 * Authentication seam. Every request passes through `headers()`; providers that can refresh
 * credentials (OAuth) return true from `refresh()` after a 401 so the client retries once.
 */

export interface AuthProvider {
  readonly type: string;
  headers(): Promise<Readonly<Record<string, string>>>;
  refresh?(): Promise<boolean>;
}
