import { ErrorCode } from "@semwise/shared";
import { AppError } from "../../common/errors/app-error.js";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";

const TIMEOUT_MS = 90_000;

/** One piece of model input. Files and images are sent inline (base64), never as URLs. */
export type InputPart =
  | { type: "text"; text: string }
  | { type: "file"; filename: string; mime: string; data: Uint8Array }
  | { type: "image"; mime: string; data: Uint8Array };

export interface JsonRequest {
  model: string;
  system: string;
  input: InputPart[];
  schemaName: string;
  schema: Record<string, unknown>;
  maxOutputTokens: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export interface JsonResult {
  value: unknown;
  usage: Usage;
}

export interface EmbedResult {
  vectors: number[][];
  inputTokens: number;
}

export interface TranscribeResult {
  text: string;
  seconds: number;
}

/**
 * Everything the app asks of the AI vendor. OpenAiProvider is the real one; tests install a fake,
 * so no test ever makes a paid call.
 */
export interface AiProvider {
  json(request: JsonRequest): Promise<JsonResult>;
  embed(model: string, texts: string[]): Promise<EmbedResult>;
  transcribe(model: string, audio: Uint8Array, mime: string): Promise<TranscribeResult>;
}

export function isAiConfigured(): boolean {
  return Boolean(env.OPENAI_API_KEY);
}

interface ResponsesBody {
  output?: { type: string; content?: { type: string; text?: string; refusal?: string }[] }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string } | null;
}

const base64 = (data: Uint8Array) => Buffer.from(data).toString("base64");

function toContent(part: InputPart) {
  switch (part.type) {
    case "text":
      return { type: "input_text", text: part.text };
    case "file":
      return {
        type: "input_file",
        filename: part.filename,
        file_data: `data:${part.mime};base64,${base64(part.data)}`,
      };
    case "image":
      return { type: "input_image", image_url: `data:${part.mime};base64,${base64(part.data)}` };
  }
}

function upstream(message: string): AppError {
  return new AppError(502, ErrorCode.UPSTREAM_ERROR, message);
}

class OpenAiProvider implements AiProvider {
  private url(path: string) {
    return `${env.OPENAI_BASE_URL.replace(/\/$/, "")}${path}`;
  }

  /** POST with one retry on rate limits, server errors and network failures. */
  private async post(path: string, body: string | FormData, json = true): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await fetch(this.url(path), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.OPENAI_API_KEY}`,
            ...(json ? { "Content-Type": "application/json" } : {}),
          },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        logger.warn({ err: (err as Error).message, attempt, path }, "OpenAI request failed");
        if (attempt === 0) continue;
        throw upstream("The AI service did not answer. Try again.");
      }
      if (res.status === 429 || res.status >= 500) {
        logger.warn({ status: res.status, attempt, path }, "OpenAI busy");
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          continue;
        }
        throw upstream("The AI service is busy. Try again in a minute.");
      }
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))) as ResponsesBody;
        logger.error(
          { status: res.status, message: detail.error?.message, path },
          "OpenAI rejected the request",
        );
        throw upstream("The AI service rejected the request. Check the model settings.");
      }
      return res;
    }
    throw upstream("The AI service did not answer. Try again.");
  }

  async json(request: JsonRequest): Promise<JsonResult> {
    const res = await this.post(
      "/responses",
      JSON.stringify({
        model: request.model,
        input: [
          { role: "system", content: request.system },
          { role: "user", content: request.input.map(toContent) },
        ],
        max_output_tokens: request.maxOutputTokens,
        text: {
          format: {
            type: "json_schema",
            name: request.schemaName,
            strict: true,
            schema: request.schema,
          },
        },
      }),
    );
    const body = (await res.json().catch(() => ({}))) as ResponsesBody;
    const parts: string[] = [];
    for (const item of body.output ?? []) {
      for (const piece of item.content ?? []) {
        if (piece.type === "refusal")
          throw new AppError(422, ErrorCode.UPSTREAM_ERROR, "The AI declined this request");
        if (piece.type === "output_text" && piece.text) parts.push(piece.text);
      }
    }
    let value: unknown;
    try {
      value = JSON.parse(parts.join(""));
    } catch {
      throw upstream("The AI answer was incomplete. Try again.");
    }
    return {
      value,
      usage: {
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
        cachedTokens: body.usage?.input_tokens_details?.cached_tokens ?? 0,
      },
    };
  }

  async embed(model: string, texts: string[]): Promise<EmbedResult> {
    const res = await this.post(
      "/embeddings",
      JSON.stringify({ model, input: texts, dimensions: env.AI_EMBEDDING_DIMENSIONS }),
    );
    const body = (await res.json()) as {
      data: { index: number; embedding: number[] }[];
      usage?: { prompt_tokens?: number };
    };
    const vectors = [...body.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    return { vectors, inputTokens: body.usage?.prompt_tokens ?? 0 };
  }

  async transcribe(model: string, audio: Uint8Array, mime: string): Promise<TranscribeResult> {
    const form = new FormData();
    const extension = mime.split("/")[1]?.replace("x-", "") ?? "webm";
    form.append("file", new Blob([Buffer.from(audio)], { type: mime }), `dictation.${extension}`);
    form.append("model", model);
    form.append("response_format", "verbose_json");
    const res = await this.post("/audio/transcriptions", form, false);
    const body = (await res.json()) as { text?: string; duration?: number };
    return { text: body.text ?? "", seconds: Math.ceil(body.duration ?? 0) };
  }
}

let provider: AiProvider | null = null;

export function getAiProvider(): AiProvider {
  if (!isAiConfigured()) throw AppError.notConfigured("AI");
  provider ??= new OpenAiProvider();
  return provider;
}

/** Tests install a fake provider. */
export function setAiProvider(replacement: AiProvider | null): void {
  provider = replacement;
}
