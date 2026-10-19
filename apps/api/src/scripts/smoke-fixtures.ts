import { crc32, deflateSync } from "node:zlib";

/** Inputs for the AI smoke test: a "whiteboard" PNG drawn from a tiny block font, and speech. */

const GLYPHS: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  N: ["#...#", "##..#", "#.#.#", "#.#.#", "#..##", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
};

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A grayscale PNG with dark lines of text on a light background. */
export function whiteboardPng(lines: string[], cell = 6): Uint8Array {
  const margin = 4;
  const cols = Math.max(...lines.map((l) => l.length)) * 6 + margin * 2;
  const rows = lines.length * 10 + margin * 2;
  const width = cols * cell;
  const height = rows * cell;
  const pixels = Buffer.alloc((width + 1) * height, 0xee);
  for (let y = 0; y < height; y++) pixels[y * (width + 1)] = 0; // filter byte per row
  lines.forEach((line, li) => {
    [...line.toUpperCase()].forEach((ch, ci) => {
      const glyph = GLYPHS[ch] ?? GLYPHS[" "]!;
      glyph.forEach((row, gy) => {
        [...row].forEach((on, gx) => {
          if (on !== "#") return;
          const x0 = (margin + ci * 6 + gx) * cell;
          const y0 = (margin + li * 10 + gy) * cell;
          for (let y = y0; y < y0 + cell; y++) {
            for (let x = x0; x < x0 + cell; x++) pixels[y * (width + 1) + 1 + x] = 0x22;
          }
        });
      });
    });
  });
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // grayscale
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(pixels)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

/**
 * A short spoken clip from OpenAI's text-to-speech, standing in for a CR's recording. This is
 * test-input generation, not an app feature, so it does not go through modules/ai.
 */
export async function speech(text: string): Promise<Uint8Array> {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      response_format: "mp3",
      input: text,
    }),
  });
  if (!res.ok) throw new Error(`Text-to-speech failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
