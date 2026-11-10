import { createHash } from "node:crypto";

const WINDOW_MS = 15 * 60 * 1000;
const IP_LIMIT = 60;
const ACCOUNT_LIMIT = 10;
const STORAGE_KEY = "__coldChainLoginRateLimitBuckets";

function buckets() {
  const root = globalThis;
  root[STORAGE_KEY] ??= new Map();
  return root[STORAGE_KEY];
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function getClientAddress(request) {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (!forwardedFor) return null;
  // Proxies normally append the connecting address. Use the rightmost value so
  // a client cannot bypass the bucket by prepending a spoofed address.
  return forwardedFor.split(",").at(-1)?.trim() || null;
}

function pruneExpired(store, now) {
  for (const [key, bucket] of store) {
    if (bucket.resetAt <= now) store.delete(key);
  }
}

/** @param {Request} request @param {string} identifier */
export function checkLoginRateLimit(request, identifier) {
  const store = buckets();
  const now = Date.now();
  pruneExpired(store, now);
  const accountKey = `account:${digest(identifier.trim().toLowerCase())}`;
  const clientAddress = getClientAddress(request);
  const checks = [{ key: accountKey, limit: ACCOUNT_LIMIT }];
  if (clientAddress) checks.push({ key: `ip:${digest(clientAddress)}`, limit: IP_LIMIT });
  const blocked = checks
    .map((check) => ({ ...check, bucket: store.get(check.key) }))
    .filter((check) => check.bucket?.count >= check.limit);
  if (blocked.length) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((Math.max(...blocked.map((check) => check.bucket.resetAt)) - now) / 1000)),
      recordFailure() {},
      clearAccountBucket() {},
    };
  }
  return {
    allowed: true,
    retryAfterSeconds: 0,
    recordFailure() {
      const failedAt = Date.now();
      for (const check of checks) {
        const existing = store.get(check.key);
        const bucket = existing && existing.resetAt > failedAt
          ? existing
          : { count: 0, resetAt: failedAt + WINDOW_MS };
        bucket.count += 1;
        store.set(check.key, bucket);
      }
    },
    clearAccountBucket() { store.delete(accountKey); },
  };
}

/** @param {Request} request @param {string} identifier */
export function resetLoginRateLimitForTests(request, identifier) {
  const clientAddress = getClientAddress(request);
  const store = buckets();
  store.delete(`account:${digest(identifier.trim().toLowerCase())}`);
  if (clientAddress) store.delete(`ip:${digest(clientAddress)}`);
}
