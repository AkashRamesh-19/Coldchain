
import { NextResponse } from "next/server";
import pool from "@/lib/mysql";

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

  let resolvedBy: number | null = null;

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

    resolvedBy = body.resolved_by;
  }

  try {
    const [result] = await pool.execute(
      `UPDATE alerts
       SET is_resolved = 1,
           resolved_by = ?,
           resolved_at = CURRENT_TIMESTAMP
       WHERE alert_id = ? AND is_resolved = 0`,
      [resolvedBy, alertId]
    );

    const updateResult = result as { affectedRows: number };

    if (updateResult.affectedRows === 0) {
      const [rows] = await pool.execute(
        `SELECT alert_id, is_resolved, resolved_by, resolved_at
         FROM alerts
         WHERE alert_id = ?`,
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
