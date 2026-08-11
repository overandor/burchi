/**
 * Server-side audio transcription.
 *
 * Primary: OpenAI Whisper (requires OPENAI_API_KEY).
 * Fallback: none. Without a key the caller must use browser-provided transcript.
 *
 * Add OPENAI_API_KEY to enable real audio-to-text on the server:
 *   fly secrets set OPENAI_API_KEY=sk-... -a mailbox-sci-data
 */

import OpenAI from "openai";
import { toFile } from "openai";

const MAX_WHISPER_MB = 25;

export interface TranscriptionResult {
  text: string;
  provider: string;
  model: string;
}

export async function transcribeAudio(
  buffer: Buffer,
  mime: string,
  language?: string,
): Promise<TranscriptionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured; cannot transcribe audio");
  }

  if (buffer.length > MAX_WHISPER_MB * 1024 * 1024) {
    throw new Error(`Audio exceeds ${MAX_WHISPER_MB}MB Whisper limit`);
  }

  const client = new OpenAI({ apiKey, baseURL, timeout: 60 * 1000, maxRetries: 2 });

  const ext = mime === "audio/mp4" ? "m4a" : mime === "audio/ogg" ? "ogg" : mime === "audio/wav" ? "wav" : "webm";
  const file = await toFile(buffer, `recording.${ext}`, { type: mime || "audio/webm" });

  const response = await client.audio.transcriptions.create({
    file,
    model: "whisper-1",
    language,
    response_format: "json",
  });

  return {
    text: response.text.trim(),
    provider: "openai",
    model: "whisper-1",
  };
}
