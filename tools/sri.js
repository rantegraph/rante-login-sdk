// Computes the Subresource Integrity values of the SDK file exactly as published and writes dist/sri.json.
// usage: node tools/sri.js            (prints the <script> snippet; no network, no build step)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const file = path.join(root, 'rante-login.js');
const bytes = fs.readFileSync(file);
if (bytes.includes(0x0d) || bytes[0] === 0xef) throw new Error('rante-login.js must be LF-only UTF-8 without a BOM');
const version = /var VERSION = '([0-9.]+)';/.exec(bytes.toString('utf8'))[1];
const major = 'v' + version.split('.')[0];
const sha384 = crypto.createHash('sha384').update(bytes).digest('base64');
const out = {
  file: 'rante-login.js',
  version,
  publishedPath: `/sdk/${major}/rante-login.js`,
  url: `https://login.rante.com/sdk/${major}/rante-login.js`,
  bytes: bytes.length,
  sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  sha384,
  integrity: 'sha384-' + sha384,
  snippet: `<script src="https://login.rante.com/sdk/${major}/rante-login.js" integrity="sha384-${sha384}" crossorigin="anonymous"></script>`
};
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'sri.json'), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out, null, 1));
