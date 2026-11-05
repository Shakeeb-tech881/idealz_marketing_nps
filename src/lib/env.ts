import "server-only";
import { z } from "zod";

/** Treat an empty Vercel variable the same as an unset one. */
const optionalUrl = z.preprocess((v) => (v === "" ? undefined : v), z.url().optional());

const serverSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  NEXT_PUBLIC_APP_URL: z.url(),
  SMS_PROVIDER: z.enum(["mock", "dialog_esms"]).default("mock"),
  // Dialog eSMS (https://e-sms.dialog.lk) — see docs/DEPLOYMENT.md
  DIALOG_ESMS_USERNAME: z.string().optional(),
  DIALOG_ESMS_PASSWORD: z.string().optional(),
  DIALOG_ESMS_SOURCE_ADDRESS: z.string().optional(),
  DIALOG_ESMS_PAYMENT_METHOD: z.coerce.number().int().default(0),
  DIALOG_ESMS_LOGIN_URL: optionalUrl,
  DIALOG_ESMS_API_BASE_URL: optionalUrl,
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
