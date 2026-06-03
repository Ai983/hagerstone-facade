import { createClient } from "@supabase/supabase-js";

// Hub Project (shared with cps). Facade owns the `facade` schema only.
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://tpfvnerrjhqwipyonngf.supabase.co";
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwZnZuZXJyamhxd2lweW9ubmdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4Nzg3MjAsImV4cCI6MjA5MzQ1NDcyMH0.JFH5Z5mznhJKxNpecM1ebWutIltHzdoTgdDiSL4NM5c";

// Default schema is `facade`. The hub login tables (employees, roles) live in
// `public`; query them with `supabase.schema("public").from(...)`.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage: localStorage, persistSession: true, autoRefreshToken: true },
  db: { schema: "facade" },
});

// Convenience handle for hub (public schema) reads — employees, roles, etc.
export const hub = supabase.schema("public");
