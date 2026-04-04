import { readFile, writeFile } from 'node:fs/promises';
import { resolve, basename, dirname, join } from 'node:path';
import { configurePDFWorker, buildPDFTree } from './extract-pdf-tree.js';
import { lookupIATA }  from './airports.js';
import { parse }       from './parsers/index.js';
import { generateICS } from './ics.js';

configurePDFWorker('');

const args     = process.argv.slice(2);
const pdfPath  = args.find(a => !a.startsWith('--'));
const toStdout = args.includes('--stdout');

if (!pdfPath) {
  console.error('Usage: bun src/cli.js <path-to-pdf> [--stdout]');
  process.exit(1);
}

const buffer          = await readFile(resolve(pdfPath));
const tree            = await buildPDFTree(buffer.buffer);
const { parser, legs} = parse(tree, lookupIATA);

console.error(`Parser: ${parser}, legs found: ${legs.length}`);

if (legs.length === 0) {
  console.error('No legs detected. Exiting.');
  process.exit(1);
}

const ics = generateICS(legs, lookupIATA);

if (toStdout) {
  process.stdout.write(ics);
} else {
  const outPath = join(dirname(resolve(pdfPath)),
                       basename(pdfPath, '.pdf') + '.ics');
  await writeFile(outPath, ics, 'utf8');
  console.error(`Written: ${outPath}`);
}
