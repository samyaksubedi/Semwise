import { extractText, getDocumentProxy } from "unpdf";

/** The text of each page of a PDF (empty strings for pages without a text layer). */
export async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).map((page) => page.replace(/\s+\n/g, "\n").trim());
}

/** A PDF whose pages carry little text is a scan: it has to be read as images. */
export function looksScanned(pages: string[]): boolean {
  if (pages.length === 0) return true;
  const average = pages.reduce((sum, p) => sum + p.length, 0) / pages.length;
  return average < 200;
}
