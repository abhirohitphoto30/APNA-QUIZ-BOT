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
    handleFastCommand,
    handleSlowCommand,
    handleEndCommand,
    handlePauseCommand,
    handleNextCommand,
  } from './handlers.js';

  const bot = new Bot(process.env.BOT_TOKEN || 'missing-token');

  bot.command('start',      handleStart);
  bot.command('help',       handleHelp);
  bot.command('createquiz', handleCreateQuiz);
  bot.command('myquizzes',  handleMyQuizzes);
  bot.command('startquiz',  handleStartQuizCommand);
  bot.command('sendpoll',   handleSendPollCommand);
  bot.command('deletequiz', handleDeleteQuiz);
  bot.command('stop',       handleStop);

  bot.command('fast',  handleFastCommand);
  bot.command('slow',  handleSlowCommand);
  bot.command('end',   handleEndCommand);
  bot.command('pause', handlePauseCommand);
  bot.command('next',  handleNextCommand);  // last-resort: creator manually skips

  bot.on('message:document',    handleDocument);
  bot.on('message:text',        handleText);
  bot.on('callback_query:data', handleCallback);
  bot.on('poll_answer',         handlePollAnswer);
  bot.on('poll',                handlePollClosed);  // bonus: fires when Telegram sends it

  bot.catch((err) => {
    console.error('grammy error update=' + err.ctx?.update?.update_id + ':', err.error);
  });

  export { bot };
  