// v1.2 — 1D cut-optimization (First-Fit-Decreasing bin packing) per profile.
// Replaces the flat wastage % for aluminium when a system opts in. Output is an
// ESTIMATE of offcut, not a fabrication cut-plan.

export interface BarParams {
  stock_bar_length_m: number;
  kerf_mm: number;
  bar_trim_mm: number;
  min_usable_offcut_mm: number;
}

export const DEFAULT_BAR_PARAMS: BarParams = {
  stock_bar_length_m: 6.0,
  kerf_mm: 4,
  bar_trim_mm: 15,
  min_usable_offcut_mm: 500,
};

/** One member's contribution to packing: a cut length repeated `count` times. */
export interface PackMember {
  section_key: string; // same profile nests together (section_id, else a stable label)
  cutlength_m: number;
  count: number; // number * qty
  unit_weight_kg_per_m: number;
}

export interface CutOptResult {
  used_kg: number;
  purchased_kg: number;
  offcut_kg: number;
  bars_used: number;
  used_mm: number;
  offcut_mm: number;
  optimized_wastage_pct: number;
}

/**
 * Pack each profile group's pieces into stock bars (FFD) and roll up purchased
 * vs used metal. A piece fits a bar if current_used + piece + kerf(if bar
 * non-empty) <= usable_bar_mm.
 */
export function optimizeCuts(members: PackMember[], bar: BarParams): CutOptResult {
  const stockMm = bar.stock_bar_length_m * 1000;
  const usableMm = stockMm - (Number(bar.bar_trim_mm) || 0);
  const kerf = Number(bar.kerf_mm) || 0;

  // group by profile
  const groups = new Map<string, { pieces: number[]; unit_weight: number }>();
  for (const m of members) {
    const pieceMm = m.cutlength_m * 1000;
    const n = Math.max(0, Math.round(m.count));
    if (pieceMm <= 0 || n === 0) continue;
    const g = groups.get(m.section_key) ?? { pieces: [], unit_weight: m.unit_weight_kg_per_m };
    for (let i = 0; i < n; i++) g.pieces.push(pieceMm);
    // keep the heaviest unit weight seen for the profile (defensive; usually uniform)
    g.unit_weight = Math.max(g.unit_weight, m.unit_weight_kg_per_m);
    groups.set(m.section_key, g);
  }

  let purchased_kg = 0, used_kg = 0, offcut_kg = 0;
  let bars_total = 0, used_mm_total = 0, offcut_mm_total = 0;

  for (const { pieces, unit_weight } of groups.values()) {
    pieces.sort((a, b) => b - a); // First-Fit-Decreasing
    const bars: number[] = []; // used mm per open bar (excludes trim; trim already removed from usable)
    for (const piece of pieces) {
      if (piece > usableMm) {
        // piece longer than a usable bar — give it its own bar (best effort)
        bars.push(piece);
        continue;
      }
      let placed = false;
      for (let b = 0; b < bars.length; b++) {
        const add = piece + (bars[b] > 0 ? kerf : 0);
        if (bars[b] + add <= usableMm) { bars[b] += add; placed = true; break; }
      }
      if (!placed) bars.push(piece);
    }
    const barsUsed = bars.length;
    const sumPieces = pieces.reduce((s, p) => s + p, 0);
    const usedMm = sumPieces + kerf * (pieces.length - barsUsed); // kerf between pieces within bars
    const purchasedMm = barsUsed * stockMm;
    const offcutMm = purchasedMm - usedMm;

    purchased_kg += (purchasedMm / 1000) * unit_weight;
    used_kg += (sumPieces / 1000) * unit_weight;
    offcut_kg += (offcutMm / 1000) * unit_weight;
    bars_total += barsUsed;
    used_mm_total += usedMm;
    offcut_mm_total += offcutMm;
  }

  const optimized_wastage_pct = used_mm_total > 0 ? (offcut_mm_total / used_mm_total) * 100 : 0;
  return {
    used_kg, purchased_kg, offcut_kg,
    bars_used: bars_total, used_mm: used_mm_total, offcut_mm: offcut_mm_total,
    optimized_wastage_pct,
  };
}
