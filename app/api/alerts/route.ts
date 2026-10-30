
import { NextResponse } from "next/server";
import pool from "@/lib/mysql";
import { authorize, shipmentAccessCondition, staffAndAbove } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const access = await authorize(request, staffAndAbove);
    if ("response" in access) return access.response;
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
        a.created_at
      FROM alerts AS a
      INNER JOIN shipments AS s
        ON s.shipment_id = a.shipment_id
      WHERE NOT EXISTS (
        SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = s.shipment_id
      )
      ${scope.sql}
      ORDER BY
        a.is_resolved ASC,
        FIELD(a.severity, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'),
        a.created_at DESC
    `, scope.params);

    return NextResponse.json({
      success: true,
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
