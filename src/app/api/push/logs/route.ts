import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/push-server";

export const runtime = "nodejs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export async function GET(request: Request) {
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

  const logsResponse = await supabase
    .from("push_delivery_logs")
    .select("id, source, title, body, sent_count, reminders_count, created_at")
    .order("created_at", { ascending: false })
    .limit(25);

  if (logsResponse.error) {
    return NextResponse.json(
      { ok: false, error: "Failed to load push logs." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, logs: logsResponse.data });
}
