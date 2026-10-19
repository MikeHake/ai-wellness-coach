/**
 * Decides which web origins may call the API. Returns the origin to echo back
 * in Access-Control-Allow-Origin, or null to refuse.
 *
 * Allowed: the exact production origin, plus (when a suffix is given) a pull
 * request preview site, which must be https and exactly one label in front of
 * the suffix, like https://my-branch.ai-wellness-coach.pages.dev. Only our own
 * Cloudflare Pages project can create names under that suffix.
 */
export function createOriginMatcher(options: {
  origin: string;
  previewHostSuffix?: string | undefined;
}) {
  const { origin: allowed, previewHostSuffix } = options;
  const preview =
    previewHostSuffix === undefined
      ? undefined
      : new RegExp(
          `^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?${escapeRegExp(previewHostSuffix)}$`,
        );

  return (candidate: string): string | null => {
    if (candidate === allowed) return candidate;
    if (preview?.test(candidate) === true) return candidate;
    return null;
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
