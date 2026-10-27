import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { fetchSupabase } from "@/lib/supabase/fetch";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const pathname = request.nextUrl.pathname;
  const isPublic =
    pathname === "/login" ||
    pathname === "/forgot-password" ||
    pathname === "/auth/callback" ||
    pathname === "/auth/update-password" ||
    pathname === "/api/auth/login" ||
    pathname === "/api/health" ||
    pathname.startsWith("/branch-setup/");

  // Public entry points must remain available even when the external auth
  // provider is briefly unavailable. Authentication is performed by their
  // route handlers or forms instead of blocking here in Proxy.
  if (isPublic) return response;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    global: { fetch: fetchSupabase },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  let hasClaims = false;
  try {
    const result = await supabase.auth.getClaims();
    hasClaims = Boolean(result.data?.claims);
  } catch {
    hasClaims = false;
  }

  if (!hasClaims && pathname.startsWith("/api/")) {
    return response;
  }

  if (!hasClaims && !pathname.startsWith("/_next")) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
