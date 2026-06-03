-- ============================================================================
-- facade_003_ai_source.sql
-- F6 AI assists: record provenance of AI-prefilled estimate line areas.
-- Additive + idempotent.
-- ============================================================================

alter table facade.estimate_lines
  add column if not exists area_source text not null default 'manual',  -- manual|ai
  add column if not exists ai_confidence numeric(5,2),
  add column if not exists ai_confidence_reason text;
