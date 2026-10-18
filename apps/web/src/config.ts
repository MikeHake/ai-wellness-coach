export function resolveApiBaseUrl(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === "") {
    throw new Error(
      "VITE_API_URL is not set. Copy apps/web/.env.example to apps/web/.env (or set it in your hosting settings).",
    );
  }
  // Drop trailing slashes so `${base}/health` never becomes `//health`.
  return raw.trim().replace(/\/+$/, "");
}

export const API_BASE_URL = resolveApiBaseUrl(import.meta.env.VITE_API_URL);
