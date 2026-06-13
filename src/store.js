import { Redis } from '@upstash/redis';

  let _redis = null;
  const _mem = new Map();

  function getRedis() {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
    if (!_redis) {
      _redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });
    }
    return _redis;
  }

  function memSet(key, value, ttlSeconds) {
    _mem.set(key, { v: JSON.stringify(value), exp: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
  }

  function memGet(key) {
    const e = _mem.get(key);
    if (!e) return null;
    if (e.exp && Date.now() > e.exp) { _mem.delete(key); return null; }
    try { return JSON.parse(e.v); } catch { return e.v; }
  }

  export const store = {
    async set(key, value, ttlSeconds) {
      const r = getRedis();
      if (!r) { memSet(key, value, ttlSeconds); return; }
      const s = JSON.stringify(value);
      ttlSeconds ? await r.set(key, s, { ex: ttlSeconds }) : await r.set(key, s);
    },

    async get(key) {
      const r = getRedis();
      if (!r) return memGet(key);
      const val = await r.get(key);
      if (val === null || val === undefined) return null;
      if (typeof val === 'string') { try { return JSON.parse(val); } catch { return val; } }
      return val;
    },

    async del(key) {
      const r = getRedis();
      if (!r) { _mem.delete(key); return; }
      await r.del(key);
    },

    async exists(key) {
      const r = getRedis();
      if (!r) return _mem.has(key);
      return (await r.exists(key)) === 1;
    },

    isRedisConfigured() {
      return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
    },
  };
  