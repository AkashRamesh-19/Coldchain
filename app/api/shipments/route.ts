
import { NextResponse } from "next/server";
import pool from "@/lib/mysql";

export async function GET() {
  try {
    const [rows] = await pool.query(
      `SELECT o.* FROM shipment_overview AS o
       WHERE NOT EXISTS (
         SELECT 1 FROM non_operational_shipments AS n WHERE n.shipment_id = o.shipment_id
       )
       ORDER BY o.shipment_id DESC`
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
