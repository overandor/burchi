import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { PhoneImage } from "@/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/phones/images — process an uploaded image for a phone number.
 * Accepts base64-encoded image data and returns a PhoneImage object.
 *
 * Body: { phoneId, filename, contentType, dataUrl, caption? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    if (!body.dataUrl || !body.phoneId) {
      return NextResponse.json(
        { error: "phoneId and dataUrl are required" },
        { status: 400 }
      );
    }

    if (!body.dataUrl.startsWith("data:")) {
      return NextResponse.json(
        { error: "dataUrl must be a valid data URL (data:image/...;base64,...)" },
        { status: 400 }
      );
    }

    const mimeType = body.dataUrl.match(/^data:([^;,]+)/)?.[1] || "";
    if (!mimeType.startsWith("image/")) {
      return NextResponse.json(
        { error: "contentType must be an image type (e.g. image/png, image/jpeg)" },
        { status: 400 }
      );
    }

    const base64Part = body.dataUrl.split(",")[1] || "";
    const sizeBytes = Math.floor((base64Part.length * 3) / 4);

    if (sizeBytes > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Image too large (max 10 MB)" },
        { status: 413 }
      );
    }

    const image: PhoneImage = {
      id: nanoid(12),
      timestamp: new Date().toISOString(),
      filename: body.filename || `image-${Date.now()}.png`,
      contentType: body.contentType || "image/png",
      dataUrl: body.dataUrl,
      sizeBytes,
      caption: body.caption,
    };

    return NextResponse.json({ image, ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
