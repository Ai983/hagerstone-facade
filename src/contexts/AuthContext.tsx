import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase, hub } from "@/integrations/supabase/client";

// Roles come from the hub (public.roles). Facade reuses existing roles.
export type HubRole =
  | "admin"
  | "ai"
  | "founder"
  | "management"
  | "project_manager"
  | "procurement"
  | "finance"
  | "hr"
  | "mis"
  | "site_engineer"
  | (string & {});

export interface FacadeUser {
  id: string; // public.employees.id (uuid) — used as created_by everywhere
  auth_user_id: string;
  email: string;
  name: string;
  role: HubRole;
  department?: string | null;
  designation?: string | null;
  is_active: boolean;
}

interface AuthContextType {
  user: FacadeUser | null;
  loading: boolean;
  /** true when an auth session exists but the email has no facade-enabled employee record */
  noAccess: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  // Capability flags (PRD §3)
  canViewMargin: boolean; // founders/management/admin/ai see OH&profit build-up
  canApprove: boolean; // approve quotations
  canManageRates: boolean; // edit rate cards / systems / materials / definitions
  canCreate: boolean; // create projects, estimates, quotations, run stages
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};

const FACADE_MODULE = "facade";

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<FacadeUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [noAccess, setNoAccess] = useState(false);

  const loadProfile = async (authUid: string, email?: string) => {
    // 1. Resolve the hub employee by auth_user_id
    let { data: emp } = await hub
      .from("employees")
      .select("id, auth_user_id, email, name, role, department, designation, is_active")
      .eq("auth_user_id", authUid)
      .maybeSingle();

    // 2. Fallback: by email (employee pre-created before auth link)
    if (!emp && email) {
      const res = await hub
        .from("employees")
        .select("id, auth_user_id, email, name, role, department, designation, is_active")
        .eq("email", email)
        .maybeSingle();
      emp = res.data ?? null;
    }

    if (!emp || emp.is_active === false) {
      setUser(null);
      setNoAccess(true);
      localStorage.removeItem("facade_user");
      return;
    }

    const facadeUser: FacadeUser = {
      id: emp.id,
      auth_user_id: emp.auth_user_id ?? authUid,
      email: emp.email,
      name: emp.name,
      role: emp.role,
      department: emp.department,
      designation: emp.designation,
      is_active: emp.is_active ?? true,
    };
    setUser(facadeUser);
    setNoAccess(false);
    localStorage.setItem("facade_user", JSON.stringify(facadeUser));
  };

  useEffect(() => {
    const saved = localStorage.getItem("facade_user");
    if (saved) {
      try {
        setUser(JSON.parse(saved));
      } catch {
        /* ignore */
      }
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) loadProfile(session.user.id, session.user.email ?? undefined);
      setLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) loadProfile(session.user.id, session.user.email ?? undefined);
      else {
        setUser(null);
        setNoAccess(false);
        localStorage.removeItem("facade_user");
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error };
    if (data.user) await loadProfile(data.user.id, data.user.email ?? undefined);
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setNoAccess(false);
    localStorage.removeItem("facade_user");
  };

  const role = user?.role;
  const isAdmin = role === "admin" || role === "ai";
  const isLeadership = isAdmin || role === "founder" || role === "management";

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        noAccess,
        signIn,
        signOut,
        canViewMargin: isLeadership,
        canApprove: isLeadership,
        canManageRates: isAdmin,
        canCreate: isLeadership || role === "project_manager",
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export { FACADE_MODULE };
