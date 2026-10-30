import { NextResponse } from "next/server";
import pool from "@/lib/mysql";
import { authorize, managerAndAdmin } from "@/lib/auth";
import { catalogResources, isCatalogResource, validateCatalogBody } from "@/lib/catalog.mjs";

type RouteContext = { params: Promise<{ resource: string; id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  const { resource, id } = await params;
  const recordId = Number(id);
  if (!isCatalogResource(resource)) return NextResponse.json({ success: false, message: "Unsupported catalog resource" }, { status: 404 });
  if (!Number.isInteger(recordId) || recordId <= 0) return NextResponse.json({ success: false, message: "Invalid record ID" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ success: false, message: "Invalid JSON body" }, { status: 400 }); }
  const validation = validateCatalogBody(resource, body, true);
  if (validation) return NextResponse.json({ success: false, message: validation }, { status: 400 });
  try {
    const access = await authorize(request, managerAndAdmin);
    if ("response" in access) return access.response;
    const definition = catalogResources[resource];
    const [currentRows] = await pool.execute(`SELECT ${definition.fields.join(",")} FROM ${definition.table} WHERE ${definition.id} = ?`, [recordId]);
    const current = (currentRows as Record<string, unknown>[])[0];
    if (!current) return NextResponse.json({ success: false, message: "Record not found" }, { status: 404 });
    const merged = { ...current, ...(body as Record<string, unknown>) };
    const mergedValidation = validateCatalogBody(resource, merged);
    if (mergedValidation) return NextResponse.json({ success: false, message: mergedValidation }, { status: 400 });
    if ((body as Record<string, unknown>).status === "AVAILABLE" && (resource === "vehicles" || resource === "drivers")) {
      const key = resource === "vehicles" ? "vehicle_id" : "driver_id";
      const [activeRows] = await pool.execute(
        `SELECT COUNT(*) AS active_count FROM shipments WHERE ${key} = ? AND status IN ('CREATED','IN_TRANSIT','DELAYED')`,
        [recordId],
      );
      if (Number((activeRows as Array<{ active_count: number }>)[0].active_count) > 0) return NextResponse.json({ success: false, message: "Resource is assigned to an active shipment" }, { status: 409 });
    }
    const fields = Object.keys(body as object);
    const values = fields.map((field) => (body as Record<string, unknown>)[field]);
    const [result] = await pool.execute(`UPDATE ${definition.table} SET ${fields.map((field) => `${field} = ?`).join(", ")} WHERE ${definition.id} = ?`, [...values, recordId] as (string | number | boolean | null)[]);
    if ((result as { affectedRows: number }).affectedRows === 0) {
      const [rows] = await pool.execute(`SELECT ${definition.id} FROM ${definition.table} WHERE ${definition.id} = ?`, [recordId]);
      if (!(rows as unknown[]).length) return NextResponse.json({ success: false, message: "Record not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, message: "Catalog record updated", id: recordId });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error) {
      if (error.code === "ER_DUP_ENTRY") return NextResponse.json({ success: false, message: "A record with a unique field already exists" }, { status: 409 });
      if (error.code === "ER_NO_REFERENCED_ROW_2") return NextResponse.json({ success: false, message: "A referenced record does not exist" }, { status: 400 });
    }
    console.error("Failed to update catalog record:", error);
    return NextResponse.json({ success: false, message: "Unable to update catalog record" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const { resource, id } = await params;
  const recordId = Number(id);
  if (!isCatalogResource(resource)) return NextResponse.json({ success: false, message: "Unsupported catalog resource" }, { status: 404 });
  if (!Number.isInteger(recordId) || recordId <= 0) return NextResponse.json({ success: false, message: "Invalid record ID" }, { status: 400 });
  try {
    const access = await authorize(request, ["ADMIN"]);
    if ("response" in access) return access.response;
    const definition = catalogResources[resource];
    const [result] = await pool.execute(`DELETE FROM ${definition.table} WHERE ${definition.id} = ?`, [recordId]);
    if ((result as { affectedRows: number }).affectedRows === 0) return NextResponse.json({ success: false, message: "Record not found" }, { status: 404 });
    return NextResponse.json({ success: true, message: "Catalog record deleted", id: recordId });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ER_ROW_IS_REFERENCED_2") return NextResponse.json({ success: false, message: "Record is referenced by operational data and cannot be deleted" }, { status: 409 });
    console.error("Failed to delete catalog record:", error);
    return NextResponse.json({ success: false, message: "Unable to delete catalog record" }, { status: 500 });
  }
}
