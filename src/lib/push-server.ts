import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT ?? "mailto:admin@solash.app";

export const isPushConfigured = Boolean(
  supabaseUrl &&
    serviceRoleKey &&
    vapidPublicKey &&
    vapidPrivateKey
);

export const getServerSupabase = () => {
  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
};

let vapidConfigured = false;
export const ensureVapid = () => {
  if (vapidConfigured) {
    return;
  }
  if (!vapidPublicKey || !vapidPrivateKey) {
    return;
  }
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  vapidConfigured = true;
};

export const sendPush = async (
  subscription: webpush.PushSubscription,
  payload: Record<string, string | number | boolean>
) => {
  ensureVapid();
  await webpush.sendNotification(subscription, JSON.stringify(payload));
};
