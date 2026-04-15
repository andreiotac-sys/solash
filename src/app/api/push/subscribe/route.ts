import { NextResponse } from "next/server";
import { getServerSupabase, isPushConfigured } from "@/lib/push-server";

export const runtime = "nodejs";

type PushSubscriptionInput = {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export async function POST(request: Request) {
  if (!isPushConfigured) {
    return NextResponse.json(
      { ok: false, error: "Push config missing." },
      { status: 500 }
    );
  }

  const body = (await request.json()) as { subscription?: PushSubscriptionInput };
  if (!body.subscription?.endpoint) {
    return NextResponse.json(
      { ok: false, error: "Invalid subscription." },
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

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      endpoint: body.subscription.endpoint,
      expiration_time: body.subscription.expirationTime,
      p256dh: body.subscription.keys.p256dh,
      auth: body.subscription.keys.auth,
      active: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" }
  );

  if (error) {
    return NextResponse.json(
      { ok: false, error: "Failed to save subscription." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
