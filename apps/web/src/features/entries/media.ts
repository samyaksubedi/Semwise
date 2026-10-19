"use client";

import type { MediaReadingView } from "@semwise/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { t } from "@/lib/strings";
import { uploadFile } from "@/lib/upload";

/** One to two minutes is what a CR needs; the recorder stops itself at the limit. */
export const MAX_RECORDING_SECONDS = 120;

type RecorderState =
  | { status: "idle" }
  | { status: "recording"; seconds: number }
  | { status: "error"; message: string };

/** A microphone recorder. `stop` resolves with the recording. */
export function useRecorder() {
  const [state, setState] = useState<RecorderState>({ status: "idle" });
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const finished = useRef<((blob: Blob | null) => void) | null>(null);

  const cleanup = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    recorder.current?.stream.getTracks().forEach((track) => track.stop());
    recorder.current = null;
  }, []);
  useEffect(() => cleanup, [cleanup]);

  const stop = useCallback(
    () =>
      new Promise<Blob | null>((resolve) => {
        if (!recorder.current || recorder.current.state === "inactive") return resolve(null);
        finished.current = resolve;
        recorder.current.stop();
      }),
    [],
  );

  const start = useCallback(async () => {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState({ status: "error", message: t.entry.micMissing });
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState({ status: "error", message: t.entry.micBlocked });
      return;
    }
    // Chrome and Firefox record webm; Safari records mp4.
    const type = ["audio/webm", "audio/mp4", "audio/ogg"].find((m) =>
      MediaRecorder.isTypeSupported(m),
    );
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: rec.mimeType || type || "audio/webm" });
      cleanup();
      setState({ status: "idle" });
      finished.current?.(blob);
      finished.current = null;
    };
    recorder.current = rec;
    rec.start(1000);
    let seconds = 0;
    setState({ status: "recording", seconds });
    timer.current = setInterval(() => {
      seconds += 1;
      setState({ status: "recording", seconds });
      if (seconds >= MAX_RECORDING_SECONDS) void stop();
    }, 1000);
  }, [cleanup, stop]);

  return { state, start, stop };
}

export function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const POLL_MS = 2000;
const POLL_LIMIT_MS = 3 * 60_000;

/**
 * Uploads a voice note or photo for a class, asks for the reading, and waits for its text.
 * Returns the text and the file id the entry must refer to.
 */
export async function readMedia(
  kind: "AUDIO" | "PHOTO",
  file: Blob & { name?: string },
  classId: string,
): Promise<{ text: string; fileId: string }> {
  const fileId = await uploadFile(kind, file, { classId });
  const path = kind === "AUDIO" ? "transcriptions" : "photo-readings";
  let reading = await api<MediaReadingView>(`/classes/${classId}/${path}`, { body: { fileId } });
  const deadline = Date.now() + POLL_LIMIT_MS;
  while (reading.status === "QUEUED" || reading.status === "RUNNING") {
    if (Date.now() > deadline) throw new ApiError(504, "UPSTREAM_ERROR", t.network.failed);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    reading = await api<MediaReadingView>(`/media-readings/${reading.id}`);
  }
  if (reading.status === "FAILED" || !reading.text) {
    throw new ApiError(422, "UPSTREAM_ERROR", reading.error ?? t.network.failed);
  }
  return { text: reading.text, fileId };
}
