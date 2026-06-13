import { bot } from '../src/bot.js';
  import { store } from '../src/store.js';
  import {
    getSess, delSess,
    sendExplanation, sendQ, sendReport,
    wait,
  } from '../src/handlers.js';

  export default async function handler(req, res) {
    res.status(200).json({ ok: true });
    if (req.method !== 'POST') return;

    const { chatId, sessionId, questionIndex } = req.body || {};
    if (!chatId || !sessionId || questionIndex === undefined) {
      console.log('[advance] missing params');
      return;
    }
    console.log('[advance] chatId=' + chatId + ' sid=' + sessionId + ' q=' + questionIndex);

    try {
      const lockKey = 'adv:' + sessionId + ':' + questionIndex;
      const locked = await store.get(lockKey);
      if (locked) {
        console.log('[advance] already handled, skipping');
        return;
      }
      await store.set(lockKey, 1, 120);

      const sess = await getSess(chatId);
      if (!sess || sess.sessionId !== sessionId) {
        console.log('[advance] session not found or changed');
        return;
      }
      if (sess.currentIndex > questionIndex + 1) {
        console.log('[advance] already past q=' + questionIndex);
        return;
      }

      const quiz = await store.get('sqz:' + sessionId) || await store.get('quiz:' + sess.quizId);
      if (!quiz) { console.log('[advance] quiz not found'); return; }

      const q = quiz.questions[questionIndex];

      await sendExplanation(bot.api, chatId, q);
      await wait(600);

      if (sess.currentIndex >= quiz.questions.length) {
        await sendReport(bot.api, sess, quiz, false);
        await delSess(chatId);
        await store.del('sqz:' + sessionId);
        console.log('[advance] quiz done chatId=' + chatId);
      } else {
        console.log('[advance] next q=' + (sess.currentIndex + 1));
        await sendQ(bot.api, sess, quiz);
      }
    } catch (err) {
      console.error('[advance] error:', err.message);
    }
  }
  