import { Bot } from 'grammy';
import {
  handleStart,
  handleHelp,
  handleDocument,
  handleText,
  handleMyQuizzes,
  handleStartQuizCommand,
  handleSendPollCommand,
  handleDeleteQuiz,
  handleStop,
  handleCallback,
  handlePollAnswer,
  handlePollClosed,
} from './handlers.js';

const bot = new Bot(process.env.BOT_TOKEN);

// ── Commands ──────────────────────────────────
bot.command('start', handleStart);
bot.command('help', handleHelp);
bot.command('myquizzes', handleMyQuizzes);
bot.command('startquiz', handleStartQuizCommand);
bot.command('sendpoll', handleSendPollCommand);
bot.command('deletequiz', handleDeleteQuiz);
bot.command('stop', handleStop);

// ── Document upload ───────────────────────────
bot.on('message:document', handleDocument);

// ── Text (state machine for quiz naming) ──────
bot.on('message:text', handleText);

// ── Inline keyboard callbacks ─────────────────
bot.on('callback_query:data', handleCallback);

// ── Poll answer (group non-anonymous polls) ───
bot.on('poll_answer', handlePollAnswer);

// ── Poll closed (timed polls expiring) ────────
bot.on('poll', handlePollClosed);

// ── Error handler ─────────────────────────────
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Error in update ${ctx?.update?.update_id}:`, err.error);
});

export { bot };
