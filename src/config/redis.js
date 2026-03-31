/**
 * Redis client configuration.
 * Used for: session caching, rate limiting counters, and (Phase 3)
 * live game state for multiplayer.
 *
 * Timeline ref: Section 2.2 — "Redis for sessions/caching"
 * Architecture ref: Redis Cache service
 */

let redis = null;
let connected = false;

/**
 * Get or create the Redis client singleton.
 * Falls back gracefully if Redis is unavailable — the app still works,
 * just without caching benefits.
 */
function getRedisClient() {
  if (redis) return redis;

  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    console.warn("[Redis] REDIS_URL not set — running without Redis cache");
    return null;
  }

  // Dynamic import — Redis is optional for development
  try {
    const Redis = require("ioredis");

    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) {
          console.warn("[Redis] Max retries reached — giving up");
          return null; // stop retrying
        }
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
    });

    redis.on("connect", () => {
      connected = true;
      console.log("[Redis] Connected");
    });

    redis.on("error", (err) => {
      connected = false;
      console.warn("[Redis] Error:", err.message);
    });

    redis.on("close", () => {
      connected = false;
    });

    // Attempt connection
    redis.connect().catch(() => {
      console.warn("[Redis] Initial connection failed — app continues without cache");
    });

    return redis;
  } catch (err) {
    console.warn("[Redis] ioredis not installed — running without Redis");
    return null;
  }
}

/**
 * Cache wrapper — get a value, or compute and cache it.
 * Falls back to just computing if Redis is unavailable.
 */
async function cacheGet(key, computeFn, ttlSeconds = 300) {
  const client = getRedisClient();

  if (client && connected) {
    try {
      const cached = await client.get(key);
      if (cached) return JSON.parse(cached);
    } catch {
      // Redis read failed — fall through to compute
    }
  }

  const value = await computeFn();

  if (client && connected && value !== undefined) {
    try {
      await client.setex(key, ttlSeconds, JSON.stringify(value));
    } catch {
      // Redis write failed — value still returned
    }
  }

  return value;
}

/**
 * Cache invalidation.
 */
async function cacheDelete(key) {
  const client = getRedisClient();
  if (client && connected) {
    try {
      await client.del(key);
    } catch {
      // ignore
    }
  }
}

/**
 * Cache invalidation by pattern (e.g. "bottle:*").
 */
async function cacheDeletePattern(pattern) {
  const client = getRedisClient();
  if (client && connected) {
    try {
      const keys = await client.keys(pattern);
      if (keys.length > 0) {
        await client.del(...keys);
      }
    } catch {
      // ignore
    }
  }
}

/**
 * Check if Redis is available.
 */
function isRedisConnected() {
  return connected;
}

module.exports = {
  getRedisClient,
  cacheGet,
  cacheDelete,
  cacheDeletePattern,
  isRedisConnected,
};
