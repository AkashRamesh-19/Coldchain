
import { NextResponse } from "next/server";
import pool from "@/lib/mysql";
import { authorize, managerAndAdmin, shipmentAccessCondition, staffAndAbove } from "@/lib/auth";

const isPositiveId = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0;
const isSqlDateTime = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!parts) return false;
  const [year, month, day, hour, minute, second] = parts.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day && date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute && date.getUTCSeconds() === second;
};

export async function GET(request: Request) {
  try {
    const access = await authorize(request, staffAndAbove);
    if ("response" in access) return access.response;
    const scope = shipmentAccessCondition("o", access.user);
    const [rows] = await pool.query(
      `SELECT o.* FROM shipment_overview AS o
       WHERE NOT EXISTS (
         SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = o.shipment_id
       ) ${scope.sql}
       ORDER BY o.shipment_id DESC`,
      scope.params,
    );

    return NextResponse.json({
      success: true,
      count: Array.isArray(rows) ? rows.length : 0,
      shipments: rows,
    });
  } catch (error) {
    console.error("Failed to fetch shipments:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Unable to fetch shipments",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  let body: {
    shipment_code?: unknown; supplier_id?: unknown; source_warehouse_id?: unknown;
    destination_warehouse_id?: unknown; vehicle_id?: unknown; driver_id?: unknown;
    route_id?: unknown; shipment_date?: unknown; expected_delivery?: unknown;
    items?: unknown; assigned_user_ids?: unknown;
  };
  try { body = await request.json(); }
  catch { return NextResponse.json({ success: false, message: "Invalid JSON body" }, { status: 400 }); }

  const idFields = ["supplier_id", "source_warehouse_id", "destination_warehouse_id", "vehicle_id", "driver_id", "route_id"] as const;
  if (typeof body.shipment_code !== "string" || body.shipment_code.trim().length < 2 || body.shipment_code.trim().length > 50 ||
      idFields.some((field) => !isPositiveId(body[field])) ||
      !isSqlDateTime(body.shipment_date) || !isSqlDateTime(body.expected_delivery) || body.expected_delivery < body.shipment_date ||
      !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100 ||
      body.items.some((item) => !item || typeof item !== "object" || !isPositiveId((item as Record<string, unknown>).product_id) ||
        typeof (item as Record<string, unknown>).quantity !== "number" || !Number.isFinite((item as Record<string, number>).quantity) || (item as Record<string, number>).quantity <= 0 ||
        typeof (item as Record<string, unknown>).unit_weight_kg !== "number" || !Number.isFinite((item as Record<string, number>).unit_weight_kg) || (item as Record<string, number>).unit_weight_kg <= 0) ||
      (body.assigned_user_ids !== undefined && (!Array.isArray(body.assigned_user_ids) || body.assigned_user_ids.some((id) => !isPositiveId(id))))) {
    return NextResponse.json({ success: false, message: "Shipment fields, date range, item quantities, or assignments are invalid" }, { status: 400 });
  }

  let connection;
  try {
    const access = await authorize(request, managerAndAdmin);
    if ("response" in access) return access.response;
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [routeRows] = await connection.execute(
      "SELECT source_warehouse_id, destination_warehouse_id FROM routes WHERE route_id = ? FOR UPDATE",
      [body.route_id as number],
    );
    const route = (routeRows as Array<{ source_warehouse_id: number; destination_warehouse_id: number }>)[0];
    if (!route || route.source_warehouse_id !== body.source_warehouse_id || route.destination_warehouse_id !== body.destination_warehouse_id) {
      await connection.rollback();
      return NextResponse.json({ success: false, message: "Route does not match the selected warehouse endpoints" }, { status: 400 });
    }

    const [vehicleRows] = await connection.execute("SELECT status FROM vehicles WHERE vehicle_id = ? FOR UPDATE", [body.vehicle_id as number]);
    const [driverRows] = await connection.execute("SELECT status FROM drivers WHERE driver_id = ? FOR UPDATE", [body.driver_id as number]);
    if ((vehicleRows as Array<{ status: string }>)[0]?.status !== "AVAILABLE" || (driverRows as Array<{ status: string }>)[0]?.status !== "AVAILABLE") {
      await connection.rollback();
      return NextResponse.json({ success: false, message: "Selected vehicle and driver must both be available" }, { status: 409 });
    }
    const [activeUseRows] = await connection.execute(
      `SELECT COUNT(*) AS active_count FROM shipments
       WHERE (vehicle_id = ? OR driver_id = ?) AND status IN ('CREATED', 'IN_TRANSIT', 'DELAYED')`,
      [body.vehicle_id as number, body.driver_id as number],
    );
    if (Number((activeUseRows as Array<{ active_count: number }>)[0].active_count) > 0) {
      await connection.rollback();
      return NextResponse.json({ success: false, message: "Selected vehicle or driver is already assigned to an active shipment" }, { status: 409 });
    }

    if (body.assigned_user_ids && body.assigned_user_ids.length) {
      const ids = [...new Set(body.assigned_user_ids as number[])];
      const placeholders = ids.map(() => "?").join(",");
      const [users] = await connection.execute(
        `SELECT user_id FROM users WHERE is_active = 1 AND role = 'OPERATIONS_STAFF' AND user_id IN (${placeholders})`, ids,
      );
      if ((users as Array<{ user_id: number }>).length !== ids.length) {
        await connection.rollback();
        return NextResponse.json({ success: false, message: "Assignments must reference active operations staff users" }, { status: 400 });
      }
    }

    const [insert] = await connection.execute(
      `INSERT INTO shipments
       (shipment_code, supplier_id, source_warehouse_id, destination_warehouse_id,
        vehicle_id, driver_id, route_id, shipment_date, expected_delivery, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CREATED')`,
      [body.shipment_code.trim(), body.supplier_id as number, body.source_warehouse_id as number, body.destination_warehouse_id as number,
        body.vehicle_id as number, body.driver_id as number, body.route_id as number, body.shipment_date as string, body.expected_delivery as string],
    );
    const shipmentId = (insert as { insertId: number }).insertId;
    await connection.execute("UPDATE vehicles SET status = 'IN_TRANSIT' WHERE vehicle_id = ?", [body.vehicle_id as number]);
    await connection.execute("UPDATE drivers SET status = 'ON_DUTY' WHERE driver_id = ?", [body.driver_id as number]);
    for (const item of body.items as Array<{ product_id: number; quantity: number; unit_weight_kg: number }>) {
      await connection.execute(
        "INSERT INTO shipment_items (shipment_id, product_id, quantity, unit_weight_kg) VALUES (?, ?, ?, ?)",
        [shipmentId, item.product_id, item.quantity, item.unit_weight_kg],
      );
    }
    await connection.execute(
      `INSERT INTO shipment_status_history (shipment_id, old_status, new_status, changed_by, remarks)
       VALUES (?, NULL, 'CREATED', ?, 'Initial status recorded during shipment creation')`,
      [shipmentId, access.user.user_id],
    );
    for (const userId of [...new Set((body.assigned_user_ids ?? []) as number[])]) {
      await connection.execute(
        "INSERT INTO shipment_assignments (shipment_id, user_id, assigned_by) VALUES (?, ?, ?)",
        [shipmentId, userId, access.user.user_id],
      );
    }
    await connection.commit();
    return NextResponse.json({ success: true, shipmentId, shipmentCode: body.shipment_code.trim(), status: "CREATED", itemCount: (body.items as unknown[]).length }, { status: 201 });
  } catch (error) {
    if (connection) await connection.rollback();
    if (typeof error === "object" && error !== null && "code" in error) {
      if (error.code === "ER_DUP_ENTRY") return NextResponse.json({ success: false, message: "Shipment code or shipment item already exists" }, { status: 409 });
      if (error.code === "ER_NO_REFERENCED_ROW_2") return NextResponse.json({ success: false, message: "A referenced supplier, warehouse, vehicle, driver, route, or product does not exist" }, { status: 400 });
    }
    console.error("Failed to create shipment:", error);
    return NextResponse.json({ success: false, message: "Unable to create shipment" }, { status: 500 });
  } finally {
    connection?.release();
  }
}
