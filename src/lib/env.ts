import "server-only";
import { z } from "zod";

const serverSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  NEXT_PUBLIC_APP_URL: z.url(),
  SMS_PROVIDER: z.enum(["mock", "reachout"]).default("mock"),
  REACHOUT_API_BASE_URL: z.string().optional(),
  REACHOUT_API_KEY: z.string().optional(),
  REACHOUT_API_SECRET: z.string().optional(),
  REACHOUT_SENDER_ID: z.string().optional(),
  SMS_WEBHOOK_SECRET: z.string().optional(),
  CRON_SECRET: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

/** Validated server-side environment. Throws a descriptive error if misconfigured. */
export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid or missing environment variables: ${missing}. See .env.example.`);
  }
  cached = parsed.data;
  return cached;
}
