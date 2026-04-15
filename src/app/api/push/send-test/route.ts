import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getServerSupabase, isPushConfigured, sendPush } from "@/lib/push-server";

export const runtime = "nodejs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export async function POST(request: Request) {
  if (!isPushConfigured) {
    return NextResponse.json(
      { ok: false, error: "Push config missing." },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token || !supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const authSupabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const userResponse = await authSupabase.auth.getUser(token);
  if (userResponse.error || !userResponse.data.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "Supabase service role missing." },
      { status: 500 }
    );
  }

  const subscriptionsResponse = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("active", true);

  if (subscriptionsResponse.error) {
    return NextResponse.json(
      { ok: false, error: "Failed to load subscriptions." },
      { status: 500 }
    );
  }

  let sent = 0;
  for (const row of subscriptionsResponse.data) {
    try {
      await sendPush(
        {
          endpoint: row.endpoint,
          expirationTime: null,
          keys: {
            p256dh: row.p256dh,
            auth: row.auth,
          },
        },
        {
          title: "SoLash",
          body: "Test notificare. Daca vezi asta, push-ul functioneaza.",
          url: "/",
        }
      );
      sent += 1;
    } catch {
      await supabase
        .from("push_subscriptions")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("endpoint", row.endpoint);
    }
  }

  return NextResponse.json({ ok: true, sent });
}
