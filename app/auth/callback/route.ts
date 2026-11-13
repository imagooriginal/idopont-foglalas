import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ALLOWED_OTP_TYPES = new Set<EmailOtpType>([
  "invite",
  "recovery",
  "email",
  "signup",
  "magiclink",
  "email_change",
]);

function resolveSafeNextPath(nextParam: string | null, typeParam: string | null): string {
  if (nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")) {
    return nextParam;
  }
  if (typeParam === "invite" || typeParam === "recovery") {
    return "/dashboard/reset-password";
  }
  return "/dashboard";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const typeParam = url.searchParams.get("type");
  const nextPath = resolveSafeNextPath(url.searchParams.get("next"), typeParam);

  try {
    const supabase = await createSupabaseServerClient();

    if (code) {
      await supabase.auth.exchangeCodeForSession(code);
    } else if (
      tokenHash &&
      typeParam &&
      ALLOWED_OTP_TYPES.has(typeParam as EmailOtpType)
    ) {
      await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: typeParam as EmailOtpType,
      });
    }
  } catch (err) {
    console.error("Auth callback session exchange failed:", err);
  }

  return NextResponse.redirect(new URL(nextPath, url.origin));
}
