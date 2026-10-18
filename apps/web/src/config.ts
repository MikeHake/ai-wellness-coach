/** Returns a trimmed setting, or throws an error that explains how to fix it. */
export function requireSetting(name: string, raw: string | undefined): string {
  if (raw === undefined || raw.trim() === "") {
    throw new Error(
      `${name} is not set. Copy apps/web/.env.example to apps/web/.env (or set it in your hosting settings).`,
    );
  }
  return raw.trim();
}

export function resolveApiBaseUrl(raw: string | undefined): string {
  // Drop trailing slashes so `${base}/me` never becomes `//me`.
  return requireSetting("VITE_API_URL", raw).replace(/\/+$/, "");
}

export const API_BASE_URL = resolveApiBaseUrl(import.meta.env.VITE_API_URL);

// Public Auth0 identifiers (not secrets): they are visible to every browser.
export const AUTH0_DOMAIN = requireSetting(
  "VITE_AUTH0_DOMAIN",
  import.meta.env.VITE_AUTH0_DOMAIN,
);
export const AUTH0_CLIENT_ID = requireSetting(
  "VITE_AUTH0_CLIENT_ID",
  import.meta.env.VITE_AUTH0_CLIENT_ID,
);
export const AUTH0_AUDIENCE = requireSetting(
  "VITE_AUTH0_AUDIENCE",
  import.meta.env.VITE_AUTH0_AUDIENCE,
);
