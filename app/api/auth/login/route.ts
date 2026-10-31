import { handleLogin } from "@/lib/login-handler";

export function POST(request: Request) {
  return handleLogin(request, "any");
}
