-- ============================================================================
-- facade_018_finance_quote.sql  — Step 8 (Finance) + Step 5 (Quotation letter)
-- Finance: enhance the existing payments table for receivables/payables tracking
--   (a vendor payable is created from an MRN). Export-only; no finance-schema writes.
-- Quotation: add the fields needed for the Brawn-Globus letter format.
-- Additive + idempotent.
-- ============================================================================

-- Finance: payments become two-directional with payment tracking + MRN link
alter table facade.payments add column if not exists direction text default 'receivable'; -- receivable|payable
alter table facade.payments add column if not exists mrn_id uuid references facade.material_receiving_notes(id);
alter table facade.payments add column if not exists due_date date;
alter table facade.payments add column if not exists paid_amount numeric(18,2) default 0;
alter table facade.payments add column if not exists vendor_gstin text;
alter table facade.payments add column if not exists invoice_ref text;

-- Quotation: Brawn-Globus letter fields
alter table facade.quotations add column if not exists greeting_name text;        -- "Mr. Sumit Gogia"
alter table facade.quotations add column if not exists subject text;
alter table facade.quotations add column if not exists body_text text;
alter table facade.quotations add column if not exists price_per_sqft numeric(12,2);
alter table facade.quotations add column if not exists payment_terms_a text;
alter table facade.quotations add column if not exists payment_terms_b text;
alter table facade.quotations add column if not exists payment_terms_c text;
alter table facade.quotations add column if not exists payment_terms_d text;

notify pgrst, 'reload schema';
