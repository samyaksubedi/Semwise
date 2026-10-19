import { createHash } from "node:crypto";
import { env } from "../config/env.js";
import { setStorage, type Storage } from "../lib/storage.js";
import { setAiProvider, type AiProvider, type JsonRequest } from "../modules/ai/index.js";

/** In-memory object storage: R2 is never called from tests. */
export class FakeStorage implements Storage {
  objects = new Map<string, { body: Uint8Array; mime: string }>();

  async presignPut(key: string, mime: string, size: number) {
    return `https://storage.test/put/${encodeURIComponent(key)}?type=${encodeURIComponent(mime)}&size=${size}`;
  }
  async presignGet(key: string) {
    return `https://storage.test/get/${encodeURIComponent(key)}`;
  }
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { size: o.body.length, mime: o.mime } : null;
  }
  async readStart(key: string, bytes: number) {
    return (this.objects.get(key)?.body ?? new Uint8Array()).slice(0, bytes);
  }
  async read(key: string) {
    const o = this.objects.get(key);
    if (!o) throw new Error(`No object ${key}`);
    return o.body;
  }
  async put(key: string, body: Uint8Array, mime: string) {
    this.objects.set(key, { body, mime });
  }
  async delete(key: string) {
    this.objects.delete(key);
  }

  /** What the browser does with the signed URL. */
  upload(key: string, body: Uint8Array, mime: string) {
    this.objects.set(key, { body, mime });
  }
}

export function useFakeStorage(): FakeStorage {
  const fake = new FakeStorage();
  setStorage(fake);
  return fake;
}

type JsonResponder = (request: JsonRequest) => unknown;

/**
 * A scripted AI. JSON answers come from responders keyed by schema name; embeddings are
 * deterministic (same text, same vector), so retrieval tests are repeatable. Every call is kept
 * for assertions (for example that uploaded text was passed as delimited data).
 */
export class FakeAi implements AiProvider {
  calls: {
    kind: "json" | "embed" | "transcribe";
    model: string;
    request?: JsonRequest;
    texts?: string[];
  }[] = [];
  responders = new Map<string, JsonResponder>();
  failNext = 0;
  usage = { inputTokens: 1000, outputTokens: 200, cachedTokens: 0 };
  transcript = "Today we covered pointers and arrays.";

  respond(schemaName: string, responder: JsonResponder | object) {
    this.responders.set(
      schemaName,
      typeof responder === "function" ? (responder as JsonResponder) : () => responder,
    );
  }

  async json(request: JsonRequest) {
    this.calls.push({ kind: "json", model: request.model, request });
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error("AI provider down");
    }
    const responder = this.responders.get(request.schemaName);
    if (!responder) throw new Error(`No fake answer for ${request.schemaName}`);
    return { value: responder(request), usage: this.usage };
  }

  async embed(model: string, texts: string[]) {
    this.calls.push({ kind: "embed", model, texts });
    return { vectors: texts.map((t) => vectorFor(t)), inputTokens: texts.join(" ").length / 4 };
  }

  async transcribe(model: string) {
    this.calls.push({ kind: "transcribe", model });
    return { text: this.transcript, seconds: 95 };
  }

  jsonCalls(schemaName?: string) {
    return this.calls.filter(
      (c) => c.kind === "json" && (!schemaName || c.request?.schemaName === schemaName),
    );
  }
}

/**
 * A deterministic unit vector built from the words of the text, so texts sharing words are
 * close in cosine distance (enough for retrieval tests).
 */
export function vectorFor(text: string): number[] {
  const v = new Array<number>(env.AI_EMBEDDING_DIMENSIONS).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    const h = createHash("sha256").update(word).digest();
    for (let i = 0; i < 4; i++) v[h.readUInt16BE(i * 2) % v.length]! += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export function useFakeAi(): FakeAi {
  const fake = new FakeAi();
  setAiProvider(fake);
  return fake;
}

/** A small valid PDF with one text line per entry, one page per inner array. */
export function makePdf(pages: string[][]): Uint8Array {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const objects: string[] = [];
  const pageRefs = pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ");
  const fontId = 3 + pages.length * 2;
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${pageRefs}] /Count ${pages.length} >>`);
  for (const lines of pages) {
    const pageId = objects.length + 1;
    const content = `BT /F1 12 Tf 14 TL 72 720 Td ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${pageId + 1} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`,
    );
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}
