import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

/**
 * Object storage the app needs. S3Storage talks to Cloudflare R2 (or SeaweedFS locally) through
 * the S3 API; tests replace it with an in-memory fake, so R2 is never called from tests.
 */
export interface Storage {
  /** A short-lived URL the browser PUTs the file to; type and size are part of the signature. */
  presignPut(key: string, mime: string, size: number, expiresSeconds: number): Promise<string>;
  presignGet(key: string, expiresSeconds: number, downloadName?: string): Promise<string>;
  head(key: string): Promise<{ size: number; mime: string | null } | null>;
  /** The first bytes, for the magic-byte check. */
  readStart(key: string, bytes: number): Promise<Uint8Array>;
  read(key: string): Promise<Uint8Array>;
  put(key: string, body: Uint8Array, mime: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export function isStorageConfigured(): boolean {
  return Boolean(
    (env.R2_ENDPOINT || env.R2_ACCOUNT_ID) &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY &&
    env.R2_BUCKET,
  );
}

async function bytes(body: unknown): Promise<Uint8Array> {
  const stream = body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
  if (!stream?.transformToByteArray) return new Uint8Array();
  return stream.transformToByteArray();
}

class S3Storage implements Storage {
  private client: S3Client;
  private bucket: string;
  private bucketChecked: Promise<void> | null = null;

  constructor() {
    this.bucket = env.R2_BUCKET!;
    this.client = new S3Client({
      region: "auto",
      endpoint: env.R2_ENDPOINT ?? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      forcePathStyle: env.R2_FORCE_PATH_STYLE,
      // The SDK's default checksums on signed URLs are rejected by R2 and SeaweedFS.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }

  /** Locally the bucket may not exist yet; production buckets are created in the R2 dashboard. */
  private ensureBucket(): Promise<void> {
    if (env.NODE_ENV === "production") return Promise.resolve();
    this.bucketChecked ??= this.client
      .send(new HeadBucketCommand({ Bucket: this.bucket }))
      .then(() => undefined)
      .catch(async () => {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        logger.info({ bucket: this.bucket }, "Created the local storage bucket");
      });
    return this.bucketChecked;
  }

  async presignPut(key: string, mime: string, size: number, expiresSeconds: number) {
    await this.ensureBucket();
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: mime,
        ContentLength: size,
      }),
      { expiresIn: expiresSeconds },
    );
  }

  async presignGet(key: string, expiresSeconds: number, downloadName?: string) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(downloadName
          ? {
              ResponseContentDisposition: `attachment; filename="${downloadName.replace(/["\r\n]/g, "")}"`,
            }
          : {}),
      }),
      { expiresIn: expiresSeconds },
    );
  }

  async head(key: string) {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: Number(res.ContentLength ?? 0), mime: res.ContentType ?? null };
    } catch {
      return null;
    }
  }

  async readStart(key: string, count: number) {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${count - 1}` }),
    );
    return bytes(res.Body);
  }

  async read(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return bytes(res.Body);
  }

  async put(key: string, body: Uint8Array, mime: string) {
    await this.ensureBucket();
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: mime }),
    );
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

let storage: Storage | null = null;

export function getStorage(): Storage {
  storage ??= new S3Storage();
  return storage;
}

/** Tests install an in-memory storage. */
export function setStorage(replacement: Storage | null): void {
  storage = replacement;
}
