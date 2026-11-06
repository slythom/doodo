// Stubs RN pour libs qui attendent un environnement Node.
// Doit être importé AVANT tout module qui en dépend (three, etc.).
const g = globalThis as any;
g.process = g.process ?? {};
if (typeof g.process.emitWarning !== 'function') {
  g.process.emitWarning = () => {};
}
