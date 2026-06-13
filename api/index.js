export default async function handler(req, res) {
    const token = process.env.BOT_TOKEN;
    const hasRedis = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const webhookUrl = process.env.WEBHOOK_URL || `https://${host}/api/webhook`;

    let botInfo = null;
    if (token) {
      try {
        const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
        botInfo = await r.json();
      } catch { botInfo = { ok: false }; }
    }

    res.status(200).json({
      bot: botInfo?.ok ? `✅ @${botInfo.result.username}` : '❌ BOT_TOKEN missing or invalid',
      redis: hasRedis ? '✅ Upstash Redis configured' : '⚠️ Not set — using in-memory (data resets on cold start)',
      webhook_url: webhookUrl,
      next_step: 'Visit /api/setup to register webhook with Telegram',
      env_vars_needed: [
        'BOT_TOKEN  ← required',
        'UPSTASH_REDIS_REST_URL  ← recommended',
        'UPSTASH_REDIS_REST_TOKEN  ← recommended',
        'WEBHOOK_URL  ← optional (auto-detected from domain)',
      ],
    });
  }
  