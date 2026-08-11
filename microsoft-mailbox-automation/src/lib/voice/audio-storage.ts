/**
 * Audio storage for voice and diary recordings.
 *
 * Saves audio blobs to the persistent data directory (Fly.io volume at /app/data,
 * local at ./data). Returns a stable URL that the API can serve back.
 */

import * as fs from "fs";
import * as path from "path";

const DATA_DIR = process.env.AUDIO_DATA_DIR || path.join(process.cwd(), "data");
const DIARY_AUDIO_DIR = path.join(DATA_DIR, "audio", "diary");

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getDiaryAudioPath(sessionId: string, segmentId: string, ext = "webm"): string {
  const safeSession = sanitizeForPath(sessionId);
  const safeSegment = sanitizeForPath(segmentId);
  const dir = path.join(DIARY_AUDIO_DIR, safeSession);
  ensureDir(dir);
  return path.join(dir, `${safeSegment}.${ext}`);
}

export function getDiaryAudioUrl(sessionId: string, segmentId: string, ext = "webm"): string {
  return `/api/voice/diary/audio?sessionId=${encodeURIComponent(sessionId)}&segmentId=${encodeURIComponent(segmentId)}&ext=${ext}`;
}

export function saveDiaryAudio(
  sessionId: string,
  segmentId: string,
  buffer: Buffer,
  ext = "webm",
): string {
  const filePath = getDiaryAudioPath(sessionId, segmentId, ext);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, buffer);
  return getDiaryAudioUrl(sessionId, segmentId, ext);
}

export function readDiaryAudio(sessionId: string, segmentId: string, ext = "webm"): Buffer | null {
  const filePath = getDiaryAudioPath(sessionId, segmentId, ext);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
}

function sanitizeForPath(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}
