import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";

/**
 * A stand-in for the OpenAI API, so the browser tests run the real API and worker without paid
 * calls. It answers by the structured-output schema name the API sends, with fixed outlines and
 * answers that use the keys (T1, K1, S1 ...) found in the request, and word-hash embeddings so
 * texts that share words land near each other in Qdrant.
 */
export const FAKE_OPENAI_PORT = 4010;
export const FAKE_OPENAI_URL = `http://127.0.0.1:${FAKE_OPENAI_PORT}/v1`;

/** Every schema name (or endpoint) asked for, in order; tests read it from GET /__calls. */
const calls: string[] = [];

/** All text in a Responses API input, in order. */
function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("\n");
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (typeof record.content === "string") return record.content;
    return Object.values(record).map(textOf).join("\n");
  }
  return "";
}

/** The text of one `<<<DATA label ... DATA>>>` block. */
function block(input: string, label: string): string {
  const start = input.indexOf(`<<<DATA ${label}\n`);
  if (start < 0) return "";
  const from = start + `<<<DATA ${label}\n`.length;
  const end = input.indexOf("\nDATA>>>", from);
  return input.slice(from, end < 0 ? undefined : end);
}

const words = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);

function syllabusOutline() {
  const topic = (title: string, confidence = 95) => ({
    title,
    description: null,
    sourcePage: 1,
    confidence,
    subtopics: [],
  });
  return {
    subjectName: "Digital Logic",
    subjectCode: "CSC103",
    credits: 3,
    units: [
      {
        title: "Number systems",
        description: null,
        hours: 6,
        sourcePage: 1,
        confidence: 95,
        topics: [topic("Binary and hexadecimal"), topic("Complements")],
      },
      {
        title: "Boolean algebra",
        description: null,
        hours: 8,
        sourcePage: 1,
        confidence: 95,
        topics: [topic("Logic gates"), topic("Karnaugh maps", 50)],
      },
    ],
    references: [{ title: "Digital Design", author: "M. Morris Mano", sourcePage: 1 }],
  };
}

/** Two operations so a test can accept one and reject the other. */
function syllabusChanges(input: string) {
  const nodes = [...block(input, "outline").matchAll(/(T\d+) \[(UNIT|TOPIC|SUBTOPIC)\] (.+)/g)];
  const unit = nodes.find((n) => n[2] === "UNIT");
  const topic = nodes.find((n) => n[2] === "TOPIC");
  const ops = [];
  if (unit)
    ops.push({
      op: "add",
      targetKey: null,
      parentKey: unit[1],
      kind: "TOPIC",
      title: "Code converters",
      position: null,
      reason: "Adds the topic the request names.",
    });
  if (topic)
    ops.push({
      op: "rename",
      targetKey: topic[1],
      parentKey: null,
      kind: null,
      title: `${topic[3]!.trim()} (renamed)`,
      position: null,
      reason: "Renames the topic the request points at.",
    });
  return { ops, note: null };
}

function entryOrganized(input: string) {
  const notes = block(input, "lesson notes").trim();
  const key = block(input, "syllabus topics").match(/K\d+/)?.[0] ?? null;
  const firstLine = notes.split("\n")[0]!.slice(0, 120) || "Lesson";
  return {
    topics: [{ title: firstLine, subtopics: [], syllabusKey: key, confidence: 90 }],
    summary: `In class: ${notes.slice(0, 200)}`,
  };
}

function chatRoute(input: string) {
  const question = block(input, "question");
  const asked = words(question);
  let best: { key: string; score: number } | null = null;
  for (const line of block(input, "subjects").split("\n")) {
    const key = line.match(/^(S\d+) /)?.[1];
    if (!key) continue;
    const score = [...words(line)].filter((w) => asked.has(w)).length;
    if (!best || score > best.score) best = { key, score };
  }
  return {
    language: "English",
    query: question,
    subjectKeys: best ? [best.key] : [],
    scope: "IN_SYLLABUS",
    complex: false,
    dates: { isDateQuestion: false, from: null, to: null },
  };
}

function chatAnswer(input: string) {
  const sources = block(input, "sources");
  if (!/\bS1\b/.test(sources))
    return {
      answer: "Your class material does not cover this yet.",
      sourceKeys: [],
      generalExplanation: false,
      notInMaterial: true,
    };
  return {
    answer:
      "Here is what your class material says about it [S1].\n\nGeneral explanation:\nA pointer stores the address of another value.",
    sourceKeys: ["S1"],
    generalExplanation: true,
    notInMaterial: false,
  };
}

function answerFor(name: string, input: string): unknown {
  switch (name) {
    case "syllabus_outline":
      return syllabusOutline();
    case "syllabus_changes":
      return syllabusChanges(input);
    case "entry_organized":
      return entryOrganized(input);
    case "chat_route":
      return chatRoute(input);
    case "chat_answer":
      return chatAnswer(input);
    case "date_answer":
      return { answer: "These classes were recorded for that period [S1]." };
    case "chat_summary":
      return { summary: "The student asked about their classes." };
    case "photo_reading":
      return { text: "Text read from the board", unreadable: false };
    default:
      throw new Error(`No fake answer for schema ${name}`);
  }
}

/** The same deterministic word-hash vector as the API's test fake (src/test/fakes.ts). */
function vectorFor(text: string, dimensions: number): number[] {
  const v = new Array<number>(dimensions).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    const h = createHash("sha256").update(word).digest();
    for (let i = 0; i < 4; i++) v[h.readUInt16BE(i * 2) % v.length]! += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

const usage = { input_tokens: 100, output_tokens: 50, input_tokens_details: { cached_tokens: 0 } };

export function startFakeOpenAi(): Promise<Server> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };
      try {
        if (req.method === "GET" && req.url === "/__calls") return send(200, calls);
        if (req.method === "GET" && req.url === "/health") return send(200, { ok: true });
        if (req.method === "POST" && req.url === "/v1/responses") {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
            input: unknown;
            text: { format: { name: string } };
          };
          const name = body.text.format.name;
          calls.push(name);
          const text = JSON.stringify(answerFor(name, textOf(body.input)));
          return send(200, {
            output: [{ type: "message", content: [{ type: "output_text", text }] }],
            usage,
          });
        }
        if (req.method === "POST" && req.url === "/v1/embeddings") {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
            input: string[];
            dimensions?: number;
          };
          calls.push("embeddings");
          return send(200, {
            data: body.input.map((text, index) => ({
              index,
              embedding: vectorFor(text, body.dimensions ?? 1536),
            })),
            usage: { prompt_tokens: 10 },
          });
        }
        if (req.method === "POST" && req.url === "/v1/audio/transcriptions") {
          calls.push("transcription");
          return send(200, {
            text: "Dictated notes",
            usage: { type: "duration", seconds: 30 },
          });
        }
        send(404, { error: { message: `Not faked: ${req.method} ${req.url}` } });
      } catch (err) {
        send(500, { error: { message: err instanceof Error ? err.message : String(err) } });
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(FAKE_OPENAI_PORT, "127.0.0.1", () => resolve(server));
  });
}
