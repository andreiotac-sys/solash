import { NextResponse } from "next/server";
import { getServerSupabase, isPushConfigured } from "@/lib/push-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isPushConfigured) {
    return NextResponse.json(
      { ok: false, error: "Push config missing." },
      { status: 500 }
    );
  }

  const body = (await request.json()) as { endpoint?: string };
  if (!body.endpoint) {
    return NextResponse.json(
      { ok: false, error: "Endpoint missing." },
      { status: 400 }
    );
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "Supabase service role missing." },
      { status: 500 }
    );
  }

  const { error } = await supabase
    .from("push_subscriptions")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("endpoint", body.endpoint);

  if (error) {
    return NextResponse.json(
      { ok: false, error: "Failed to unsubscribe." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
