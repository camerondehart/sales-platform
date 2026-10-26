// In-memory rate limiter (per email + per IP)
// Note: Works per function instance; for low-traffic sites this is sufficient.
// For production with many concurrent invocations, consider using Vercel Edge Config or Upstash Redis.

type RateLimitRecord = {
  count: number;
  firstAttempt: number;
};

const emailAttempts = new Map<string, RateLimitRecord>();
const ipAttempts = new Map<string, RateLimitRecord>();

const MAX_ATTEMPTS = 12;          // maximum failed attempts (changed to 12)
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function isRateLimited(key: string, map: Map<string, RateLimitRecord>): boolean {
  const now = Date.now();
  const record = map.get(key);
  if (!record) return false;

  // Reset if window has passed
  if (now - record.firstAttempt > WINDOW_MS) {
    map.delete(key);
    return false;
  }

  return record.count >= MAX_ATTEMPTS;
}

function recordAttempt(key: string, map: Map<string, RateLimitRecord>): void {
  const now = Date.now();
  const record = map.get(key);
  if (!record) {
    map.set(key, { count: 1, firstAttempt: now });
  } else {
    // If window expired, reset count
    if (now - record.firstAttempt > WINDOW_MS) {
      map.set(key, { count: 1, firstAttempt: now });
    } else {
      record.count++;
      map.set(key, record);
    }
  }
}

export function checkRateLimit(email: string, ip: string): { blocked: boolean } {
  const emailBlocked = isRateLimited(email.toLowerCase(), emailAttempts);
  const ipBlocked = isRateLimited(ip, ipAttempts);
  return { blocked: emailBlocked || ipBlocked };
}

export function recordFailedAttempt(email: string, ip: string): void {
  recordAttempt(email.toLowerCase(), emailAttempts);
  recordAttempt(ip, ipAttempts);
}
