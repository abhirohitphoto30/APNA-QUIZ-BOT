export default async function handler(req, res) {
    const tok = process.env.BOT_TOKEN;
    if (!tok) {
      return res.status(500).json({
        error: '❌ BOT_TOKEN not set',
        fix: 'Add BOT_TOKEN in Vercel Dashboard → Settings → Environment Variables',
      });
    }

    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const wh   = process.env.WEBHOOK_URL || `https://${host}/api/webhook`;

    try {
      const setRes  = await fetch(`https://api.telegram.org/bot${tok}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: wh,
          allowed_updates: ['message','callback_query','poll','poll_answer'],
          drop_pending_updates: true,
        }),
      });
      const setData = await setRes.json();

      const cmds = [
        { command:'start',      description:'Welcome message' },
        { command:'help',       description:'How to use the bot' },
        { command:'createquiz', description:'Create a new quiz (format guide)' },
        { command:'myquizzes',  description:'List your saved quizzes' },
        { command:'startquiz',  description:'Start a quiz by ID' },
        { command:'sendpoll',   description:'Send quiz as anonymous polls' },
        { command:'deletequiz', description:'Delete a quiz by ID' },
        // Mid-quiz commands
        { command:'fast',  description:'⚡ Add 10s to current quiz timer' },
        { command:'slow',  description:'🐢 Subtract 10s from current quiz timer' },
        { command:'pause', description:'⏸️ Pause the running quiz' },
        { command:'end',   description:'🏁 End quiz and see final report' },
      ];
      const cmdRes  = await fetch(`https://api.telegram.org/bot${tok}/setMyCommands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commands: cmds }),
      });
      const cmdData = await cmdRes.json();

      const infoRes  = await fetch(`https://api.telegram.org/bot${tok}/getWebhookInfo`);
      const infoData = await infoRes.json();

      res.status(200).json({
        status: setData.ok ? '✅ Webhook registered successfully!' : '❌ Webhook registration failed',
        webhook_url_used: wh,
        setWebhook: setData,
        setCommands: cmdData,
        webhookInfo: infoData,
      });
    } catch(err) {
      res.status(500).json({ error: err.message });
    }
  }
  