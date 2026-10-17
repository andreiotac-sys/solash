import { pathToFileURL } from "node:url";
import nextEnv from "@next/env";

// No production data or privileged credentials may be bundled into a Preview.
// Do not print values: CI logs are not a safe place for credentials.
export function assertSafePreviewEnvironment(env) {
  if (env.VERCEL_ENV !== "preview") return;
  const url = env.NEXT_PUBLIC_SUPABASE_URL || "";
  if (url.includes("vholwdtqcrkohydydmnb")) {
    throw new Error(
      "Preview build refused: production Supabase project configured. Use an isolated project or blank demo variables.",
    );
  }
  if (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY) {
    throw new Error(
      "Preview build refused: privileged Supabase credentials configured. Remove them from Preview.",
    );
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  nextEnv.loadEnvConfig(process.cwd());
  assertSafePreviewEnvironment(process.env);
}
