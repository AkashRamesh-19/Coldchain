import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import pool from "@/lib/mysql";
import { createSession, sessionCookieHeader, type AuthenticatedUser } from "@/lib/auth";

export async function handleLogin(request: Request, audience: "admin" | "employee" | "any" = "any") {
  let body: { email?: unknown; employeeId?: unknown; password?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ success: false, message: "Invalid JSON body" }, { status: 400 }); }
  const identifier = typeof body.email === "string" ? body.email.trim().toLowerCase() :
    typeof body.employeeId === "string" ? body.employeeId.trim() : "";
  if (identifier.length < 1 || identifier.length > 150 || typeof body.password !== "string" || body.password.length < 1 || body.password.length > 200) {
    return NextResponse.json({ success: false, message: "Provide an email or employee ID and password" }, { status: 400 });
  }
  try {
    const [rows] = await pool.execute(
      `SELECT user_id, full_name, email, password_hash, role FROM users
       WHERE is_active = 1 AND (LOWER(email) = ? OR CAST(user_id AS CHAR) = ?) LIMIT 1`,
      [identifier, identifier],
    );
    const account = (rows as Array<AuthenticatedUser & { password_hash: string }>)[0];
    const matchesAudience = audience === "any" || (audience === "admin" ? account?.role === "ADMIN" : account?.role !== "ADMIN");
    const passwordMatches = account && matchesAudience ? await bcrypt.compare(body.password, account.password_hash) : false;
    if (!account || !passwordMatches) return NextResponse.json({ success: false, message: "Invalid credentials for this sign-in" }, { status: 401 });
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
