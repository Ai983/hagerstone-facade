import { supabase } from "@/integrations/supabase/client";

/** Append a row to facade.audit_log. Never throws — auditing must not block the action. */
export async function logAudit(
  entity_type: string,
  entity_id: string | null,
  action: string,
  actor_id: string | null,
  meta?: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from("audit_log").insert({
      entity_type,
      entity_id,
      action,
      actor_id,
      meta: meta ?? null,
    });
  } catch (e) {
    // swallow — log to console only
    console.warn("audit_log insert failed", e);
  }
}
