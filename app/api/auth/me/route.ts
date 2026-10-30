import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ success: false, message: "Authentication required" }, { status: 401 });
    const response = NextResponse.json({ success: true, user });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    console.error("Session lookup failed:", error);
    return NextResponse.json({ success: false, message: "Unable to read session" }, { status: 500 });
  }
}
