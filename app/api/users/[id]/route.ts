import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import pool from "@/lib/mysql";
import { authorize, revokeUserSessions, userRoles } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const userId = Number(id);
  if (!Number.isInteger(userId) || userId <= 0) return NextResponse.json({ success: false, message: "Invalid user ID" }, { status: 400 });

  let body: { full_name?: unknown; email?: unknown; password?: unknown; role?: unknown; is_active?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ success: false, message: "Invalid JSON body" }, { status: 400 }); }
  if (body.full_name === undefined && body.email === undefined && body.password === undefined && body.role === undefined && body.is_active === undefined) {
    return NextResponse.json({ success: false, message: "At least one supported user field is required" }, { status: 400 });
  }
  if (body.full_name !== undefined && (typeof body.full_name !== "string" || body.full_name.trim().length < 2 || body.full_name.trim().length > 100)) return NextResponse.json({ success: false, message: "Invalid full_name" }, { status: 400 });
  if (body.email !== undefined && (typeof body.email !== "string" || body.email.trim().length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()))) return NextResponse.json({ success: false, message: "Invalid email" }, { status: 400 });
  if (body.password !== undefined && (typeof body.password !== "string" || body.password.length < 12 || body.password.length > 200)) return NextResponse.json({ success: false, message: "Password must be at least 12 characters" }, { status: 400 });
  if (body.role !== undefined && (typeof body.role !== "string" || !userRoles.includes(body.role as (typeof userRoles)[number]))) return NextResponse.json({ success: false, message: "Invalid role" }, { status: 400 });
  if (body.is_active !== undefined && typeof body.is_active !== "boolean") return NextResponse.json({ success: false, message: "is_active must be a boolean" }, { status: 400 });

  try {
    const access = await authorize(request, ["ADMIN"]);
    if ("response" in access) return access.response;
    if (access.user.user_id === userId && (body.is_active === false || body.role !== undefined && body.role !== "ADMIN")) return NextResponse.json({ success: false, message: "Administrators cannot deactivate or demote their own account" }, { status: 400 });
    if (body.is_active === false || body.role !== undefined && body.role !== "ADMIN") {
      const [adminRows] = await pool.execute("SELECT role FROM users WHERE user_id = ? AND is_active = 1", [userId]);
      if ((adminRows as Array<{ role: string }>)[0]?.role === "ADMIN") {
        const [activeAdmins] = await pool.query("SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN' AND is_active = 1");
        if (Number((activeAdmins as Array<{ count: number }>)[0].count) <= 1) return NextResponse.json({ success: false, message: "At least one active administrator must remain" }, { status: 409 });
      }
    }
    const assignments: string[] = [];
    const values: unknown[] = [];
    if (body.full_name !== undefined) { assignments.push("full_name = ?"); values.push(body.full_name.trim()); }
    if (body.email !== undefined) { assignments.push("email = ?"); values.push(body.email.trim().toLowerCase()); }
    if (body.password !== undefined) { assignments.push("password_hash = ?"); values.push(await bcrypt.hash(body.password, 12)); }
    if (body.role !== undefined) { assignments.push("role = ?"); values.push(body.role); }
    if (body.is_active !== undefined) { assignments.push("is_active = ?"); values.push(body.is_active ? 1 : 0); }
    values.push(userId);
    const [result] = await pool.execute(`UPDATE users SET ${assignments.join(", ")} WHERE user_id = ?`, values as (string | number | null)[]);
    if ((result as { affectedRows: number }).affectedRows === 0) {
      const [existing] = await pool.execute("SELECT user_id FROM users WHERE user_id = ?", [userId]);
      if (!(existing as unknown[]).length) return NextResponse.json({ success: false, message: "User not found" }, { status: 404 });
    }
    if (body.password !== undefined || body.is_active === false || body.role !== undefined) await revokeUserSessions(userId);
    const [rows] = await pool.execute("SELECT user_id, full_name, email, role, is_active, created_at FROM users WHERE user_id = ?", [userId]);
    return NextResponse.json({ success: true, user: (rows as unknown[])[0] });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY") return NextResponse.json({ success: false, message: "A user with that email already exists" }, { status: 409 });
    console.error("Failed to update user:", error);
    return NextResponse.json({ success: false, message: "Unable to update user" }, { status: 500 });
  }
}
