
import { NextResponse } from "next/server";
import pool from "@/lib/mysql";
import { authorize, managerAndAdmin } from "@/lib/auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(
  request: Request,
  { params }: RouteContext
) {
  const { id } = await params;
  const alertId = Number(id);

  if (!Number.isInteger(alertId) || alertId <= 0) {
    return NextResponse.json(
      { success: false, message: "Invalid alert ID" },
      { status: 400 }
    );
  }

  let body: { resolved_by?: unknown } = {};

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (body.resolved_by !== undefined && body.resolved_by !== null) {
    if (
      typeof body.resolved_by !== "number" ||
      !Number.isInteger(body.resolved_by) ||
      body.resolved_by <= 0
    ) {
      return NextResponse.json(
        { success: false, message: "Invalid resolved_by user ID" },
        { status: 400 }
      );
    }

  }

  try {
    const access = await authorize(request, managerAndAdmin);
    if ("response" in access) return access.response;
    if (body.resolved_by !== undefined && body.resolved_by !== null && body.resolved_by !== access.user.user_id) {
      return NextResponse.json({ success: false, message: "resolved_by must match the authenticated user" }, { status: 400 });
    }
    const resolvedBy = access.user.user_id;
    const [result] = await pool.execute(
      `UPDATE alerts AS a
       SET is_resolved = 1,
           resolved_by = ?,
           resolved_at = CURRENT_TIMESTAMP
       WHERE a.alert_id = ? AND a.is_resolved = 0
         AND EXISTS (
           SELECT 1 FROM shipments AS s
           WHERE s.shipment_id = a.shipment_id AND NOT EXISTS (
             SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = s.shipment_id
           )
         )`,
      [resolvedBy, alertId]
    );

    const updateResult = result as { affectedRows: number };

    if (updateResult.affectedRows === 0) {
      const [rows] = await pool.execute(
        `SELECT a.alert_id, a.is_resolved, a.resolved_by, a.resolved_at
         FROM alerts AS a
         INNER JOIN shipments AS s ON s.shipment_id = a.shipment_id
         WHERE a.alert_id = ? AND NOT EXISTS (
           SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = s.shipment_id
         )`,
        [alertId]
      );

      const alerts = rows as Array<{
        alert_id: number;
        is_resolved: number;
        resolved_by: number | null;
        resolved_at: Date | string | null;
      }>;

      if (alerts.length === 0) {
        return NextResponse.json(
          { success: false, message: "Alert not found" },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        message: "Alert was already resolved",
        alert: alerts[0],
      });
    }

    return NextResponse.json({
      success: true,
      message: "Alert resolved successfully",
      alertId,
      resolvedBy,
    });
  } catch (error) {
    console.error("Failed to resolve alert:", error);

    return NextResponse.json(
      { success: false, message: "Unable to resolve alert" },
      { status: 500 }
    );
  }
}
