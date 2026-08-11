import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** GET /api/registrar/vault — returns the identity profile (no passwords). */
export async function GET() {
  const { loadIdentity, loadCredentials } = await import("@/lib/registrar");
  try {
    const identity = loadIdentity();
    const credentials = loadCredentials().map((c) => ({
      ...c,
      password: undefined, // never expose passwords over the API
    }));
    return NextResponse.json({ identity, credentials, hasIdentity: !!identity });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/** POST /api/registrar/vault — save or update the identity profile. */
export async function POST(req: Request) {
  const { saveIdentity } = await import("@/lib/registrar");
  try {
    const body = await req.json();
    if (!body.email || !body.firstName || !body.lastName || !body.usernameStem) {
      return NextResponse.json(
        { error: "missing required fields: email, firstName, lastName, usernameStem" },
        { status: 400 },
      );
    }
    const profile = {
      email: String(body.email).trim(),
      firstName: String(body.firstName).trim(),
      lastName: String(body.lastName).trim(),
      usernameStem: String(body.usernameStem).trim(),
      phone: body.phone ? String(body.phone).trim() : undefined,
      birthdate: body.birthdate ? String(body.birthdate).trim() : undefined,
      needs: Array.isArray(body.needs) ? body.needs.map(String) : [],
    };
    saveIdentity(profile);
    return NextResponse.json({ ok: true, identity: { ...profile, needs: profile.needs } });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
