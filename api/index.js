export default async function handler(req, res) {
    const token = process.env.BOT_TOKEN;
    const hasRedis = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
    const webhookUrl = process.env.WEBHOOK_URL;

    let botInfo = null;
    if (token) {
      try {
        const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
        botInfo = await r.json();
      } catch { botInfo = { ok: false }; }
    }

    res.status(200).json({
      bot: botInfo?.ok ? `✅ @${botInfo.result.username}` : '❌ BOT_TOKEN missing or invalid',
      redis: hasRedis ? '✅ Upstash Redis configured' : '⚠️  Not set — using in-memory (data resets on cold start)',
      webhook_url: webhookUrl || '❌ WEBHOOK_URL not set in Vercel env vars',
      setup: 'Visit /api/setup once to register the webhook with Telegram',
      env_vars_needed: [
        'BOT_TOKEN',
        'WEBHOOK_URL  →  https://<your-vercel-domain>/api/webhook',
        'UPSTASH_REDIS_REST_URL',
        'UPSTASH_REDIS_REST_TOKEN',
      ],
    });
  }
  