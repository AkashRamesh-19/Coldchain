
import mysql from "mysql2/promise";

const mysqlPort = Number(process.env.MYSQL_PORT ?? 3306);

if (
  !process.env.MYSQL_HOST ||
  !process.env.MYSQL_USER ||
  !process.env.MYSQL_DATABASE
) {
  throw new Error("Missing required MySQL environment variables.");
}

if (!Number.isInteger(mysqlPort) || mysqlPort < 1 || mysqlPort > 65535) {
  throw new Error("MYSQL_PORT must be a valid port number.");
}

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: mysqlPort,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export default pool;
