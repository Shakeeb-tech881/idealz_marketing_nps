import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Refreshes the Supabase session cookie and keeps signed-out users out of
 * /admin. This is a convenience redirect only — authorisation is enforced by
 * server-side role checks and database Row Level Security.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  if (!data.user && request.nextUrl.pathname.startsWith("/admin")) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = `?next=${encodeURIComponent(request.nextUrl.pathname)}`;
    return NextResponse.redirect(login);
  }
  // Signed in with a temporary password from a Super Admin: choose your own first.
  if (data.user?.app_metadata?.must_change_password === true && request.nextUrl.pathname.startsWith("/admin")) {
    const setPw = request.nextUrl.clone();
    setPw.pathname = "/auth/set-password";
    setPw.search = "?first=1";
    return NextResponse.redirect(setPw);
  }
  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/login"],
};
