// A2 — 2D sheet nesting (shelf / guillotine First-Fit-Decreasing-Height heuristic)
// for ACP & rectangular glass lites. Estimating heuristic, NOT a cut-plan:
// it won't model L-shapes, cut-outs, or grain direction.

export interface SheetParams {
  sheet_width_mm: number;
  sheet_height_mm: number;
  sheet_edge_trim_mm: number;
}

export interface NestPiece {
  width_mm: number;
  height_mm: number;
  count: number;
  allow_rotation?: boolean;
}

export interface NestResult {
  sheets_used: number;
  used_area_sqm: number;
  sheet_area_sqm: number;     // total purchased sheet area
  sheet_wastage_pct: number;
  oversized: boolean;         // a piece didn't fit even one sheet
}

/**
 * Shelf-pack rectangular pieces onto sheets. Each sheet is filled in horizontal
 * shelves; a piece opens a new shelf when it doesn't fit the current one, and a
 * new sheet when it doesn't fit the remaining height.
 */
export function nestSheets(pieces: NestPiece[], sheet: SheetParams): NestResult {
  const usableW = sheet.sheet_width_mm - 2 * (sheet.sheet_edge_trim_mm || 0);
  const usableH = sheet.sheet_height_mm - 2 * (sheet.sheet_edge_trim_mm || 0);
  let oversized = false;

  // expand + normalise orientation (rotate so width >= height where allowed, to pack by height)
  const flat: Array<{ w: number; h: number }> = [];
  for (const p of pieces) {
    const n = Math.max(0, Math.round(p.count));
    for (let i = 0; i < n; i++) {
      let w = p.width_mm, h = p.height_mm;
      const orients: Array<[number, number]> = p.allow_rotation !== false ? [[w, h], [h, w]] : [[w, h]];
      // orientations that fit a usable sheet area
      const fitting = orients.filter(([a, b]) => a <= usableW && b <= usableH);
      if (fitting.length) {
        // among fitting orientations choose the shorter shelf height (better packing)
        fitting.sort((x, y) => x[1] - y[1]);
        [w, h] = fitting[0];
      } else {
        oversized = true; // keep original orientation; will occupy its own sheet
      }
      flat.push({ w, h });
    }
  }
  if (!flat.length) {
    return { sheets_used: 0, used_area_sqm: 0, sheet_area_sqm: 0, sheet_wastage_pct: 0, oversized: false };
  }

  flat.sort((a, b) => b.h - a.h); // FFD by height

  const sheetAreaMm = sheet.sheet_width_mm * sheet.sheet_height_mm;
  let sheetsUsed = 0;
  // each sheet: list of shelves {usedW, shelfH}, and remaining height
  type Sheet = { shelves: { usedW: number; shelfH: number }[]; usedH: number };
  const sheets: Sheet[] = [];

  for (const piece of flat) {
    let placed = false;
    for (const s of sheets) {
      // try existing shelves
      for (const sh of s.shelves) {
        if (piece.h <= sh.shelfH && sh.usedW + piece.w <= usableW) { sh.usedW += piece.w; placed = true; break; }
      }
      if (placed) break;
      // open a new shelf on this sheet
      if (s.usedH + piece.h <= usableH) {
        s.shelves.push({ usedW: piece.w, shelfH: piece.h });
        s.usedH += piece.h; placed = true; break;
      }
    }
    if (!placed) {
      sheets.push({ shelves: [{ usedW: piece.w, shelfH: piece.h }], usedH: piece.h });
    }
  }
  sheetsUsed = sheets.length;

  const usedAreaMm = flat.reduce((s, p) => s + p.w * p.h, 0);
  const sheetAreaTotalMm = sheetAreaMm * sheetsUsed;
  return {
    sheets_used: sheetsUsed,
    used_area_sqm: usedAreaMm / 1_000_000,
    sheet_area_sqm: sheetAreaTotalMm / 1_000_000,
    sheet_wastage_pct: sheetAreaTotalMm > 0 ? ((sheetAreaTotalMm - usedAreaMm) / sheetAreaTotalMm) * 100 : 0,
    oversized,
  };
}
