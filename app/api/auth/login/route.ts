import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import pool from "@/lib/mysql";
import { createSession, sessionCookieHeader, type AuthenticatedUser } from "@/lib/auth";

export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.email !== "string" || typeof body.password !== "string" ||
      body.email.trim().length < 3 || body.email.trim().length > 150 ||
      body.password.length < 1 || body.password.length > 200) {
    return NextResponse.json({ success: false, message: "A valid email and password are required" }, { status: 400 });
  }

  try {
    const [rows] = await pool.execute(
      "SELECT user_id, full_name, email, password_hash, role FROM users WHERE email = ? AND is_active = 1 LIMIT 1",
      [body.email.trim().toLowerCase()],
    );
    const account = (rows as Array<AuthenticatedUser & { password_hash: string }>)[0];
    const passwordMatches = account ? await bcrypt.compare(body.password, account.password_hash) : false;
    if (!account || !passwordMatches) {
      return NextResponse.json({ success: false, message: "Invalid email or password" }, { status: 401 });
    }
    const session = await createSession(account.user_id);
    const response = NextResponse.json({
      success: true,
      user: { user_id: account.user_id, full_name: account.full_name, email: account.email, role: account.role },
      expiresInSeconds: session.maxAge,
    });
    response.headers.set("Set-Cookie", sessionCookieHeader(session.token, session.maxAge));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    console.error("Login failed:", error);
    return NextResponse.json({ success: false, message: "Unable to authenticate" }, { status: 500 });
  }
}
