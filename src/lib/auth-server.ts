import { createClient } from "@supabase/supabase-js";

export const isAuthenticatedRequest = async (request: Request): Promise<boolean> => {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!token || !url || !publishableKey) return false;
  const authClient = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const result = await authClient.auth.getUser(token);
  return Boolean(result.data.user && !result.error);
};
