import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import nextEnv from "@next/env";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";

nextEnv.loadEnvConfig(process.cwd());
if (!stdin.isTTY || typeof stdin.setRawMode !== "function") throw new Error("Run this setup command in an interactive terminal.");
if (!process.env.MYSQL_HOST || !process.env.MYSQL_USER || !process.env.MYSQL_DATABASE) throw new Error("MySQL configuration is required; values are not displayed.");

async function readHidden(label) {
  stdout.write(label);
  stdin.setEncoding("utf8");
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          stdin.setRawMode(false);
          stdin.off("data", onData);
          reject(new Error("Input cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          stdin.setRawMode(false);
          stdin.off("data", onData);
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (character === "\u0008" || character === "\u007f") value = value.slice(0, -1);
        else value += character;
      }
    };
    stdin.on("data", onData);
  });
}

const prompt = createInterface({ input: stdin, output: stdout });
let name;
let email;
try {
  name = (await prompt.question("Administrator full name: ")).trim();
  email = (await prompt.question("Administrator email: ")).trim().toLowerCase();
} finally {
  prompt.close();
}
const password = await readHidden("Password (12+ characters; input hidden): ");
const confirmation = await readHidden("Confirm password: ");
if (name.length < 2 || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 200 || password !== confirmation) {
  throw new Error("Administrator details are invalid or the passwords do not match.");
}

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});
try {
  const [rows] = await connection.query("SELECT COUNT(*) AS users_count FROM users");
  if (Number(rows[0].users_count) !== 0) throw new Error("Bootstrap is allowed only when the users table is empty.");
  await connection.execute(
    "INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, 'ADMIN')",
    [name, email, await bcrypt.hash(password, 12)],
  );
  console.log("Initial administrator created. The password was not displayed or logged.");
} finally {
  await connection.end();
}
