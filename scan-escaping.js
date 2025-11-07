const fs = require('fs');
const path = require('path');

const exts = new Set(['.js', '.ts', '.tsx']);
const re1 = /(\/\*.*?\*\/|\/\/.*$)/mg; // комменты
const patt = [
  /_.escape\s*\(/,
  /he\.encode\s*\(/,
  /escapeHtml\s*\(/,
  /htmlEscape\s*\(/,
  /DOMPurify|xss/i,
  /<%-/,
  /<%=/,
];

function scanFile(f) {
  const src = fs.readFileSync(f, 'utf8');
  const clean = src.replace(re1, ''); // уберём комменты
  const hits = patt.filter(r => r.test(clean));
  if (hits.length) {
    console.log(`\n>>> ${f}`);
    clean.split('\n').forEach((line, i) => {
      if (patt.some(r => r.test(line))) {
        console.log(`${String(i+1).padStart(5)}: ${line}`);
      }
    });
  }
}

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (name === 'node_modules' || name.startsWith('.git')) continue;
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p);
    else if (exts.has(path.extname(p))) scanFile(p);
  }
}

walk(process.cwd());
