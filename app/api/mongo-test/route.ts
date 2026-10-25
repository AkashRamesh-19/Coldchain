
import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

export async function GET() {
  try {
    const client = await clientPromise;
    const databaseName = process.env.MONGODB_DATABASE;

    if (!databaseName) {
      throw new Error("Missing MONGODB_DATABASE configuration.");
    }

    const db = client.db(databaseName);

    const collections = await db
      .listCollections({}, { nameOnly: true })
      .toArray();

    const sensorCount = await db
      .collection("sensor_readings")
      .countDocuments();

    return NextResponse.json({
      success: true,
      message: "MongoDB connection successful",
      database: databaseName,
      collections: collections.map((collection) => collection.name),
      sensorReadingCount: sensorCount,
    });
  } catch (error) {
    console.error("MongoDB test failed:", error);

    return NextResponse.json(
      { success: false, message: "MongoDB connection failed" },
      { status: 500 }
    );
  }
}
