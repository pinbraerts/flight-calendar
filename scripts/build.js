import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);

// Create dist directory
await mkdir(join(ROOT, 'dist/data'), { recursive: true });
await mkdir(join(ROOT, 'dist/src'), { recursive: true });
await mkdir(join(ROOT, 'dist/src/parsers'), { recursive: true });

// Copy data files
await copyFile(join(ROOT, 'data/airports.json'), join(ROOT, 'dist/data/airports.json'));

// Copy all source files needed
await copyFile(join(ROOT, 'src/parsers/base.js'), join(ROOT, 'dist/src/parsers/base.js'));
await copyFile(join(ROOT, 'src/parsers/aviasales.js'), join(ROOT, 'dist/src/parsers/aviasales.js'));
await copyFile(join(ROOT, 'src/parsers/aviakassa.js'), join(ROOT, 'dist/src/parsers/aviakassa.js'));
await copyFile(join(ROOT, 'src/parsers/alfastrakh-itinerary.js'), join(ROOT, 'dist/src/parsers/alfastrakh-itinerary.js'));
await copyFile(join(ROOT, 'src/parsers/tree-based-font-geo.js'), join(ROOT, 'dist/src/parsers/tree-based-font-geo.js'));
await copyFile(join(ROOT, 'src/parsers/index.js'), join(ROOT, 'dist/src/parsers/index.js'));
await copyFile(join(ROOT, 'src/ics.js'), join(ROOT, 'dist/src/ics.js'));

// Copy and fix extract-pdf-tree.js to use unpkg CDN (more reliable)
let extractPdfTreeContent = await readFile(join(ROOT, 'src/extract-pdf-tree.js'), 'utf-8');
extractPdfTreeContent = extractPdfTreeContent.replace(
  "from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs'",
  "from 'https://unpkg.com/pdfjs-dist@5.6.205/legacy/build/pdf.mjs'"
);
await writeFile(join(ROOT, 'dist/src/extract-pdf-tree.js'), extractPdfTreeContent);

// Copy and fix app.js for GitHub Pages
let appJsContent = await readFile(join(ROOT, 'web/app.js'), 'utf-8');
appJsContent = appJsContent
  .replace("from '/src/extract-pdf-tree.js'", "from './src/extract-pdf-tree.js'")
  .replace("'/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'", "'https://unpkg.com/pdfjs-dist@5.6.205/legacy/build/pdf.worker.mjs'")
  .replace("'/data/airports.json'", "'/flight-calendar/data/airports.json'")
  .replace("from '/src/parsers/index.js'", "from './src/parsers/index.js'")
  .replace("from '/src/ics.js'", "from './src/ics.js'");
await writeFile(join(ROOT, 'dist/app.js'), appJsContent);

// Create HTML with updated script references - use /flight-calendar/ prefix
const htmlContent = await readFile(join(ROOT, 'web/index.html'), 'utf-8');
const updatedHtml = htmlContent
  .replace('<script type="module" src="/web/app.js"></script>', '<script type="module" src="/flight-calendar/app.js"></script>')
  .replace('fetch("/', 'fetch("/flight-calendar/')
  .replace('href="/', 'href="/flight-calendar/');

await writeFile(join(ROOT, 'dist/index.html'), updatedHtml);

console.log('✓ Build complete! Using unpkg CDN for PDF.js.');