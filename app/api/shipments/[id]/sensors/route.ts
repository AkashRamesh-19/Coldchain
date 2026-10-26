
import { NextResponse } from "next/server";
import pool from "@/lib/mysql";
import clientPromise from "@/lib/mongodb";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(
  _request: Request,
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

  try {
    const [shipmentRows] = await pool.execute(
      `SELECT s.shipment_id FROM shipments AS s
       WHERE s.shipment_id = ? AND NOT EXISTS (
         SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = s.shipment_id
       )`,
      [shipmentId],
    );
    if ((shipmentRows as Array<{ shipment_id: number }>).length === 0) {
      return NextResponse.json({ success: false, message: "Operational shipment not found" }, { status: 404 });
    }

    const client = await clientPromise;
    const databaseName = process.env.MONGODB_DATABASE;

    if (!databaseName) {
      throw new Error("Missing MONGODB_DATABASE configuration.");
    }

    const db = client.db(databaseName);

    const readings = await db
      .collection("sensor_readings")
      .find({ shipment_id: shipmentId })
      .sort({ timestamp: 1 })
      .toArray();

    return NextResponse.json({
      success: true,
      shipmentId,
      count: readings.length,
      readings,
    });
  } catch (error) {
    console.error("Failed to fetch sensor readings:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Unable to fetch sensor readings",
      },
      { status: 500 }
    );
  }
}
