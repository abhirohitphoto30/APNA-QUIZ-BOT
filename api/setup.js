/**
   * Visit: https://your-app.vercel.app/api/setup  (GET request) to register webhook
   */
  export default async function handler(req, res) {
    const tok = process.env.BOT_TOKEN;
    const wh = process.env.WEBHOOK_URL;

    if (!tok || !wh) {
      return res.status(500).json({
        error: 'Missing BOT_TOKEN or WEBHOOK_URL env vars in Vercel dashboard'
      });
    }

    try {
      const setRes = await fetch(`https://api.telegram.org/bot${tok}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: wh,
          allowed_updates: ['message', 'callback_query', 'poll', 'poll_answer'],
          drop_pending_updates: true,
        }),
      });
      const setData = await setRes.json();

      const cmds = [
        { command: 'start', description: 'Welcome message' },
        { command: 'help', description: 'How to use the bot' },
        { command: 'myquizzes', description: 'List your saved quizzes' },
        { command: 'startquiz', description: 'Start a quiz by ID' },
        { command: 'sendpoll', description: 'Send quiz as anonymous polls' },
        { command: 'deletequiz', description: 'Delete a quiz by ID' },
        { command: 'stop', description: 'Stop the current quiz' },
      ];
      const cmdRes = await fetch(`https://api.telegram.org/bot${tok}/setMyCommands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commands: cmds }),
      });
      const cmdData = await cmdRes.json();

      const infoRes = await fetch(`https://api.telegram.org/bot${tok}/getWebhookInfo`);
      const infoData = await infoRes.json();

      res.status(200).json({
        setWebhook: setData,
        setCommands: cmdData,
        webhookInfo: infoData,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
  