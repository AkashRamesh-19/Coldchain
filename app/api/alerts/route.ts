
import { NextResponse } from "next/server";
import pool from "@/lib/mysql";
import { authorize, shipmentAccessCondition, staffAndAbove } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const access = await authorize(request, staffAndAbove);
    if ("response" in access) return access.response;
    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? "all";
    if (!["all", "unresolved", "resolved"].includes(status)) {
      return NextResponse.json({ success: false, message: "status must be all, unresolved, or resolved" }, { status: 400 });
    }
    const shipmentIdValue = url.searchParams.get("shipmentId");
    const shipmentId = shipmentIdValue === null ? null : Number(shipmentIdValue);
    if (shipmentIdValue !== null && (!Number.isInteger(shipmentId) || Number(shipmentId) <= 0)) {
      return NextResponse.json({ success: false, message: "Invalid shipmentId" }, { status: 400 });
    }
    const scope = shipmentAccessCondition("s", access.user);
    const [rows] = await pool.query(`
      SELECT
        a.alert_id,
        a.shipment_id,
        s.shipment_code,
        a.alert_type,
        a.severity,
        a.message,
        a.sensor_value,
        a.threshold_value,
        a.is_resolved,
        a.resolved_by,
        a.resolved_at,
        a.created_at,
        s.status AS shipment_status,
        o.supplier_name,
        o.source_warehouse,
        o.destination_warehouse,
        o.route_name,
        o.vehicle_number,
        o.driver_name,
        GROUP_CONCAT(DISTINCT p.product_name ORDER BY p.product_name SEPARATOR ', ') AS products
      FROM alerts AS a
      INNER JOIN shipments AS s
        ON s.shipment_id = a.shipment_id
      INNER JOIN shipment_overview AS o ON o.shipment_id = s.shipment_id
      LEFT JOIN shipment_items AS si ON si.shipment_id = s.shipment_id
      LEFT JOIN products AS p ON p.product_id = si.product_id
      WHERE NOT EXISTS (
        SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = s.shipment_id
      )
      ${status === "all" ? "" : `AND a.is_resolved = ${status === "resolved" ? 1 : 0}`}
      ${shipmentId === null ? "" : "AND s.shipment_id = ?"}
      ${scope.sql}
      GROUP BY a.alert_id, a.shipment_id, s.shipment_code, a.alert_type, a.severity, a.message,
        a.sensor_value, a.threshold_value, a.is_resolved, a.resolved_by, a.resolved_at, a.created_at,
        s.status, o.supplier_name, o.source_warehouse, o.destination_warehouse,
        o.route_name, o.vehicle_number, o.driver_name
      ORDER BY
        a.is_resolved ASC,
        FIELD(a.severity, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'),
        a.created_at DESC
    `, [...(shipmentId === null ? [] : [shipmentId]), ...scope.params]);

    return NextResponse.json({
      success: true,
      filters: { status, shipmentId },
      count: Array.isArray(rows) ? rows.length : 0,
      alerts: rows,
    });
  } catch (error) {
    console.error("Failed to fetch alerts:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Unable to fetch alerts",
      },
      { status: 500 }
    );
  }
}
