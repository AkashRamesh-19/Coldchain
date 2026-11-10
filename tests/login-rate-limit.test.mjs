import assert from "node:assert/strict";
import test from "node:test";
import { checkLoginRateLimit, resetLoginRateLimitForTests } from "../lib/login-rate-limit.mjs";

test("login limiter blocks repeated failures by account and clears the account bucket on success", () => {
  const request = new Request("http://localhost/api/auth/login", { headers: { "x-real-ip": "192.0.2.10" } });
  resetLoginRateLimitForTests(request, "person@example.com");
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const check = checkLoginRateLimit(request, "person@example.com");
    assert.equal(check.allowed, true);
    check.recordFailure();
  }
  const blocked = checkLoginRateLimit(request, "person@example.com");
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
  resetLoginRateLimitForTests(request, "person@example.com");
  assert.equal(checkLoginRateLimit(request, "person@example.com").allowed, true);
});

test("login limiter also caps attempts from one client across different accounts", () => {
  const request = new Request("http://localhost/api/auth/login", { headers: { "x-real-ip": "192.0.2.11" } });
  resetLoginRateLimitForTests(request, "account-0@example.com");
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const identifier = `account-${attempt}@example.com`;
    const check = checkLoginRateLimit(request, identifier);
    assert.equal(check.allowed, true);
    check.recordFailure();
  }
  assert.equal(checkLoginRateLimit(request, "new-account@example.com").allowed, false);
});
