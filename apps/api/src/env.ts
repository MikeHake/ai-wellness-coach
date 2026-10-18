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
  }));

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // A blank value (for example `PORT=` in a .env file) counts as unset.
  const present = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== ""),
  );
  return EnvSchema.parse(present);
}
