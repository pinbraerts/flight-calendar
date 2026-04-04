import { getDocument, GlobalWorkerOptions } from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs';

/**
 * Call this once before any extraction.
 * In Bun/Node: pass workerSrc = '' (uses fake synchronous worker).
 * In browser:  pass workerSrc = '/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
 */
export function configurePDFWorker(workerSrc) {
  GlobalWorkerOptions.workerSrc = workerSrc ?? '';
}

/**
 * Extract structured information from a PDF page using spatial analysis.
 * This analyzes text items by their positions to understand the layout.
 */
async function extractStructuredTextFromPage(page) {
  const content = await page.getTextContent();
  
  // Group items by lines based on Y position
  const lineGroups = [];
  const tolerance = 3; // pixels tolerance for same line
  
  for (const item of content.items) {
    if (!item.str.trim()) continue;
    
    const y = item.transform[5];
    let foundLine = null;
    
    for (const group of lineGroups) {
      if (Math.abs(group.y - y) <= tolerance) {
        foundLine = group;
        break;
      }
    }
    
    if (foundLine) {
      foundLine.items.push(item);
    } else {
      lineGroups.push({ y, items: [item] });
    }
  }
  
  // Sort lines by Y position (top to bottom in PDF coordinates)
  lineGroups.sort((a, b) => b.y - a.y);
  
  // Sort items within each line by X position (left to right)
  for (const group of lineGroups) {
    group.items.sort((a, b) => a.transform[4] - b.transform[4]);
  }
  
  // Build structured text with normalized spacing
  let structuredText = '';
  for (const group of lineGroups) {
    const lineText = group.items.map(item => normalizeTextItem(item.str)).join(' ').trim();
    if (lineText) {
      structuredText += lineText + '\n';
    }
  }
  
  return structuredText;
}

/**
 * Extract all text from a PDF using structured spatial analysis.
 * @param {ArrayBuffer} buffer  Raw PDF bytes
 * @returns {Promise<string>}   All text joined by newlines, one entry per page
 */
export async function extractTextFromPDF(buffer) {
  const loadingTask = getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;

  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const pageText = await extractStructuredTextFromPage(page);
    pages.push(pageText);
  }

  return pages.join('\n--- PAGE BREAK ---\n');
}

/**
 * Normalize text items from PDF to handle special characters.
 * This replaces common problematic encoding issues that occur in PDFs.
 */
function normalizeTextItem(str) {
  return str
    .replace(/\uE092/g, ':')  // Special colon character
    .replace(/\uE088/g, ':')  // Another special colon character
    .replace(/\uff1a/g, ':')  // Fullwidth colon
    .replace(/\u2013| \u2014|\uff0d/g, '-')  // Various dash characters
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g, ' ')  // Various whitespace/control chars
    .replace(/\s+/g, ' ')     // Collapse multiple spaces
    .trim();
}
