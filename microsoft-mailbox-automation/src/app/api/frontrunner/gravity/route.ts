import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import {
  getChoiceGravityQuestions,
  recordChoiceGravity,
  getChoiceGravityAnswers,
} from "@/lib/frontrunner";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action") || "questions";

    if (action === "questions") {
      return NextResponse.json({ questions: getChoiceGravityQuestions() });
    }

    if (action === "answers") {
      const answers = getChoiceGravityAnswers(ctx.orgId, ctx.user.id);
      return NextResponse.json({ answers, count: answers.length });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    const body = await req.json();

    if (!body.questionId || typeof body.questionId !== "string") {
      return NextResponse.json({ error: "questionId required" }, { status: 400 });
    }
    if (!body.answer || typeof body.answer !== "string") {
      return NextResponse.json({ error: "answer required" }, { status: 400 });
    }
    if (!body.questionText || typeof body.questionText !== "string") {
      return NextResponse.json({ error: "questionText required" }, { status: 400 });
    }

    recordChoiceGravity(
      ctx.orgId,
      ctx.user.id,
      body.questionId,
      body.questionText,
      body.answer,
      body.weightChanges || {},
    );

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
