import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/** Verifies an access token and returns its subject, or throws. */
export type VerifyToken = (token: string) => Promise<{ subject: string }>;

/** Auth0's issuer is the tenant URL with a trailing slash. */
export function auth0Issuer(domain: string): string {
  return `https://${domain}/`;
}

export function createTokenVerifier(options: {
  issuer: string;
  audience: string;
  getKey: JWTVerifyGetKey;
}): VerifyToken {
  return async (token) => {
    const { payload } = await jwtVerify(token, options.getKey, {
      issuer: options.issuer,
      audience: options.audience,
      // Only Auth0's signing algorithm. This also rules out "none" and HS256.
      algorithms: ["RS256"],
      // jose only checks exp when present, so require it explicitly.
      requiredClaims: ["exp", "sub"],
    });
    if (typeof payload.sub !== "string" || payload.sub === "") {
      throw new Error("Token has no subject");
    }
    return { subject: payload.sub };
  };
}

/** Verifier for real Auth0 tokens. Signing keys are fetched once and cached. */
export function createAuth0Verifier(
  domain: string,
  audience: string,
): VerifyToken {
  return createTokenVerifier({
    issuer: auth0Issuer(domain),
    audience,
    getKey: createRemoteJWKSet(
      new URL(`https://${domain}/.well-known/jwks.json`),
    ),
  });
}
