import { z } from "zod";

const DEV_CORS_ORIGIN = "http://localhost:5173";

const EnvSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    PORT: z.coerce.number().int().positive().default(3000),
    // Normalized to a bare origin so a trailing slash cannot cause a CORS mismatch.
    CORS_ORIGIN: z
      .url()
      .transform((value) => new URL(value).origin)
      .optional(),
    // Also allow pull request preview sites under this host suffix, for example
    // ".ai-wellness-coach.pages.dev". Leave unset to allow only CORS_ORIGIN.
    CORS_PREVIEW_HOST_SUFFIX: z
      .string()
      .regex(
        /^\.[a-z0-9-]+(\.[a-z0-9-]+)+$/,
        "CORS_PREVIEW_HOST_SUFFIX must look like .example.pages.dev",
      )
      .optional(),
    // Tenant domain only, for example "dev-abc123.us.auth0.com".
    AUTH0_DOMAIN: z
      .string()
      .regex(
        /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i,
        "AUTH0_DOMAIN must be a bare host name, without https://",
      ),
    // The Auth0 API identifier, for example "https://api.ai-wellness-coach".
    AUTH0_AUDIENCE: z.string().min(1),
    DATABASE_URL: z
      .string()
      .regex(
        /^postgres(ql)?:\/\//,
        "DATABASE_URL must be a postgres:// connection string",
      ),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && env.CORS_ORIGIN === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["CORS_ORIGIN"],
        message: "CORS_ORIGIN is required when NODE_ENV is production",
      });
    }
  })
  .transform((env) => ({
    PORT: env.PORT,
    CORS_ORIGIN: env.CORS_ORIGIN ?? DEV_CORS_ORIGIN,
    CORS_PREVIEW_HOST_SUFFIX: env.CORS_PREVIEW_HOST_SUFFIX,
    AUTH0_DOMAIN: env.AUTH0_DOMAIN,
    AUTH0_AUDIENCE: env.AUTH0_AUDIENCE,
    DATABASE_URL: env.DATABASE_URL,
  }));

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(
  source: Record<string, string | undefined> = process.env,
): Env {
  // A blank value (for example `PORT=` in a .env file) counts as unset.
  const present = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== ""),
  );
  return EnvSchema.parse(present);
}
