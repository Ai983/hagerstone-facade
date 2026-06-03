-- ============================================================================
-- facade_002_seed.sql  (generated from Consumption (1).xlsx via scripts/gen-seed.mjs)
-- Verified: all 6 systems reproduce the Excel "Rate per sqm" within ₹1.
-- Additive + idempotent (upsert by natural keys; members/materials re-seeded).
-- ============================================================================

-- 1) Active rate card (PRD §6 verified globals)
insert into facade.rate_cards (name, effective_from, aluminium_per_kg, conversion_per_kg, powder_coating_per_kg, is_active)
select 'Base Rate Card 2026', current_date, 297, 55, 70, true
where not exists (select 1 from facade.rate_cards where name = 'Base Rate Card 2026');

-- 2) Material catalog
insert into facade.materials (name, category, unit, default_rate, is_infill, is_active) values
  ('Weather Silicone', 'silicone', 'bottle', 700, false, true),
  ('M.S. Bracket (HDG)', 'bracket', 'kg', 130, false, true),
  ('S.S. Fastener - Hilti', 'fastener', 'pcs', 160, false, true),
  ('S.S. Screw 19x8', 'screw', 'pcs', 0.5, false, true),
  ('S.S. Screw 38x8', 'screw', 'pcs', 0.6, false, true),
  ('EPDM Gasket', 'gasket', 'mtr', 60, false, true),
  ('Glass DGU 6+12+6', 'glass', 'sqm', 3000, true, true),
  ('Curved Glass DGU', 'glass', 'sqm', 8000, true, true),
  ('ACP - Alucobond', 'acp', 'sqm', 2510, true, true),
  ('24mm DGU Glass', 'dgu', 'sqm', 3000, true, true),
  ('Dorma Machine Set', 'hardware', 'set', 12500, false, true),
  ('Dorma Handle', 'hardware', 'pcs', 5500, false, true)
on conflict (name) do update set
  category = excluded.category, unit = excluded.unit,
  default_rate = excluded.default_rate, is_infill = excluded.is_infill, is_active = true;

-- 3) Sections (aluminium profiles; unit weight per profile)
insert into facade.sections (section_no, name, default_unit_weight_kg_per_m) values
  ('35505', 'Curtainwall/ mullion', 1.6),
  ('22709', 'Pressure plate', 0.55),
  ('22707', 'Cover plate', 0.4),
  ('20000', 'Jointing Angle', 0.4),
  ('14144', 'Main frame tube', 0.8),
  ('10126', 'Flat bar', 0.24),
  ('21318', 'Louvre', 0.52),
  ('14564', 'Main frame tube', 0.85),
  ('38721', 'Main frame tube', 6.2),
  ('20000', 'Handrail', 1.5)
on conflict (section_no, name) do update set
  default_unit_weight_kg_per_m = excluded.default_unit_weight_kg_per_m;

-- 4) Systems
insert into facade.systems
  (code, name, category, panel_width_mm, panel_height_mm, panel_area_sqm,
   apply_powder_coating, labour_per_sqm, freight_per_sqm,
   wastage_pct, design_pct, misc_pct, pmc_pct, oh_profit_pct, is_active) values
  ('SG', 'Straight Glazing', 'glazing', 4865, 6400, 31.136, true, 900, 400, 10, 2.5, 2.5, 5, 18, true),
  ('CG', 'Curved Glazing', 'glazing', 4865, 6400, 31.136, true, 900, 400, 10, 2.5, 2.5, 5, 18, true),
  ('LV', 'Alu. Louvres', 'louvre', 4865, 1025, 4.9866, true, 800, 400, 10, 2.5, 2.5, 5, 18, true),
  ('ACP', 'ACP', 'acp', 1340, 7450, 9.983, false, 800, 300, 10, 2.5, 2.5, 5, 10, true),
  ('FD', 'Frameless Doors', 'door', 1900, 3000, 5.7, false, 900, 300, 10, 2.5, 2.5, 5, 10, true),
  ('RL', 'Alu. Railing', 'railing', null, null, 10, true, 800, 300, 10, 2.5, 2.5, 5, 10, true)
on conflict (code) do update set
  name = excluded.name, category = excluded.category,
  panel_width_mm = excluded.panel_width_mm, panel_height_mm = excluded.panel_height_mm,
  panel_area_sqm = excluded.panel_area_sqm, apply_powder_coating = excluded.apply_powder_coating,
  labour_per_sqm = excluded.labour_per_sqm, freight_per_sqm = excluded.freight_per_sqm,
  wastage_pct = excluded.wastage_pct, design_pct = excluded.design_pct,
  misc_pct = excluded.misc_pct, pmc_pct = excluded.pmc_pct,
  oh_profit_pct = excluded.oh_profit_pct, is_active = true;

-- 5) Re-seed members + materials for the 6 systems (idempotent)
delete from facade.system_members  where system_id in (select id from facade.systems where code in ('SG','CG','LV','ACP','FD','RL'));
delete from facade.system_materials where system_id in (select id from facade.systems where code in ('SG','CG','LV','ACP','FD','RL'));

-- 6) System members (aluminium take-off, parsed from the sheet)
insert into facade.system_members (system_id, section_id, member_name, cutlength_m, number, qty, unit_weight_kg_per_m, sort_order)
select s.id, sec.id, v.member_name, v.cutlength_m, v.number, v.qty, v.unit_weight_kg_per_m, v.sort_order
from (values
  ('SG', 'Curtain wall', '35505', 'Curtainwall/ mullion', 6.4, 6, 1, 1.6, 0),
  ('SG', 'Mullion', '35505', 'Curtainwall/ mullion', 4.865, 4, 1, 1.6, 1),
  ('SG', 'P.P-V', '22709', 'Pressure plate', 6.4, 6, 1, 0.55, 2),
  ('SG', 'P.P-H', '22709', 'Pressure plate', 4.865, 4, 1, 0.55, 3),
  ('SG', 'C.P.-V', '22707', 'Cover plate', 6.4, 6, 1, 0.4, 4),
  ('SG', 'C.P.-H', '22707', 'Cover plate', 6.4, 4, 1, 0.4, 5),
  ('SG', 'Jointing angle', '20000', 'Jointing Angle', 0.04, 120, 1, 0.4, 6),
  ('CG', 'Curtain wall', '35505', 'Curtainwall/ mullion', 6.4, 6, 1, 1.6, 0),
  ('CG', 'Mullion', '35505', 'Curtainwall/ mullion', 4.865, 4, 1, 1.6, 1),
  ('CG', 'P.P-V', '22709', 'Pressure plate', 6.4, 6, 1, 0.55, 2),
  ('CG', 'P.P-H', '22709', 'Pressure plate', 4.865, 4, 1, 0.55, 3),
  ('CG', 'C.P.-V', '22707', 'Cover plate', 6.4, 6, 1, 0.4, 4),
  ('CG', 'C.P.-H', '22707', 'Cover plate', 6.4, 4, 1, 0.4, 5),
  ('CG', 'Jointing angle', '20000', 'Jointing Angle', 0.04, 120, 1, 0.4, 6),
  ('LV', 'Main frame tube-25x50x2mm-V', '14144', 'Main frame tube', 6.4, 2, 1, 0.8, 0),
  ('LV', 'Main frame tube-25x50x2mm-H', '14144', 'Main frame tube', 4.865, 2, 1, 0.8, 1),
  ('LV', 'Flat bar-38x38x2mm-V', '10126', 'Flat bar', 6.4, 2, 1, 0.24, 2),
  ('LV', 'Flat bar-38x38x2mm-V', '10126', 'Flat bar', 6.4, 2, 1, 0.24, 3),
  ('LV', 'Louvre', '21318', 'Louvre', 1, 70, 1, 0.52, 4),
  ('LV', 'Jointing angle', '20000', 'Jointing Angle', 0.04, 120, 1, 0.4, 5),
  ('ACP', 'Main frame tube-40x40x2mm-V', '14564', 'Main frame tube', 7.45, 3, 1, 0.85, 0),
  ('ACP', 'Main frame tube-40x40x2mm-H', '14564', 'Main frame tube', 1.34, 14, 1, 0.85, 1),
  ('ACP', 'Jointing angle', '20000', 'Jointing Angle', 0.04, 120, 1, 0.4, 2),
  ('RL', 'Alu. Bottom member', '38721', 'Main frame tube', 10, 1, 1, 6.2, 0),
  ('RL', 'Alu. Hand Rail', '20000', 'Handrail', 10, 1, 1, 1.5, 1)
) as v(code, member_name, section_no, section_name, cutlength_m, number, qty, unit_weight_kg_per_m, sort_order)
join facade.systems s on s.code = v.code
left join facade.sections sec on sec.section_no = v.section_no and sec.name = v.section_name;

-- 7) System materials (consumables + infill; rate_override where sheet differs from catalog)
insert into facade.system_materials (system_id, material_id, qty, rate_override, is_infill, wastage_applies, sort_order)
select s.id, m.id, v.qty, v.rate_override, v.is_infill, v.wastage_applies, v.sort_order
from (values
  ('SG', 'Weather Silicone', 2, null::numeric, false, false, 0),
  ('SG', 'M.S. Bracket (HDG)', 8.5, null::numeric, false, false, 1),
  ('SG', 'S.S. Fastener - Hilti', 50, null::numeric, false, false, 2),
  ('SG', 'S.S. Screw 19x8', 3000, null::numeric, false, false, 3),
  ('SG', 'S.S. Screw 38x8', 2000, null::numeric, false, false, 4),
  ('SG', 'EPDM Gasket', 105, null::numeric, false, false, 5),
  ('SG', 'EPDM Gasket', 105, null::numeric, false, false, 6),
  ('SG', 'Glass DGU 6+12+6', 31.136000000000003, null::numeric, true, true, 7),
  ('CG', 'Weather Silicone', 2, null::numeric, false, false, 0),
  ('CG', 'M.S. Bracket (HDG)', 8.5, null::numeric, false, false, 1),
  ('CG', 'S.S. Fastener - Hilti', 50, null::numeric, false, false, 2),
  ('CG', 'S.S. Screw 19x8', 3000, null::numeric, false, false, 3),
  ('CG', 'S.S. Screw 38x8', 2000, null::numeric, false, false, 4),
  ('CG', 'EPDM Gasket', 105, null::numeric, false, false, 5),
  ('CG', 'EPDM Gasket', 105, null::numeric, false, false, 6),
  ('CG', 'Curved Glass DGU', 31.136000000000003, null::numeric, true, true, 7),
  ('LV', 'Weather Silicone', 2, null::numeric, false, false, 0),
  ('LV', 'S.S. Fastener - Hilti', 14, 140, false, false, 1),
  ('LV', 'S.S. Screw 19x8', 500, null::numeric, false, false, 2),
  ('ACP', 'Weather Silicone', 8, null::numeric, false, false, 0),
  ('ACP', 'S.S. Fastener - Hilti', 51, 140, false, false, 1),
  ('ACP', 'S.S. Screw 19x8', 500, null::numeric, false, false, 2),
  ('ACP', 'ACP - Alucobond', 9.983, null::numeric, true, true, 3),
  ('FD', '24mm DGU Glass', 5.699999999999999, null::numeric, true, true, 0),
  ('FD', 'Dorma Machine Set', 2, null::numeric, false, false, 1),
  ('FD', 'Dorma Handle', 2, null::numeric, false, false, 2),
  ('RL', 'Weather Silicone', 1, null::numeric, false, false, 0),
  ('RL', 'S.S. Fastener - Hilti', 11, 140, false, false, 1),
  ('RL', 'EPDM Gasket', 40, 70, false, false, 2)
) as v(code, mat_name, qty, rate_override, is_infill, wastage_applies, sort_order)
join facade.systems s on s.code = v.code
join facade.materials m on m.name = v.mat_name;
