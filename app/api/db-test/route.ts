import { NextResponse } from "next/server";
import pool from "@/lib/mysql";

export async function GET() {
  try {
    const [rows] = await pool.query(
      `SELECT DATABASE() AS database_name,
              COUNT(*) AS table_count
       FROM information_schema.tables
       WHERE table_schema = DATABASE()`
    );

    return NextResponse.json({
      success: true,
      message: "MySQL connection successful",
      result: rows,
    });
  } catch (error) {
    console.error("MySQL test failed:", error);

    return NextResponse.json(
      { success: false, message: "MySQL connection failed" },
      { status: 500 }
    );
  }
}