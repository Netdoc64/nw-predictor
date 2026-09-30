import type { ChartOp, LayerSpec } from './vertrag.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Wire-Format — PLAN.md §5.6 und §12/J108.
//
// `bigint` ueberlebt `JSON.stringify` nicht: es wirft. Und ein Ersetzer, der
// es zur Zahl macht, verliert still Stellen. Deshalb: Festkommawerte gehen als
// Zeichenkette mit Kennung ueber die Leitung und kommen als `bigint` zurueck.
// ─────────────────────────────────────────────────────────────────────────────

const KENNUNG = '§fix:';

export function alsWire(wert: unknown): string {
  return JSON.stringify(wert, (_k, v: unknown) => (typeof v === 'bigint' ? `${KENNUNG}${v.toString()}` : v));
}

export function vonWire<T>(text: string): T {
  return JSON.parse(text, (_k, v: unknown) =>
    typeof v === 'string' && v.startsWith(KENNUNG) ? BigInt(v.slice(KENNUNG.length)) : v,
  ) as T;
}

/** Was eine Oberflaeche braucht, um einen Chart vollstaendig aufzubauen. */
export interface ChartPaket {
  readonly titel: string;
  readonly untertitel: string;
  readonly layer: readonly LayerSpec[];
  readonly ops: readonly ChartOp[];
}
