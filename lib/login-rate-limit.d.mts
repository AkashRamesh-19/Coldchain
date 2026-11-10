export function checkLoginRateLimit(request: Request, identifier: string): {
  allowed: boolean;
  retryAfterSeconds: number;
  recordFailure(): void;
  clearAccountBucket(): void;
};
export function resetLoginRateLimitForTests(request: Request, identifier: string): void;
