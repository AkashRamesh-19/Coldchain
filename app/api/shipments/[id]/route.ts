
import { NextResponse } from "next/server";
import pool from "@/lib/mysql";

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

  try {
    const [existing] = await pool.execute(
      "SELECT shipment_id, status FROM shipments WHERE shipment_id = ?",
      [shipmentId]
    );

    const shipments = existing as Array<{
      shipment_id: number;
      status: string;
    }>;

    if (shipments.length === 0) {
      return NextResponse.json(
        { success: false, message: "Shipment not found" },
        { status: 404 }
      );
    }

    const currentStatus = shipments[0].status;
    const newStatus = body.status as ShipmentStatus;

    if (currentStatus === newStatus) {
      return NextResponse.json({
        success: true,
        message: "Shipment already has this status",
        shipmentId,
        status: currentStatus,
      });
    }

    await pool.execute(
      `UPDATE shipments
       SET status = ?,
           actual_delivery = CASE
             WHEN ? = 'DELIVERED' THEN COALESCE(actual_delivery, CURRENT_TIMESTAMP)
             ELSE actual_delivery
           END
       WHERE shipment_id = ?`,
      [newStatus, newStatus, shipmentId]
    );

    return NextResponse.json({
      success: true,
      message: "Shipment status updated",
      shipmentId,
      previousStatus: currentStatus,
      status: newStatus,
      history: "Status-history trigger should record the change",
    });
  } catch (error) {
    console.error("Failed to update shipment status:", error);

    return NextResponse.json(
      { success: false, message: "Unable to update shipment status" },
      { status: 500 }
    );
  }
}
