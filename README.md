# 🎯 Apna Quiz Bot

A powerful Telegram quiz bot with negative marking, time limits, anonymous polls, and detailed explanations. Designed for Vercel deployment.

## ✨ Features

- 📤 **Upload .txt quiz files** — supports 2 formats (see below)
- 🆔 **Unique quiz IDs** — share quizzes with anyone using the ID
- ❓ **Up to 300 questions** per quiz
- ➖ **Negative marking** — 0, -0.25, -0.33, -0.5, or -1 per wrong answer
- ⏱️ **Time limits** — 10s, 20s, 30s, 40s, 50s, 1m, 1.5m, 2m, 3m, 5m
- 📊 **Anonymous polls** — broadcast quiz to any group/channel
- 📖 **Explanations** — shown after every question
- 🏆 **Leaderboard** — group quiz final results with rankings
- 🔒 **Per-user scoring** in groups (non-anonymous)
- ⚡ **Private chat** — next question appears instantly after answering
- ⏳ **Group chat** — waits for timer before next question

---

## 📁 Supported .txt Formats

### Format 1 — Emoji separator (😂)

```
Q1.What is the capital of India?
😂
New Delhi ✅
Mumbai
Kolkata
Chennai
Ex: New Delhi became the capital of India in 1911.

Q2.Which article abolishes untouchability?
1. Article 15
2. Article 17
3. Article 19
😂
Article 15
Article 17 ✅
Article 19
Article 21
Ex: Article 17 of the Indian Constitution abolishes untouchability.
```

### Format 2 — Inline numbered statements (Q.1) style)

```
Q.1) Which of these is correct? 1️⃣ Earth revolves around Sun 2️⃣ Sun revolves around Earth
1️⃣ only ✅
2️⃣ only
Both
Neither
Ex: The Earth revolves around the Sun, not the other way around.
```

**Rules:**
- Correct answer is marked with ✅
- Explanation starts with `Ex:`
- Each question separated by a blank line
- Up to 4 options per question

---

## 🚀 Setup & Deployment

### Step 1 — Create a Telegram Bot

1. Open [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow instructions
3. Copy your **Bot Token**

### Step 2 — Create Upstash Redis (free)

1. Go to [upstash.com](https://upstash.com) → Create a free Redis database
2. Copy **REST URL** and **REST TOKEN**

### Step 3 — Deploy to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → Import the repo
3. Add these environment variables:
   ```
   BOT_TOKEN=your_telegram_bot_token
   UPSTASH_REDIS_REST_URL=https://...upstash.io
   UPSTASH_REDIS_REST_TOKEN=your_token
   WEBHOOK_URL=https://your-app.vercel.app/api/webhook
   ```
4. Deploy!

### Step 4 — Register Webhook

After deploying, visit this URL once in your browser:

```
https://your-app.vercel.app/api/setup
```

Your bot is now live! 🎉

---

## 📲 Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/help` | Detailed usage guide |
| `/myquizzes` | List your saved quizzes |
| `/startquiz QUIZ_XXXXX` | Start interactive quiz |
| `/sendpoll QUIZ_XXXXX` | Broadcast as anonymous polls |
| `/deletequiz QUIZ_XXXXX` | Delete a quiz |
| `/stop` | Stop current quiz in this chat |

---

## 🎮 How to Play

### Private Chat (1-on-1 with bot)
1. Send a .txt file → bot parses and saves quiz
2. Configure negative marking and time limit
3. Press **Start Quiz** — answer using buttons
4. See result + explanation instantly, next question comes right away

### Group / Channel
1. Add bot to your group (give it admin rights)
2. Use `/startquiz QUIZ_XXXXX` or `/sendpoll QUIZ_XXXXX`
3. **Interactive mode**: timed polls sent one by one; bot waits for timer, then sends explanation + next question
4. **Poll mode**: all questions sent as anonymous Telegram quiz polls at once

---

## 📦 Tech Stack

- **[grammY](https://grammy.dev/)** — Telegram bot framework
- **[@upstash/redis](https://upstash.com/)** — Serverless Redis for storage
- **Vercel** — Serverless deployment (Node.js)

---

## 🌐 Environment Variables

| Variable | Description |
|----------|-------------|
| `BOT_TOKEN` | Telegram bot token from @BotFather |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis token |
| `WEBHOOK_URL` | Your Vercel deployment URL + `/api/webhook` |
