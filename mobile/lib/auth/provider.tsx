import React, { createContext, useContext, useEffect, useState } from "react";
import { AppState } from "react-native";
import type { Session } from "@supabase/supabase-js";
import { configured, supabase } from "../supabase/client";

const AuthContext = createContext<{ session: Session | null; ready: boolean; error: string }>({ session: null, ready: false, error: "" });
export function AuthProvider({ children }: React.PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!configured) { setReady(true); return; }
    let alive = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!alive) return;
      setSession(data.session); setError(error?.message || ""); setReady(true);
    }).catch(() => { if (alive) { setError("Unable to restore your session. Please sign in."); setReady(true); } });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => { if (alive) { setSession(next); setReady(true); } });
    if (AppState.currentState === "active") supabase.auth.startAutoRefresh();
    const state = AppState.addEventListener("change", value => value === "active" ? supabase.auth.startAutoRefresh() : supabase.auth.stopAutoRefresh());
    return () => { alive = false; listener.subscription.unsubscribe(); state.remove(); supabase.auth.stopAutoRefresh(); };
  }, []);
  return <AuthContext.Provider value={{ session, ready, error }}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
