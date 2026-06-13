/**
 * Run once to register the Telegram webhook.
 * Usage:  node --env-file=.env api/setup.js
 * Or visit: https://your-app.vercel.app/api/setup  (GET request)
 */

const token = process.env.BOT_TOKEN;
const webhookUrl = process.env.WEBHOOK_URL;

if (!token || !webhookUrl) {
  console.error('Missing BOT_TOKEN or WEBHOOK_URL in environment.');
  process.exit(1);
}

const apiUrl = `https://api.telegram.org/bot${token}`;

async function setup() {
  // Set webhook
  const setRes = await fetch(`${apiUrl}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ['message', 'callback_query', 'poll', 'poll_answer'],
      drop_pending_updates: true,
    }),
  });
  const setData = await setRes.json();
  console.log('setWebhook:', setData);

  // Set commands
  const cmds = [
    { command: 'start', description: 'Welcome message' },
    { command: 'help', description: 'How to use the bot' },
    { command: 'myquizzes', description: 'List your saved quizzes' },
    { command: 'startquiz', description: 'Start a quiz by ID' },
    { command: 'sendpoll', description: 'Send quiz as anonymous polls' },
    { command: 'deletequiz', description: 'Delete a quiz by ID' },
    { command: 'stop', description: 'Stop the current quiz' },
  ];

  const cmdRes = await fetch(`${apiUrl}/setMyCommands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commands: cmds }),
  });
  const cmdData = await cmdRes.json();
  console.log('setMyCommands:', cmdData);

  // Get webhook info
  const infoRes = await fetch(`${apiUrl}/getWebhookInfo`);
  const infoData = await infoRes.json();
  console.log('webhookInfo:', JSON.stringify(infoData, null, 2));
}

setup().catch(console.error);

// Also expose as Vercel serverless function
export default async function handler(req, res) {
  const tok = process.env.BOT_TOKEN;
  const wh = process.env.WEBHOOK_URL;
  if (!tok || !wh) {
    return res.status(500).json({ error: 'Missing BOT_TOKEN or WEBHOOK_URL' });
  }

  const setRes = await fetch(`https://api.telegram.org/bot${tok}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: wh,
      allowed_updates: ['message', 'callback_query', 'poll', 'poll_answer'],
      drop_pending_updates: true,
    }),
  });
  const data = await setRes.json();
  res.json(data);
}
