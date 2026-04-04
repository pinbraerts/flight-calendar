import { extractTextFromPDF, configurePDFWorker } from '/src/extract-pdf.js';
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
    const text   = await extractTextFromPDF(buffer);
    const { parser, legs } = parse(text, lookupIATA);

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

function addRow(leg = {}) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input value="${leg.flightNumber ?? ''}"></td>
    <td><input value="${leg.departure?.iata ?? ''}" maxlength="3" style="width:4em;text-transform:uppercase"></td>
    <td><input type="datetime-local" value="${leg.departure?.datetime ?? ''}"></td>
    <td><input value="${leg.arrival?.iata ?? ''}" maxlength="3" style="width:4em;text-transform:uppercase"></td>
    <td><input type="datetime-local" value="${leg.arrival?.datetime ?? ''}"></td>
    <td><input value="${leg.bookingRef ?? ''}"></td>
    <td><button class="del">✕</button></td>
  `;
  tr.querySelector('.del').onclick = () => tr.remove();
  tbody.appendChild(tr);
}

document.getElementById('add-leg').onclick = () => addRow();

downloadBtn.onclick = () => {
  const legs = [...tbody.querySelectorAll('tr')].map(tr => {
    const inputs = tr.querySelectorAll('input');
    return {
      flightNumber: inputs[0].value,
      departure:    { iata: inputs[1].value.toUpperCase(), datetime: inputs[2].value, terminal: null },
      arrival:      { iata: inputs[3].value.toUpperCase(), datetime: inputs[4].value, terminal: null },
      bookingRef:   inputs[5].value || null,
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
