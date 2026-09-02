// The app tsconfig excludes @types/node on purpose: src/ is browser code and
// must not reach for node globals. Tests do run in node, and
// theme-init.test.ts needs one fs call (vitest stubs every CSS import, even
// ?raw and ?inline, so the stylesheet has to come off disk). Declare just that
// surface rather than pulling the full node ambient types into src/.
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
