// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// ─────────────────────────────────────────────────────────────────────────────
// Lint — und zwar nur Regeln, die hier etwas bedeuten.
//
// PLAN.md §4.3 verspricht: „`Date.now()` ist in `packages/compute` per
// Lint-Regel verboten — ESLint + Drift-Test". Das Versprechen stand da, der
// Waechter nicht. Der Code hielt sich zwar daran, aber nichts hielt ihn dabei:
// die erste Zeile, die es verletzt haette, waere gruen durchgelaufen.
//
// Die Hausregel dahinter ist nicht Reinheit, sondern DETERMINISMUS. Die
// Simulation muss dieselbe Rechnung fahren wie der Live-Betrieb; eine Wanduhr
// oder ein ungesaeter Zufall im Rechenweg bricht genau das — und zwar still.
// Der Test daneben (`tests/lint.drift.test.ts`) laesst ESLint wirklich laufen
// und prueft beide Richtungen: verboten, wo es verboten sein muss, und erlaubt,
// wo die Uhr hingehoert.
// ─────────────────────────────────────────────────────────────────────────────

/** Wo die Rechnung liegt: hier gilt das Verbot. */
export const RECHENPFADE = [
  'packages/compute/src/**/*.ts',
  'packages/trading/src/**/*.ts',
  'packages/machine/src/**/*.ts',
  'packages/sim/src/**/*.ts',
];

/**
 * Wo die Uhr hingehoert: `core-ids/zeit.ts` haelt `wanduhr` und `SimUhr`.
 * Genau EINE Stelle darf die echte Zeit lesen — alle anderen bekommen sie
 * hineingereicht.
 */
export const UHRENPFADE = ['packages/core-ids/src/zeit.ts'];

const VERBOTENE_EIGENSCHAFTEN = [
  {
    object: 'Date',
    property: 'now',
    message:
      'Keine Wanduhr im Rechenweg (PLAN.md §4.3). Die Uhr wird hineingereicht: ' +
      '`ctx.uhr.jetzt()` bzw. der `Uhr`-Parameter. Sonst rechnet die Simulation ' +
      'anders als der Live-Betrieb, und „Replay ≡ Live" faellt.',
  },
  {
    object: 'Math',
    property: 'random',
    message:
      'Kein ungesaeter Zufall im Rechenweg (PLAN.md §4.3). Der Zufall wird je ' +
      'Knoten aus dem `nodeHash` gesaet — sonst ist kein Lauf wiederholbar.',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      'laeufe/**',
      'daten/**',
      'dependency-map.json',
      // Verteilte Dateien werden anderswo gepflegt; ein Befund hier waere beim
      // naechsten Abgleich wieder weg.
      'scripts/autoupdate/lib.mjs',
      'scripts/autoupdate/stand.mjs',
      'scripts/autoupdate/register.mjs',
      'scripts/autoupdate/autonomie.mjs',
      'scripts/autoupdate/repo.example.mjs',
      'scripts/merge-gate.mjs',
      'scripts/ki-freigabe.mjs',
      'scripts/ki-pruefer.mjs',
      'tests/autoupdate*.test.ts',
      'tests/merge-gate.generisch.test.ts',
      'tests/ki-freigabe.generisch.test.ts',
      'tests/autonomie*.test.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // Absichtlich ungenutzte Argumente heissen `_` — das ist eine Aussage,
      // kein Versehen.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // `any` ist hier kein Weltuntergang, aber es soll auffallen.
      '@typescript-eslint/no-explicit-any': 'warn',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },

  {
    files: RECHENPFADE,
    rules: {
      'no-restricted-properties': ['error', ...VERBOTENE_EIGENSCHAFTEN],
    },
  },

  {
    // Die Uhr selbst darf die Uhr lesen. Ohne diese Ausnahme muesste
    // `core-ids/zeit.ts` die Regel abschalten — und eine Regel, die man an
    // ihrer wichtigsten Stelle abschaltet, erzieht niemanden mehr.
    files: UHRENPFADE,
    rules: { 'no-restricted-properties': 'off' },
  },

  {
    // Browser-Teil des Chart-Adapters: dort gibt es `window` und `document`.
    files: ['packages/chart-adapter/browser/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
);
