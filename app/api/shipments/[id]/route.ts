
import { NextResponse } from "next/server";
import type { PoolConnection } from "mysql2/promise";
import pool from "@/lib/mysql";
import { authorize, shipmentAccessCondition, staffAndAbove } from "@/lib/auth";

const allowedStatuses = [
  "CREATED",
  "IN_TRANSIT",
  "DELAYED",
  "DELIVERED",
  "CANCELLED",
] as const;

type ShipmentStatus = (typeof allowedStatuses)[number];

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const shipmentId = Number(id);
  if (!Number.isInteger(shipmentId) || shipmentId <= 0) return NextResponse.json({ success: false, message: "Invalid shipment ID" }, { status: 400 });
  try {
    const access = await authorize(request, staffAndAbove);
    if ("response" in access) return access.response;
    const scope = shipmentAccessCondition("s", access.user);
    const [shipmentRows] = await pool.execute(
      `SELECT o.* FROM shipment_overview AS o
       INNER JOIN shipments AS s ON s.shipment_id = o.shipment_id
       WHERE s.shipment_id = ? AND NOT EXISTS (
         SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = s.shipment_id
       ) ${scope.sql}`,
      [shipmentId, ...scope.params],
    );
    const shipment = (shipmentRows as Record<string, unknown>[])[0];
    if (!shipment) return NextResponse.json({ success: false, message: "Shipment not found" }, { status: 404 });
    const [items] = await pool.execute(
      `SELECT si.product_id, p.product_name, p.min_temperature, p.max_temperature,
              p.min_humidity, p.max_humidity, si.quantity, si.unit_weight_kg
       FROM shipment_items AS si INNER JOIN products AS p ON p.product_id = si.product_id
       WHERE si.shipment_id = ? ORDER BY p.product_id`, [shipmentId],
    );
    const [history] = await pool.execute(
      "SELECT history_id, old_status, new_status, changed_by, changed_at, remarks FROM shipment_status_history WHERE shipment_id = ? ORDER BY changed_at, history_id",
      [shipmentId],
    );
    return NextResponse.json({ success: true, shipment, items, statusHistory: history });
  } catch (error) {
    console.error("Failed to fetch shipment detail:", error);
    return NextResponse.json({ success: false, message: "Unable to fetch shipment" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: RouteContext
) {
  const { id } = await params;
  const shipmentId = Number(id);

  if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
    return NextResponse.json(
      { success: false, message: "Invalid shipment ID" },
      { status: 400 }
    );
  }

  let body: { status?: unknown };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (
    typeof body.status !== "string" ||
    !allowedStatuses.includes(body.status as ShipmentStatus)
  ) {
    return NextResponse.json(
      {
        success: false,
        message: "Invalid status",
        allowedStatuses,
      },
      { status: 400 }
    );
  }

  let connection: PoolConnection | undefined;
  try {
    const access = await authorize(request, staffAndAbove);
    if ("response" in access) return access.response;
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const scope = shipmentAccessCondition("s", access.user);
    const [existing] = await connection.execute(
      `SELECT s.shipment_id, s.status, s.vehicle_id, s.driver_id FROM shipments AS s
       WHERE s.shipment_id = ? AND NOT EXISTS (
         SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = s.shipment_id
       ) ${scope.sql} FOR UPDATE`,
      [shipmentId, ...scope.params],
    );

    const shipments = existing as Array<{
      shipment_id: number;
      status: string;
      vehicle_id: number;
      driver_id: number;
    }>;

    if (shipments.length === 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Shipment not found" },
        { status: 404 }
      );
    }

    const currentStatus = shipments[0].status;
    const newStatus = body.status as ShipmentStatus;

    if (currentStatus === newStatus) {
      await connection.rollback();
      return NextResponse.json({
        success: true,
        message: "Shipment already has this status",
        shipmentId,
        status: currentStatus,
      });
    }

    const transitions: Record<string, readonly string[]> = {
      CREATED: ["IN_TRANSIT", "DELAYED", "CANCELLED"],
      IN_TRANSIT: ["DELAYED", "DELIVERED", "CANCELLED"],
      DELAYED: ["IN_TRANSIT", "DELIVERED", "CANCELLED"],
      DELIVERED: [],
      CANCELLED: [],
    };
    if (!transitions[currentStatus]?.includes(newStatus)) {
      await connection.rollback();
      return NextResponse.json({ success: false, message: `Shipment cannot transition from ${currentStatus} to ${newStatus}` }, { status: 409 });
    }

    await connection.execute(
      `UPDATE shipments
       SET status = ?,
           actual_delivery = CASE
             WHEN ? = 'DELIVERED' THEN COALESCE(actual_delivery, CURRENT_TIMESTAMP)
             ELSE actual_delivery
           END
       WHERE shipment_id = ?`,
      [newStatus, newStatus, shipmentId]
    );
    const [historyRows] = await connection.execute(
      `SELECT history_id FROM shipment_status_history
       WHERE shipment_id = ? AND old_status = ? AND new_status = ?
       ORDER BY history_id DESC LIMIT 1`,
      [shipmentId, currentStatus, newStatus],
    );
    const historyId = (historyRows as Array<{ history_id: number }>)[0]?.history_id;
    if (historyId) await connection.execute("UPDATE shipment_status_history SET changed_by = ? WHERE history_id = ?", [access.user.user_id, historyId]);
    if (newStatus === "DELIVERED" || newStatus === "CANCELLED") {
      await connection.execute("SELECT vehicle_id FROM vehicles WHERE vehicle_id = ? FOR UPDATE", [shipments[0].vehicle_id]);
      await connection.execute("SELECT driver_id FROM drivers WHERE driver_id = ? FOR UPDATE", [shipments[0].driver_id]);
      const [activeRows] = await connection.execute(
        `SELECT COUNT(*) AS active_count FROM shipments
         WHERE shipment_id <> ? AND (vehicle_id = ? OR driver_id = ?)
           AND status IN ('CREATED', 'IN_TRANSIT', 'DELAYED')
           AND NOT EXISTS (SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = shipments.shipment_id)`,
        [shipmentId, shipments[0].vehicle_id, shipments[0].driver_id],
      );
      if (Number((activeRows as Array<{ active_count: number }>)[0].active_count) === 0) {
        await connection.execute("UPDATE vehicles SET status = 'AVAILABLE' WHERE vehicle_id = ?", [shipments[0].vehicle_id]);
        await connection.execute("UPDATE drivers SET status = 'AVAILABLE' WHERE driver_id = ?", [shipments[0].driver_id]);
      }
    }

    await connection.commit();
    return NextResponse.json({
      success: true,
      message: "Shipment status updated",
      shipmentId,
      previousStatus: currentStatus,
      status: newStatus,
      historyRecorded: Boolean(historyId),
    });
  } catch (error) {
    if (connection) {
      try { await connection.rollback(); }
      catch { /* The connection may already have rolled back after a failed query. */ }
    }
    console.error("Failed to update shipment status:", error);

    return NextResponse.json(
      { success: false, message: "Unable to update shipment status" },
      { status: 500 }
    );
  } finally {
    connection?.release();
  }
}
