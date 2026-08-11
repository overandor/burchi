import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { createDiaryEntryFromTranscript } from "@/lib/voice/diary";
import { saveDiaryAudio, readDiaryAudio } from "@/lib/voice/audio-storage";
import { transcribeAudio } from "@/lib/voice/transcribe";

export const dynamic = "force-dynamic";

const MAX_SIZE_MB = 25;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

/**
 * POST /api/voice/diary/audio
 * Multipart form:
 *   - audio: Blob
 *   - text: transcript text (optional, but recommended)
 *   - sessionId: optional voice session id
 *   - segmentId: optional unique segment id
 *
 * Saves the audio and creates a diary entry with an audio_url.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getAuthContext().catch(() => null);
    const formData = await request.formData();

    const audio = formData.get("audio");
    if (!audio || !(audio instanceof Blob)) {
      return NextResponse.json({ error: "audio is required" }, { status: 400 });
    }

    if (audio.size > MAX_SIZE_BYTES) {
      return NextResponse.json(
        { error: `audio exceeds ${MAX_SIZE_MB}MB limit` },
        { status: 413 },
      );
    }

    const transcribeRequested = String(formData.get("transcribe") || "").trim() === "true";
    let text = String(formData.get("text") || "").trim();
    const sessionId = String(formData.get("sessionId") || `session_${Date.now()}`);
    const segmentId = String(formData.get("segmentId") || `seg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    const language = String(formData.get("language") || "").trim() || undefined;

    const arrayBuffer = await audio.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const mime = audio.type;
    const ext = mime === "audio/mp4" ? "m4a" : mime === "audio/ogg" ? "ogg" : mime === "audio/wav" ? "wav" : "webm";

    const audioUrl = saveDiaryAudio(sessionId, segmentId, buffer, ext);

    let transcription: { text: string; provider: string; model: string } | null = null;
    if (transcribeRequested && !text) {
      try {
        transcription = await transcribeAudio(buffer, mime, language);
        text = transcription.text;
      } catch (e: any) {
        console.error("[voice/diary/audio] transcription failed:", e.message);
        return NextResponse.json(
          { error: e.message, audioUrl },
          { status: 503 },
        );
      }
    }

    let entry = null;
    if (text) {
      entry = await createDiaryEntryFromTranscript({
        sessionId,
        segmentId,
        text,
        employeeId: ctx?.user.id || sessionId,
        orgId: ctx?.orgId,
        audioUrl,
      });
    }

    return NextResponse.json({
      sessionId,
      segmentId,
      audioUrl,
      size: buffer.length,
      mime,
      entry,
      transcription,
    });
  } catch (e: any) {
    console.error("[voice/diary/audio POST] error:", e);
    return NextResponse.json({ error: e.message || "Internal error" }, { status: 500 });
  }
}

/**
 * GET /api/voice/diary/audio?sessionId=...&segmentId=...&ext=webm
 * Serves a stored audio file.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");
    const segmentId = searchParams.get("segmentId");
    const ext = searchParams.get("ext") || "webm";

    if (!sessionId || !segmentId) {
      return NextResponse.json({ error: "sessionId and segmentId are required" }, { status: 400 });
    }

    const buffer = readDiaryAudio(sessionId, segmentId, ext);
    if (!buffer) {
      return NextResponse.json({ error: "audio not found" }, { status: 404 });
    }

    const headers = new Headers();
    headers.set("Content-Type", getMimeType(ext));
    headers.set("Content-Length", String(buffer.length));

    return new NextResponse(new Uint8Array(buffer), { headers });
  } catch (e: any) {
    console.error("[voice/diary/audio GET] error:", e);
    return NextResponse.json({ error: e.message || "Internal error" }, { status: 500 });
  }
}

function getMimeType(ext: string): string {
  switch (ext) {
    case "m4a":
    case "mp4":
      return "audio/mp4";
    case "ogg":
      return "audio/ogg";
    case "wav":
      return "audio/wav";
    case "mp3":
      return "audio/mpeg";
    default:
      return "audio/webm";
  }
}
