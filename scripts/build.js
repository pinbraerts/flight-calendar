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

// Create app.js with fixed paths for GitHub Pages
const appJsContent = `import { buildPDFTree, configurePDFWorker } from './src/extract-pdf-tree.js';
import { parse } from './src/parsers/index.js';
import { generateICS } from './src/ics.js';

// Configure PDF.js worker with unpkg CDN
configurePDFWorker('https://unpkg.com/pdfjs-dist@5.6.205/legacy/build/pdf.worker.mjs');

// Load data first (this can be top-level)
const airportsDB = await fetch('/flight-calendar/data/airports.json').then(r => r.json());
const lookupIATA = iata => airportsDB[iata?.toUpperCase()] ?? null;

// Helper functions (declare before use)
async function handleFile(file) {
  try {
    log.textContent = '';
    const buffer = await file.arrayBuffer();
    const tree   = await buildPDFTree(buffer);
    const { parser, legs } = parse(tree, lookupIATA);

    parserUsed.textContent = \`Parser: \${parser}, found \${legs.length} leg(s)\`;
    renderLegs(legs);
    results.hidden = false;
  } catch (e) {
    log.textContent = e.message;
    console.error('File processing error:', e);
  }
}

function renderLegs(legs) {
  tbody.innerHTML = '';
  for (const leg of legs) addRow(leg);
}

function formatDateDisplay(datetimeStr) {
  if (!datetimeStr) return '';
  const date = new Date(datetimeStr);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const dayName = date.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
  const monthName = date.toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
  return \`<div class="date-display"><div class="day-container"><span class="day">\${day}</span><span class="day-name">\${dayName}</span></div><div class="month-container"><span class="month-number">\${month}</span><span class="month-name">\${monthName}</span></div><span class="year">\${year}</span></div>\`;
}

function formatTimeDisplay(datetimeStr) {
  if (!datetimeStr) return '';
  const date = new Date(datetimeStr);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return \`\${hours}:\${minutes}\`;
}

function formatTimezoneOffset(datetimeStr, iata) {
  if (!datetimeStr) return '';
  const date = new Date(datetimeStr);
  const timezoneOffset = date.getTimezoneOffset();
  const offsetHours = Math.abs(Math.floor(timezoneOffset / 60));
  const offsetMinutes = Math.abs(timezoneOffset % 60);
  const offsetSign = timezoneOffset <= 0 ? '+' : '-';
  const offsetStr = \`UTC\${offsetSign}\${offsetHours}:\${String(offsetMinutes).padStart(2, '0')}\`;
  
  if (iata) {
    const airport = lookupIATA(iata);
    if (airport?.tz) {
      return \`\${offsetStr} \${airport.tz}\`;
    }
  }
  
  return offsetStr;
}

function addRow(leg = {}) {
  const tr = document.createElement('tr');
  const depDatetime = leg.departure?.datetime ?? '';
  const arrDatetime = leg.arrival?.datetime ?? '';
  tr.innerHTML = \`
    <td><input value="\${leg.flightNumber ?? ''}"></td>
    <td><input value="\${leg.departure?.iata ?? ''}" maxlength="3" style="width:4em;text-transform:uppercase"></td>
    <td>
      <div style="display:flex;gap:12px;align-items:flex-start">
        \${formatDateDisplay(depDatetime)}
        <div class="time-display">
          <span class="time">\${formatTimeDisplay(depDatetime)}</span>
          <span class="timezone">\${formatTimezoneOffset(depDatetime, leg.departure?.iata ?? '')}</span>
        </div>
      </div>
      <input type="hidden" class="datetime-input" value="\${depDatetime}">
    </td>
    <td><input value="\${leg.arrival?.iata ?? ''}" maxlength="3" style="width:4em;text-transform:uppercase"></td>
    <td>
      <div style="display:flex;gap:12px;align-items:flex-start">
        \${formatDateDisplay(arrDatetime)}
        <div class="time-display">
          <span class="time">\${formatTimeDisplay(arrDatetime)}</span>
          <span class="timezone">\${formatTimezoneOffset(arrDatetime, leg.arrival?.iata ?? '')}</span>
        </div>
      </div>
      <input type="hidden" class="datetime-input" value="\${arrDatetime}">
    </td>
    <td><input value="\${leg.bookingRef ?? ''}"></td>
    <td><button class="del">✕</button></td>
  \`;
  tr.querySelector('.del').onclick = () => tr.remove();
  tbody.appendChild(tr);
}

// Initialize after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Get DOM elements
  const dropZone    = document.getElementById('drop-zone');
  const fileInput   = document.getElementById('pdf-input');
  const results     = document.getElementById('results');
  const tbody       = document.querySelector('#legs-table tbody');
  const parserUsed  = document.getElementById('parser-used');
  const log         = document.getElementById('log');
  const downloadBtn = document.getElementById('download-ics');
  const addLegBtn  = document.getElementById('add-leg');

  // Verify all elements exist
  if (!dropZone || !fileInput || !results || !tbody || !parserUsed || !log || !downloadBtn || !addLegBtn) {
    console.error('Required DOM elements not found!');
    log.textContent = 'Error: Required page elements not loaded. Please refresh the page.';
    log.style.display = 'block';
    return;
  }

  console.log('Flight Calendar initialized successfully');

  // Add event listeners
  fileInput.addEventListener('change', e => handleFile(e.target.files[0]));
  
  dropZone.addEventListener('click', () => fileInput.click());
  
  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleFile(e.dataTransfer.files[0]);
  });

  addLegBtn.onclick = () => addRow();

  downloadBtn.onclick = () => {
    const legs = [...tbody.querySelectorAll('tr')].map(tr => {
      const inputs = tr.querySelectorAll('input:not(.datetime-input)');
      const datetimeInputs = tr.querySelectorAll('input.datetime-input');
      return {
        flightNumber: inputs[0].value,
        departure:    { iata: inputs[1].value.toUpperCase(), datetime: datetimeInputs[0].value, terminal: null },
        arrival:      { iata: inputs[2].value.toUpperCase(), datetime: datetimeInputs[1].value, terminal: null },
        bookingRef:   inputs[3].value || null,
        passenger: null, seat: null, class: null, airline: null,
      };
    });

    try {
      const ics  = generateICS(legs, lookupIATA);
      const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
      const a    = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: 'flights.ics',
      });
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      console.error('ICS generation error:', e);
      log.textContent = 'Error generating ICS file: ' + e.message;
      log.style.display = 'block';
    }
  };
});
`;

await writeFile(join(ROOT, 'dist/app.js'), appJsContent);

// Create HTML with updated script references - use /flight-calendar/ prefix
const htmlContent = await readFile(join(ROOT, 'web/index.html'), 'utf-8');
const updatedHtml = htmlContent
  .replace('<script type="module" src="/web/app.js"></script>', '<script type="module" src="/flight-calendar/app.js"></script>')
  .replace('fetch("/', 'fetch("/flight-calendar/')
  .replace('href="/', 'href="/flight-calendar/');

await writeFile(join(ROOT, 'dist/index.html'), updatedHtml);

console.log('✓ Build complete! Using unpkg CDN for PDF.js.');