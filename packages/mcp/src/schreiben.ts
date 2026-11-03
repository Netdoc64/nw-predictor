import { z } from 'zod';
import type { ErrorCode } from '@vp/errors';
import { activate, journal, RevisionsFehler, upsert, vorschau, type Kontext, type RevisionsArt } from '@vp/registry';
import type { McpFlaeche } from './flaeche.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Schreibende Werkzeuge — PLAN.md §7.3, §12/G79 G83 N143 N145.
//
// Zwei Werkzeuge, zwei Stufen: `vp_registry_upsert` (vorschlagend) schreibt
// einen ENTWURF und liefert Vorschau samt confirm-Hash; `vp_registry_activate`
// (steuernd) verschiebt den Zeiger und verlangt diesen Hash. Die Fachlogik —
// Revisionen, Fremdschreiber-Erkennung, Journal, Selbstbedienungssperre — liegt
// in @vp/registry; hier steht nur die Huelle. Urheber ist immer die Identitaet
// der Flaeche, nie ein Argument.
//
// Ob die Werkzeuge ueberhaupt in der Liste stehen, entscheidet `darfWerkzeug`
// (G79). Es gibt hier kein Order-Werkzeug und keins, das Geld bewegt (§13).
// ─────────────────────────────────────────────────────────────────────────────

export interface SchreibWerkzeug {
  readonly name: string;
  readonly titel: string;
  readonly beschreibung: string;
  readonly eingabe: z.ZodRawShape;
  readonly schreibend: true;
  readonly tu: (args: Record<string, unknown>) => unknown;
}

export interface SchreibKontext {
  readonly flaeche: McpFlaeche;
  /** Wurzelordner der Revisionsdateien (`<wurzel>/<art>/<schluessel>.json`). */
  readonly wurzel: string;
  readonly melde: (code: ErrorCode, nachricht: string, werkzeug: string) => never;
}

const ARTEN = ['definition', 'profil', 'strategie', 'flaeche'] as const;

export function schreibWerkzeuge(c: SchreibKontext): SchreibWerkzeug[] {
  const urheber = c.flaeche.identitaet;

  const kontext = (a: Record<string, unknown>): Kontext => ({
    wurzel: c.wurzel,
    art: a['art'] as RevisionsArt,
    schluessel: String(a['schluessel']),
  });

  /** Ein Registry-Fehler wird als solcher gemeldet (mit Urheber) statt als Absturz. */
  const sichere = <T>(werkzeug: string, f: () => T): T => {
    try {
      return f();
    } catch (e) {
      if (e instanceof RevisionsFehler) return c.melde(e.code, e.message, werkzeug);
      throw e;
    }
  };

  return [
    {
      name: 'vp_registry_upsert',
      titel: 'Registry-Entwurf schreiben',
      beschreibung:
        'Schreibt einen ENTWURF als neue Revision eines Registry-Eintrags und aktiviert nichts. ' +
        'Antwort: Vorschau (Entwurf gegen aktuell Aktives) und confirm-Hash. Erst vp_registry_activate mit diesem Hash macht ihn wirksam — ' +
        'und nur, solange niemand dazwischen geschrieben hat. Eine Flaeche kann ihre eigene Definition nicht aendern.',
      eingabe: {
        art: z.enum(ARTEN),
        schluessel: z.string().min(1),
        inhalt: z.record(z.string(), z.unknown()),
      },
      schreibend: true,
      tu: (a) =>
        sichere('vp_registry_upsert', () => {
          const k = kontext(a);
          const rev = upsert(k, a['inhalt'], urheber);
          const v = vorschau(k, rev.nr);
          return {
            art: k.art,
            schluessel: k.schluessel,
            revision: rev.nr,
            urheber,
            aktiviert: false,
            vorschau: { aktiv: v.aktiv, aktuell: v.aktuell, entwurf: v.entwurf },
            confirm: v.confirm,
            naechsterSchritt: 'vp_registry_activate mit revision und confirm (Stufe steuernd)',
          };
        }),
    },
    {
      name: 'vp_registry_activate',
      titel: 'Registry-Revision aktivieren',
      beschreibung:
        'Setzt eine vorhandene Revision aktiv. `confirm` stammt aus der Vorschau von vp_registry_upsert und ist Pflicht; ' +
        'hat ein anderer Schreiber den Eintrag seither veraendert, passt er nicht mehr und nichts wird aktiviert — dann neu vorschauen.',
      eingabe: {
        art: z.enum(ARTEN),
        schluessel: z.string().min(1),
        revision: z.number().int().min(1),
        confirm: z.string().min(1),
      },
      schreibend: true,
      tu: (a) =>
        sichere('vp_registry_activate', () => {
          const k = kontext(a);
          const r = activate(k, Number(a['revision']), String(a['confirm']), urheber);
          const letzte = journal(c.wurzel, k.art, k.schluessel).at(-1);
          return {
            art: k.art,
            schluessel: k.schluessel,
            aktiv: r.nr,
            urheber,
            journal: letzte ?? null,
          };
        }),
    },
  ];
}
