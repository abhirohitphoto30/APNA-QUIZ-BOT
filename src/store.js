import { Redis } from '@upstash/redis';

let _redis = null;

function getRedis() {
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return _redis;
}

export const store = {
  async set(key, value, ttlSeconds) {
    const r = getRedis();
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      await r.set(key, serialized, { ex: ttlSeconds });
    } else {
      await r.set(key, serialized);
    }
  },

  async get(key) {
    const r = getRedis();
    const val = await r.get(key);
    if (val === null || val === undefined) return null;
    if (typeof val === 'string') {
      try { return JSON.parse(val); } catch { return val; }
    }
    return val;
  },

  async del(key) {
    const r = getRedis();
    await r.del(key);
  },

  async exists(key) {
    const r = getRedis();
    return (await r.exists(key)) === 1;
  },
};
