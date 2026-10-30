import { createHash, randomBytes } from "node:crypto";
import type { Collection } from "mongodb";
import clientPromise from "@/lib/mongodb";
import pool from "@/lib/mysql";

export const userRoles = ["LOGISTICS_MANAGER", "OPERATIONS_STAFF", "ADMIN"] as const;
export type UserRole = (typeof userRoles)[number];

export type AuthenticatedUser = {
  user_id: number;
  full_name: string;
  email: string;
  role: UserRole;
};

type SessionRecord = {
  token_hash: string;
  user_id: number;
  expires_at: Date;
  created_at: Date;
};

const sessionCookie = "ccg_session";
const sessionLifetimeSeconds = 60 * 60 * 12;

function sessionCollection(): Promise<Collection<SessionRecord>> {
  return clientPromise.then((client) => {
    const databaseName = process.env.MONGODB_DATABASE;
    if (!databaseName) throw new Error("MongoDB database configuration is missing.");
    return client.db(databaseName).collection<SessionRecord>("user_sessions");
  });
}

function getToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7).trim() || null;
  const cookieHeader = request.headers.get("cookie") ?? "";
  const pair = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${sessionCookie}=`));
  return pair ? decodeURIComponent(pair.slice(sessionCookie.length + 1)) : null;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: number): Promise<{ token: string; maxAge: number }> {
  const collection = await sessionCollection();
  await Promise.all([
    collection.createIndex({ token_hash: 1 }, { unique: true, name: "uq_user_sessions_token_hash" }),
    collection.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0, name: "ttl_user_sessions_expiry" }),
  ]);
  const token = randomBytes(32).toString("base64url");
  const createdAt = new Date();
  await collection.insertOne({
    token_hash: tokenHash(token),
    user_id: userId,
    created_at: createdAt,
    expires_at: new Date(createdAt.getTime() + sessionLifetimeSeconds * 1000),
  });
  return { token, maxAge: sessionLifetimeSeconds };
}

export async function destroySession(request: Request): Promise<void> {
  const token = getToken(request);
  if (!token) return;
  const collection = await sessionCollection();
  await collection.deleteOne({ token_hash: tokenHash(token) });
}

export async function revokeUserSessions(userId: number): Promise<void> {
  const collection = await sessionCollection();
  await collection.deleteMany({ user_id: userId });
}

export function sessionCookieHeader(token: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${sessionCookie}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

export function clearSessionCookieHeader(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${sessionCookie}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}

export async function getAuthenticatedUser(request: Request): Promise<AuthenticatedUser | null> {
  const token = getToken(request);
  if (!token) return null;
  const collection = await sessionCollection();
  const session = await collection.findOne({ token_hash: tokenHash(token), expires_at: { $gt: new Date() } });
  if (!session) return null;
  const [rows] = await pool.execute(
    "SELECT user_id, full_name, email, role FROM users WHERE user_id = ? AND is_active = 1",
    [session.user_id],
  );
  return (rows as AuthenticatedUser[])[0] ?? null;
}

export async function authorize(
  request: Request,
  allowedRoles: readonly UserRole[],
): Promise<{ user: AuthenticatedUser } | { response: Response }> {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return { response: Response.json({ success: false, message: "Authentication required" }, { status: 401 }) };
  }
  if (!allowedRoles.includes(user.role)) {
    return { response: Response.json({ success: false, message: "Insufficient role permissions" }, { status: 403 }) };
  }
  return { user };
}

export const managerAndAdmin: readonly UserRole[] = ["LOGISTICS_MANAGER", "ADMIN"];
export const staffAndAbove: readonly UserRole[] = ["LOGISTICS_MANAGER", "OPERATIONS_STAFF", "ADMIN"];

export function shipmentAccessCondition(alias: string, user: AuthenticatedUser): { sql: string; params: number[] } {
  if (user.role !== "OPERATIONS_STAFF") return { sql: "", params: [] };
  return {
    sql: `AND EXISTS (SELECT 1 FROM shipment_assignments AS sa WHERE sa.shipment_id = ${alias}.shipment_id AND sa.user_id = ?)`,
    params: [user.user_id],
  };
}
