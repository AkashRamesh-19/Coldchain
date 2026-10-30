import { NextResponse } from "next/server";
import pool from "@/lib/mysql";
import { authorize, managerAndAdmin } from "@/lib/auth";
import { catalogResources, isCatalogResource, validateCatalogBody } from "@/lib/catalog.mjs";

type RouteContext = { params: Promise<{ resource: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const { resource } = await params;
  if (!isCatalogResource(resource)) return NextResponse.json({ success: false, message: "Unsupported catalog resource" }, { status: 404 });
  try {
    const access = await authorize(request, managerAndAdmin);
    if ("response" in access) return access.response;
    const definition = catalogResources[resource];
    const [rows] = await pool.query(`SELECT * FROM ${definition.table} ORDER BY ${definition.id} LIMIT 1000`);
    return NextResponse.json({ success: true, count: Array.isArray(rows) ? rows.length : 0, items: rows });
  } catch (error) {
    console.error("Failed to list catalog records:", error);
    return NextResponse.json({ success: false, message: "Unable to list catalog records" }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  const { resource } = await params;
  if (!isCatalogResource(resource)) return NextResponse.json({ success: false, message: "Unsupported catalog resource" }, { status: 404 });
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ success: false, message: "Invalid JSON body" }, { status: 400 }); }
  const validation = validateCatalogBody(resource, body);
  if (validation) return NextResponse.json({ success: false, message: validation }, { status: 400 });
  try {
    const access = await authorize(request, managerAndAdmin);
    if ("response" in access) return access.response;
    const definition = catalogResources[resource];
    const fields = Object.keys(body as object);
    const values = fields.map((field) => (body as Record<string, unknown>)[field]);
    const [result] = await pool.execute(`INSERT INTO ${definition.table} (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`, values as (string | number | null)[]);
    return NextResponse.json({ success: true, id: (result as { insertId: number }).insertId }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error) {
      if (error.code === "ER_DUP_ENTRY") return NextResponse.json({ success: false, message: "A record with a unique field already exists" }, { status: 409 });
      if (error.code === "ER_NO_REFERENCED_ROW_2") return NextResponse.json({ success: false, message: "A referenced record does not exist" }, { status: 400 });
    }
    console.error("Failed to create catalog record:", error);
    return NextResponse.json({ success: false, message: "Unable to create catalog record" }, { status: 500 });
  }
}
