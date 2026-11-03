import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import type { PoolConnection } from "mysql2/promise";
import pool from "@/lib/mysql";
import { authorize, userRoles } from "@/lib/auth";

type NewUserBody = { full_name?: unknown; email?: unknown; password?: unknown; role?: unknown };

export async function GET(request: Request) {
  try {
    const access = await authorize(request, ["ADMIN"]);
    if ("response" in access) return access.response;
    const [rows] = await pool.query("SELECT user_id, full_name, email, role, is_active, created_at FROM users ORDER BY user_id");
    return NextResponse.json({ success: true, count: Array.isArray(rows) ? rows.length : 0, users: rows });
  } catch (error) {
    console.error("Failed to list users:", error);
    return NextResponse.json({ success: false, message: "Unable to list users" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: NewUserBody;
  try { body = await request.json(); }
  catch { return NextResponse.json({ success: false, message: "Invalid JSON body" }, { status: 400 }); }

  if (typeof body.full_name !== "string" || body.full_name.trim().length < 2 || body.full_name.trim().length > 100 ||
      typeof body.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) || body.email.trim().length > 150 ||
      typeof body.password !== "string" || body.password.length < 12 || body.password.length > 200 ||
      typeof body.role !== "string" || !userRoles.includes(body.role as (typeof userRoles)[number])) {
    return NextResponse.json({ success: false, message: "Provide a name, valid email, password of at least 12 characters, and supported role" }, { status: 400 });
  }

  let connection: PoolConnection | undefined;
  try {
    const access = await authorize(request, ["ADMIN"]);
    if ("response" in access) return access.response;
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const passwordHash = await bcrypt.hash(body.password, 12);
    const [result] = await connection.execute(
      "INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, ?)",
      [body.full_name.trim(), body.email.trim().toLowerCase(), passwordHash, body.role],
    );
    const userId = (result as { insertId: number }).insertId;
    if (body.role === "OPERATIONS_STAFF") {
      await connection.execute(
        `INSERT IGNORE INTO shipment_assignments (shipment_id, user_id, assigned_by)
         SELECT s.shipment_id, ?, ?
         FROM shipments AS s
         WHERE NOT EXISTS (
           SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = s.shipment_id
         )`,
        [userId, access.user.user_id],
      );
    }
    await connection.commit();
    return NextResponse.json({ success: true, user: { user_id: userId, full_name: body.full_name.trim(), email: body.email.trim().toLowerCase(), role: body.role } }, { status: 201 });
  } catch (error) {
    if (connection) await connection.rollback();
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY") {
      return NextResponse.json({ success: false, message: "A user with that email already exists" }, { status: 409 });
    }
    console.error("Failed to create user:", error);
    return NextResponse.json({ success: false, message: "Unable to create user" }, { status: 500 });
  } finally {
    connection?.release();
  }
}
