
import { NextResponse } from "next/server";
import pool from "@/lib/mysql";

export async function GET() {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM shipment_overview ORDER BY shipment_id DESC"
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
