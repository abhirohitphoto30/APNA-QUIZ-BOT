import { Bot } from 'grammy';
  import {
    handleStart,
    handleHelp,
    handleCreateQuiz,
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

  const bot = new Bot(process.env.BOT_TOKEN || 'missing-token');

  bot.command('start', handleStart);
  bot.command('help', handleHelp);
  bot.command('createquiz', handleCreateQuiz);
  bot.command('myquizzes', handleMyQuizzes);
  bot.command('startquiz', handleStartQuizCommand);
  bot.command('sendpoll', handleSendPollCommand);
  bot.command('deletequiz', handleDeleteQuiz);
  bot.command('stop', handleStop);

  bot.on('message:document', handleDocument);
  bot.on('message:text', handleText);
  bot.on('callback_query:data', handleCallback);
  bot.on('poll_answer', handlePollAnswer);
  bot.on('poll', handlePollClosed);

  bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`Error in update ${ctx?.update?.update_id}:`, err.error);
  });

  export { bot };
  