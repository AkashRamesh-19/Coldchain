import nextEnv from "@next/env";
import { MongoClient } from "mongodb";

nextEnv.loadEnvConfig(process.cwd());
if (!process.env.MONGODB_URI || !process.env.MONGODB_DATABASE) {
  throw new Error("MongoDB configuration is required; values are intentionally not displayed.");
}

const client = new MongoClient(process.env.MONGODB_URI);
try {
  await client.connect();
  const db = client.db(process.env.MONGODB_DATABASE);
  const operational = await db.collection("sensor_readings").createIndex(
    { shipment_id: 1, timestamp: 1 },
    { name: "idx_sensor_readings_shipment_timestamp" },
  );
  const research = await db.collection("research_strawberry_windows").createIndex(
    { dataset_revision: 1, shipment_id: 1, Time: 1 },
    { unique: true, name: "uq_research_revision_shipment_time" },
  );
  const sessions = db.collection("user_sessions");
  await sessions.createIndex({ token_hash: 1 }, { unique: true, name: "uq_user_sessions_token_hash" });
  await sessions.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0, name: "ttl_user_sessions_expiry" });
  console.log(JSON.stringify({ success: true, indexes: [operational, research, "uq_user_sessions_token_hash", "ttl_user_sessions_expiry"] }));
} catch (error) {
  console.error(`MongoDB setup failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
} finally {
  await client.close();
}
