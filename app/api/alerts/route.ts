
import { NextResponse } from "next/server";
import pool from "@/lib/mysql";

export async function GET() {
  try {
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
      ORDER BY
        a.is_resolved ASC,
        FIELD(a.severity, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'),
        a.created_at DESC
    `);

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
