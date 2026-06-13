import { webhookCallback } from 'grammy';
import { bot } from '../src/bot.js';

export const config = {
  api: { bodyParser: false },
};

export default webhookCallback(bot, 'std/http');
