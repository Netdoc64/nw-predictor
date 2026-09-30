// `@vp/core-ids` exportiert auch `hash()`, und das braucht `node:crypto`. Die
// Treiber im Browser brauchen nur das Festkomma — aber der Bundler loest den
// Import trotzdem auf. Diese Attrappe steht fuer ihn ein und wirft, falls doch
// jemand im Browser hasht: dann soll es laut scheitern, nicht still falsch sein.
export function createHash(): never {
  throw new Error('hash() ist im Browser nicht verfuegbar — Inhaltsadressen entstehen auf dem Server');
}
