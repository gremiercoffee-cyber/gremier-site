// Compiles the admin app's React (JSX) sources once, so phones don't download Babel and
// compile ~3,500 lines on every open.
//
//   Edit:  admin-src/react-N.jsx      (never edit admin-react-N.js — it's generated)
//   Build: node scripts/build-admin-react.js
//
// Output: admin-react-N.js next to admin.html, and admin.html's <script src> gets a new
// ?v=<hash> so the service worker (cache-first for scripts) picks up the new file.
// Same transform the in-browser Babel used (preset "react"); output stays a classic
// global script, exactly how @babel/standalone ran it.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let Babel;
try {
  Babel = require("@babel/standalone");
} catch {
  console.error("Missing @babel/standalone — run: npm install --no-save @babel/standalone@7.24.7");
  process.exit(1);
}

const root = path.join(__dirname, "..");
const srcDir = path.join(root, "admin-src");
const adminPath = path.join(root, "admin.html");
let admin = fs.readFileSync(adminPath, "utf8");

const files = fs.readdirSync(srcDir).filter((f) => /^react-\d+\.jsx$/.test(f)).sort();
for (const f of files) {
  const n = f.match(/\d+/)[0];
  const code = fs.readFileSync(path.join(srcDir, f), "utf8");
  const out = Babel.transform(code, { presets: ["react"], sourceType: "script", filename: f }).code;
  const js = `// GENERATED from admin-src/${f} by scripts/build-admin-react.js — do not edit.\n${out}\n`;
  fs.writeFileSync(path.join(root, `admin-react-${n}.js`), js);
  const hash = crypto.createHash("sha1").update(js).digest("hex").slice(0, 10);
  const re = new RegExp(`<script src="/admin-react-${n}\\.js\\?v=[^"]*"></script>`);
  if (!re.test(admin)) throw new Error(`admin.html has no <script src="/admin-react-${n}.js?v=…">`);
  admin = admin.replace(re, `<script src="/admin-react-${n}.js?v=${hash}"></script>`);
  console.log(`admin-react-${n}.js  ${Math.round(js.length / 1024)} KB  v=${hash}`);
}
fs.writeFileSync(adminPath, admin);
