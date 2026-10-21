import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { _ } from 'ajv/dist/compile/codegen/index.js';
const require = createRequire(import.meta.url);
const ajv = new Ajv2020({ strict: true, allErrors: true, code: { source: true, esm: true, formats: _`formats` } });
require('ajv-formats')(ajv);
const refs = {};
for (const [name, file] of Object.entries({ resource: 'resource', manifest: 'manifest', feed: 'feed-profile' })) {
  const schema = JSON.parse(await readFile(new URL(`../schemas/${file}.schema.json`, import.meta.url), 'utf8'));
  ajv.addSchema(schema);
  refs[name] = schema.$id;
}
let code = require('ajv/dist/standalone')(ajv, refs);
code = code.replaceAll('require("ajv/dist/runtime/ucs2length").default', 'ucs2length');
if (code.includes('require(')) throw new Error('Unexpected dynamic validator dependency');
const header = `import { fullFormats as formats } from 'ajv-formats/dist/formats.js';
import lengthExport from 'ajv/dist/runtime/ucs2length.js';
const ucs2length = lengthExport.default ?? lengthExport;\n`;
await mkdir(new URL('../.local/', import.meta.url), { recursive: true });
await writeFile(new URL('../.local/validators.mjs', import.meta.url), header + code);
await writeFile(new URL('../.local/validators.d.mts', import.meta.url),
  'type Validate = { (value: unknown): boolean; errors?: unknown };\n' +
  'export const resource: Validate;\nexport const manifest: Validate;\nexport const feed: Validate;\n');
