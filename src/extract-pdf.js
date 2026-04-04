import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * Call this once before any extraction.
 * In Bun/Node: pass workerSrc = '' (uses fake synchronous worker).
 * In browser:  pass workerSrc = '/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
 */
export function configurePDFWorker(workerSrc) {
  GlobalWorkerOptions.workerSrc = workerSrc ?? '';
}

/**
 * Extract all text from a PDF.
 * @param {ArrayBuffer} buffer  Raw PDF bytes
 * @returns {Promise<string>}   All text joined by newlines, one entry per page
 */
export async function extractTextFromPDF(buffer) {
  const loadingTask = getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;

  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map(item => item.str + (item.hasEOL ? '\n' : ' '))
      .join('');
    pages.push(pageText);
  }

  return pages.join('\n--- PAGE BREAK ---\n');
}
