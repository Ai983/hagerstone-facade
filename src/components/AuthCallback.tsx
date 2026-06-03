import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

/**
 * SSO token handoff from the hub portal.
 *
 * The hub redirects here with the Supabase session in the URL — either as a
 * hash fragment (#access_token=...&refresh_token=...), as query params
 * (?access_token=...&refresh_token=...), or as an OAuth/PKCE code (?code=...).
 * We hydrate the Supabase session from whichever is present, then bounce to
 * the dashboard. AuthContext's onAuthStateChange picks up the new session and
 * resolves the hub employee.
 *
 * Route: /auth/callback
 */
export const AuthCallback: React.FC = () => {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      try {
        const url = new URL(window.location.href);
        const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
        const query = url.searchParams;

        const access_token = hash.get("access_token") || query.get("access_token");
        const refresh_token = hash.get("refresh_token") || query.get("refresh_token");
        const code = query.get("code");

        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (error) throw error;
        } else if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else {
          // Maybe a session already exists (e.g. same-origin handoff)
          const { data } = await supabase.auth.getSession();
          if (!data.session) throw new Error("No session token found in callback URL.");
        }

        // Clean the URL of tokens before navigating
        window.history.replaceState({}, document.title, "/auth/callback");
        navigate("/dashboard", { replace: true });
      } catch (e: any) {
        setError(e?.message ?? "Sign-in failed");
      }
    };
    run();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      {error ? (
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-xl font-semibold">Sign-in failed</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
          <button
            className="text-sm underline"
            onClick={() => navigate("/login", { replace: true })}
          >
            Back to login
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          <span>Signing you in…</span>
        </div>
      )}
    </div>
  );
};

export default AuthCallback;
