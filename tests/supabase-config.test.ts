import { afterEach, describe, expect, it, vi } from "vitest";
import { getSupabasePublicConfig } from "../lib/supabase/config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getSupabasePublicConfig", () => {
  it("returns null if either public environment variable is missing", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    expect(getSupabasePublicConfig()).toBeNull();
  });

  it("returns the configured public URL and anon key", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-key");

    expect(getSupabasePublicConfig()).toEqual({
      url: "https://example.supabase.co",
      anonKey: "public-key",
    });
  });
});
