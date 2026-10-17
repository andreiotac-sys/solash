import test from "node:test";
import assert from "node:assert/strict";
import { assertSafePreviewEnvironment } from "../scripts/check-build-environment.mjs";

test("Preview refuses production Supabase and privileged keys without logging their values", () => {
  for (const env of [
    { NEXT_PUBLIC_SUPABASE_URL: "https://vholwdtqcrkohydydmnb.supabase.co" },
    { SUPABASE_SERVICE_ROLE_KEY: "sensitive-test-value" },
    { SUPABASE_SECRET_KEY: "sensitive-test-value" },
  ]) {
    assert.throws(
      () => assertSafePreviewEnvironment({ VERCEL_ENV: "preview", ...env }),
      (error) =>
        !error.message.includes("sensitive-test-value") &&
        error.message.includes("Preview build refused"),
    );
  }
});
test("Blank demo and isolated unprivileged Preview builds remain possible", () => {
  assert.doesNotThrow(() =>
    assertSafePreviewEnvironment({ VERCEL_ENV: "preview" }),
  );
  assert.doesNotThrow(() =>
    assertSafePreviewEnvironment({
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_SUPABASE_URL: "https://isolated-fixture.supabase.co",
    }),
  );
});
test("Production and local builds retain the existing configuration", () => {
  assert.doesNotThrow(() =>
    assertSafePreviewEnvironment({
      VERCEL_ENV: "production",
      SUPABASE_SERVICE_ROLE_KEY: "fixture",
    }),
  );
  assert.doesNotThrow(() =>
    assertSafePreviewEnvironment({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    }),
  );
});
