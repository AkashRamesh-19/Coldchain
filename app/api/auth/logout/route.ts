import { NextResponse } from "next/server";
import { clearSessionCookieHeader, destroySession } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    await destroySession(request);
    const response = NextResponse.json({ success: true, message: "Logged out" });
    response.headers.set("Set-Cookie", clearSessionCookieHeader());
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    console.error("Logout failed:", error);
    return NextResponse.json({ success: false, message: "Unable to log out" }, { status: 500 });
  }
}
