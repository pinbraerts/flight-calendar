import { buildPDFTree, configurePDFWorker } from '/src/extract-pdf-tree.js';
import { parse }        from '/src/parsers/index.js';
import { generateICS }  from '/src/ics.js';

configurePDFWorker('/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');

const airportsDB = await fetch('/data/airports.json').then(r => r.json());
const lookupIATA = iata => airportsDB[iata?.toUpperCase()] ?? null;

const dropZone    = document.getElementById('drop-zone');
const fileInput   = document.getElementById('pdf-input');
const results     = document.getElementById('results');
const tbody       = document.querySelector('#legs-table tbody');
const parserUsed  = document.getElementById('parser-used');
const log         = document.getElementById('log');
const downloadBtn = document.getElementById('download-ics');

async function handleFile(file) {
  try {
    log.textContent = '';
    const buffer = await file.arrayBuffer();
    const tree   = await buildPDFTree(buffer);
    const { parser, legs } = parse(tree, lookupIATA);

    parserUsed.textContent = `Parser: ${parser}, found ${legs.length} leg(s)`;
    renderLegs(legs);
    results.hidden = false;
  } catch (e) {
    log.textContent = e.message;
  }
}

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
  return `<div class="date-display"><div class="day-container"><span class="day">${day}</span><span class="day-name">${dayName}</span></div><div class="month-container"><span class="month-number">${month}</span><span class="month-name">${monthName}</span></div><span class="year">${year}</span></div>`;
}

function formatTimeDisplay(datetimeStr) {
  if (!datetimeStr) return '';
  const date = new Date(datetimeStr);
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
}

function addRow(leg = {}) {
  const tr = document.createElement('tr');
  const depDatetime = leg.departure?.datetime ?? '';
  const arrDatetime = leg.arrival?.datetime ?? '';
  tr.innerHTML = `
    <td><input value="${leg.flightNumber ?? ''}"></td>
    <td><input value="${leg.departure?.iata ?? ''}" maxlength="3" style="width:4em;text-transform:uppercase"></td>
    <td>
      ${formatDateDisplay(depDatetime)}
      <input type="hidden" class="datetime-input" value="${depDatetime}">
    </td>
    <td><input value="${leg.arrival?.iata ?? ''}" maxlength="3" style="width:4em;text-transform:uppercase"></td>
    <td>
      ${formatDateDisplay(arrDatetime)}
      <input type="hidden" class="datetime-input" value="${arrDatetime}">
    </td>
    <td><input value="${leg.bookingRef ?? ''}"></td>
    <td><button class="del">✕</button></td>
  `;
  tr.querySelector('.del').onclick = () => tr.remove();
  tbody.appendChild(tr);
}

document.getElementById('add-leg').onclick = () => addRow();

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

  const ics  = generateICS(legs, lookupIATA);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const a    = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: 'flights.ics',
  });
  a.click();
  URL.revokeObjectURL(a.href);
};
