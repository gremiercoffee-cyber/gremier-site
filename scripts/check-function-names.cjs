// Finds names used but never defined/imported in the edge functions (e.g. a forgotten import),
// which Deno only reports when that line runs. Usage: node scripts/check-function-names.cjs [files…]
// TS_PATH can point at a typescript package if ../gremier-status/node_modules isn't there.
const ts = require(process.env.TS_PATH || '../gremier-status/node_modules/typescript');
const files = (process.argv.length > 2 ? process.argv.slice(2) : require('fs').readdirSync('supabase/functions', { withFileTypes: true }).flatMap(d => d.isDirectory() ? (d.name === '_shared' ? require('fs').readdirSync('supabase/functions/_shared').filter(f => f.endsWith('.ts')).map(f => '_shared/' + f) : require('fs').existsSync(`supabase/functions/${d.name}/index.ts`) ? [d.name + '/index.ts'] : []) : [])).map(f => f.startsWith('supabase/') ? f : 'supabase/functions/' + f);
const host = ts.createCompilerHost({});
const program = ts.createProgram(files, { noEmit: true, allowJs: true, target: ts.ScriptTarget.ES2022, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], noResolve: true, skipLibCheck: true, allowImportingTsExtensions: true, types: [] }, host);
let n = 0;
for (const d of ts.getPreEmitDiagnostics(program)) {
  if (![2304, 2552].includes(d.code)) continue;       // "Cannot find name"
  const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
  if (/'Deno'/.test(msg)) continue;                     // the Deno runtime global
  const { line } = d.file.getLineAndCharacterOfPosition(d.start);
  console.log(`${d.file.fileName.replace(/^.*functions\//, '')}:${line + 1}  ${msg}`); n++;
}
console.log(n ? `${n} undefined name(s)` : 'no undefined names');
