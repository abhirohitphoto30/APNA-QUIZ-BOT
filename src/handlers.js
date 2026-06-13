import { InlineKeyboard } from 'grammy';
  import { parseQuizText } from './parser.js';
  import { store } from './store.js';
  import { nanoid } from 'nanoid';

  const TL_LABELS = {
    10: '10s', 20: '20s', 30: '30s', 40: '40s',
    50: '50s', 60: '1m', 90: '1.5m', 120: '2m',
    180: '3m', 300: '5m',
  };
  const NM_OPTIONS = [0, 0.25, 0.33, 0.5, 1];

  function generateQuizId() {
    return 'QUIZ_' + nanoid(6).toUpperCase().replace(/[^A-Z0-9]/g, 'X');
  }

  async function getUserSettings(userId) {
    const s = await store.get(`settings:${userId}`);
    return s || { negativeMarking: 0, timeLimit: 30 };
  }

  async function getSession(chatId) {
    return store.get(`session:${chatId}`);
  }

  async function saveSession(chatId, session) {
    return store.set(`session:${chatId}`, session, 7200);
  }

  async function deleteSession(chatId) {
    const sess = await getSession(chatId);
    if (sess?.currentPollId) await store.del(`poll:${sess.currentPollId}`);
    await store.del(`session:${chatId}`);
  }

  function scoreText(score, total) {
    const safe = Math.max(0, score);
    const pct = total > 0 ? Math.round((safe / total) * 100) : 0;
    const grade = pct >= 90 ? '🏆 Excellent!' : pct >= 70 ? '🥇 Good!' : pct >= 50 ? '✅ Pass' : '❌ Needs work';
    return `*Score: ${safe}/${total}* (${pct}%) ${grade}`;
  }

  function truncate(text, max) {
    if (!text) return '';
    return text.length <= max ? text : text.slice(0, max - 1) + '…';
  }

  function safePollQuestion(text) { return truncate(text, 300); }
  function safePollOption(text)   { return truncate(text, 100); }

  // ─────────────────────────────────────────────
  // Build the "answered" version of a question message
  // Shows each option with correct/wrong/selected markers
  // ─────────────────────────────────────────────
  function buildAnsweredMessage(q, selectedIdx, num, total, scoreStr) {
    let text = `❓ *Q${num}/${total}*\n\n${q.question}\n\n`;

    q.options.forEach((opt, i) => {
      const isCorrect  = i === q.correctIndex;
      const isSelected = i === selectedIdx;

      if (isSelected && isCorrect) {
        text += `✅ *${opt}* ← Your answer ✓\n`;
      } else if (isSelected && !isCorrect) {
        text += `❌ *${opt}* ← Your answer ✗\n`;
      } else if (isCorrect) {
        text += `☑️ *${opt}* ← Correct answer\n`;
      } else {
        text += `▫️ ${opt}\n`;
      }
    });

    text += `\n${scoreStr}`;
    return text;
  }

  // ─────────────────────────────────────────────
  // /start
  // ─────────────────────────────────────────────
  export async function handleStart(ctx) {
    const name = ctx.from.first_name || 'there';
    await ctx.reply(
      `👋 *Hello, ${name}!*\n\nWelcome to *Apna Quiz Bot* 🎯\n\n` +
      `📝 /createquiz — create a new quiz\n` +
      `📤 *Send a .txt file* — upload quiz questions\n` +
      `📋 /myquizzes — see your saved quizzes\n` +
      `▶️ /startquiz <ID> — start a quiz\n` +
      `📊 /sendpoll <ID> — send as anonymous polls\n` +
      `ℹ️ /help — detailed help\n\n` +
      `${store.isRedisConfigured() ? '✅ Persistent storage active.' : '⚠️ Storage: in-memory (set up Upstash Redis for persistence)'}`,
      { parse_mode: 'Markdown' }
    );
  }

  // ─────────────────────────────────────────────
  // /help
  // ─────────────────────────────────────────────
  export async function handleHelp(ctx) {
    await ctx.reply(
      `📖 *How to use Apna Quiz Bot*\n\n` +
      `*Create a Quiz:*\n` +
      `• /createquiz — format guide\n` +
      `• Or just send a .txt file directly\n\n` +
      `*Play:*\n` +
      `• In *private chat*: tap an option → question updates to show correct/wrong → explanation → next question\n` +
      `• In *groups*: timed poll → explanation after timer → next question\n\n` +
      `*Commands:*\n` +
      `/createquiz | /myquizzes | /startquiz <ID>\n` +
      `/sendpoll <ID> | /deletequiz <ID> | /stop\n\n` +
      `*Features:* ✅ Negative marking | ⏱️ 10s–5min | 📊 Leaderboard | 🔢 Up to 300 questions`,
      { parse_mode: 'Markdown' }
    );
  }

  // ─────────────────────────────────────────────
  // /createquiz
  // ─────────────────────────────────────────────
  export async function handleCreateQuiz(ctx) {
    await ctx.reply(
      `📝 *Create a New Quiz*\n\n` +
      `*How it works:*\n1️⃣ Prepare questions in a .txt file\n2️⃣ Send the file to this bot\n3️⃣ Give your quiz a name\n4️⃣ Play or share the Quiz ID!\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📋 *Format 1 — Standard (Q.1) style)*\n` +
      `\`\`\`\nQ.1) Which planet is closest to the Sun?\nVenus\nMercury ✅\nMars\nEarth\nEx: Mercury is the closest planet.\n\`\`\`\n\n` +
      `📋 *Format 2 — With 😂 separator*\n` +
      `\`\`\`\nQ1.Consider the following statements:\n1. Statement one\n😂\nOnly one ✅\nOnly two\nAll three\nNone\nEx: Explanation.\n\`\`\`\n\n` +
      `📌 *Rules:* Mark correct answer with ✅ | Start explanation with \`Ex:\` | Max 300 questions\n\n` +
      `👆 *Now send your .txt file!*`,
      { parse_mode: 'Markdown' }
    );
  }

  // ─────────────────────────────────────────────
  // DOCUMENT UPLOAD
  // ─────────────────────────────────────────────
  export async function handleDocument(ctx) {
    const doc = ctx.message.document;
    if (!doc.file_name?.toLowerCase().endsWith('.txt')) {
      return ctx.reply('❌ Please send a *.txt* file.', { parse_mode: 'Markdown' });
    }
    if (doc.file_size > 5 * 1024 * 1024) return ctx.reply('❌ File too large (max 5 MB).');

    const msg = await ctx.reply('⏳ Parsing quiz file…');
    try {
      const file = await ctx.getFile();
      const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('Download failed');
      const text = await resp.text();
      const questions = parseQuizText(text);

      if (questions.length === 0) {
        return ctx.api.editMessageText(ctx.chat.id, msg.message_id,
          '❌ No valid questions found. Check your file format.\n\nUse /createquiz to see supported formats.');
      }
      if (questions.length > 300) {
        return ctx.api.editMessageText(ctx.chat.id, msg.message_id,
          `❌ Too many questions (${questions.length}). Max 300 per quiz.`);
      }

      await store.set(`pending:${ctx.from.id}`, { questions }, 600);
      await store.set(`state:${ctx.from.id}`, { action: 'awaiting_quiz_name' }, 600);

      await ctx.api.editMessageText(ctx.chat.id, msg.message_id,
        `✅ Found *${questions.length} question${questions.length > 1 ? 's' : ''}!*\n\n` +
        `Preview — Q1: _${truncate(questions[0].question, 120)}_\n\n📝 *Send me a name for this quiz:*`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      console.error('handleDocument error:', err);
      await ctx.api.editMessageText(ctx.chat.id, msg.message_id,
        '❌ Error reading file. Make sure it is a valid .txt quiz file.'
      ).catch(() => {});
    }
  }

  // ─────────────────────────────────────────────
  // TEXT — state machine
  // ─────────────────────────────────────────────
  export async function handleText(ctx) {
    const state = await store.get(`state:${ctx.from.id}`);
    if (!state) return;

    if (state.action === 'awaiting_quiz_name') {
      const name = ctx.message.text.trim().slice(0, 100);
      const pending = await store.get(`pending:${ctx.from.id}`);
      if (!pending) return ctx.reply('⏰ Session expired. Please upload the file again.');

      const quizId = generateQuizId();
      const quiz = { id: quizId, name, questions: pending.questions, createdBy: ctx.from.id, createdAt: Date.now() };
      await store.set(`quiz:${quizId}`, quiz);

      const list = (await store.get(`quizzes:${ctx.from.id}`)) || [];
      list.unshift({ id: quizId, name, count: pending.questions.length, createdAt: Date.now() });
      if (list.length > 50) list.pop();
      await store.set(`quizzes:${ctx.from.id}`, list);
      await store.del(`pending:${ctx.from.id}`);
      await store.del(`state:${ctx.from.id}`);

      const kb = new InlineKeyboard()
        .text('▶️ Start Quiz', `confirmstart:${quizId}:0`)
        .text('📊 Send as Polls', `sendpoll:${quizId}:0`);

      await ctx.reply(
        `🎉 *Quiz saved!*\n\n📚 *${name}*\n🆔 ID: \`${quizId}\`\n❓ Questions: *${pending.questions.length}*\n\n_Share this ID with others to let them play!_`,
        { parse_mode: 'Markdown', reply_markup: kb }
      );
    }
  }

  // ─────────────────────────────────────────────
  // /myquizzes
  // ─────────────────────────────────────────────
  export async function handleMyQuizzes(ctx) {
    const list = (await store.get(`quizzes:${ctx.from.id}`)) || [];
    if (list.length === 0) return ctx.reply('📭 No quizzes yet.\n\nUse /createquiz to see the format!');
    let text = `📚 *Your Quizzes (${list.length})*\n\n`;
    const kb = new InlineKeyboard();
    for (const q of list.slice(0, 10)) {
      const date = new Date(q.createdAt).toLocaleDateString('en-IN');
      text += `📝 *${q.name}*\n🆔 \`${q.id}\` • ❓ ${q.count} Qs • 📅 ${date}\n\n`;
      kb.text(`▶️ ${q.name.slice(0, 25)}`, `showsettings:${q.id}`).row();
    }
    if (list.length > 10) text += `_…and ${list.length - 10} more_\n`;
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
  }

  export async function handleStartQuizCommand(ctx) {
    const parts = (ctx.message?.text || '').trim().split(/\s+/);
    const quizId = parts[1]?.toUpperCase();
    if (!quizId) return ctx.reply('Usage: /startquiz QUIZ_XXXXXX');
    await showSettingsMenu(ctx, quizId);
  }

  export async function handleSendPollCommand(ctx) {
    const parts = (ctx.message?.text || '').trim().split(/\s+/);
    const quizId = parts[1]?.toUpperCase();
    if (!quizId) return ctx.reply('Usage: /sendpoll QUIZ_XXXXXX');
    const quiz = await store.get(`quiz:${quizId}`);
    if (!quiz) return ctx.reply(`❌ Quiz not found: ${quizId}`);
    await startAnonymousPolls(ctx, quiz);
  }

  export async function handleDeleteQuiz(ctx) {
    const parts = (ctx.message?.text || '').trim().split(/\s+/);
    const quizId = parts[1]?.toUpperCase();
    if (!quizId) return ctx.reply('Usage: /deletequiz QUIZ_XXXXXX');
    const quiz = await store.get(`quiz:${quizId}`);
    if (!quiz) return ctx.reply(`❌ Quiz not found: ${quizId}`);
    if (quiz.createdBy !== ctx.from.id) return ctx.reply('❌ You can only delete your own quizzes.');
    await store.del(`quiz:${quizId}`);
    const list = ((await store.get(`quizzes:${ctx.from.id}`)) || []).filter(q => q.id !== quizId);
    await store.set(`quizzes:${ctx.from.id}`, list);
    await ctx.reply(`🗑️ Quiz *${quiz.name}* (\`${quizId}\`) deleted.`, { parse_mode: 'Markdown' });
  }

  export async function handleStop(ctx) {
    const sess = await getSession(ctx.chat.id);
    if (!sess) return ctx.reply('No active quiz in this chat.');
    await deleteSession(ctx.chat.id);
    await ctx.reply('🛑 Quiz stopped.');
  }

  // ─────────────────────────────────────────────
  // SETTINGS MENU
  // ─────────────────────────────────────────────
  export async function showSettingsMenu(ctx, quizId, editMsgId) {
    const quiz = await store.get(`quiz:${quizId}`);
    if (!quiz) {
      const msg = '❌ Quiz not found: ' + quizId;
      return editMsgId
        ? ctx.api.editMessageText(ctx.chat.id, editMsgId, msg).catch(() => ctx.reply(msg))
        : ctx.reply(msg);
    }
    const settings = await getUserSettings(ctx.from.id);
    const kb = new InlineKeyboard();

    kb.text('— Negative Marking —', 'noop').row();
    for (const nm of NM_OPTIONS) {
      const label = nm === 0 ? 'None' : `-${nm}`;
      kb.text(settings.negativeMarking === nm ? `✅ ${label}` : label, `setnm:${quizId}:${nm}`);
    }
    kb.row();
    kb.text('— Time Limit —', 'noop').row();
    for (const tl of [10, 20, 30, 40, 50, 60]) {
      kb.text(settings.timeLimit === tl ? `✅ ${TL_LABELS[tl]}` : TL_LABELS[tl], `settl:${quizId}:${tl}`);
    }
    kb.row();
    for (const tl of [90, 120, 180, 300]) {
      kb.text(settings.timeLimit === tl ? `✅ ${TL_LABELS[tl]}` : TL_LABELS[tl], `settl:${quizId}:${tl}`);
    }
    kb.row();
    kb.text('▶️ Start Interactive Quiz', `confirmstart:${quizId}:0`).row();
    kb.text('📊 Broadcast Anonymous Polls', `sendpoll:${quizId}:0`).row();

    const nmText = settings.negativeMarking === 0 ? 'None' : `-${settings.negativeMarking}`;
    const text =
      `📚 *${quiz.name}*\n❓ ${quiz.questions.length} questions\n\n` +
      `⚙️ *Settings*\n➖ Negative Marking: *${nmText}* per wrong\n` +
      `⏱️ Time Limit: *${TL_LABELS[settings.timeLimit]}* per question\n\n_Choose mode below:_`;

    const opts = { parse_mode: 'Markdown', reply_markup: kb };
    if (editMsgId) {
      await ctx.api.editMessageText(ctx.chat.id, editMsgId, text, opts).catch(() => ctx.reply(text, opts));
    } else {
      await ctx.reply(text, opts);
    }
  }

  // ─────────────────────────────────────────────
  // CALLBACK QUERIES
  // ─────────────────────────────────────────────
  export async function handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery().catch(() => {});
    if (data === 'noop') return;

    if (data.startsWith('setnm:')) {
      const [, quizId, nmStr] = data.split(':');
      const s = await getUserSettings(ctx.from.id);
      s.negativeMarking = parseFloat(nmStr);
      await store.set(`settings:${ctx.from.id}`, s);
      return showSettingsMenu(ctx, quizId, ctx.callbackQuery.message.message_id);
    }
    if (data.startsWith('settl:')) {
      const [, quizId, tlStr] = data.split(':');
      const s = await getUserSettings(ctx.from.id);
      s.timeLimit = parseInt(tlStr, 10);
      await store.set(`settings:${ctx.from.id}`, s);
      return showSettingsMenu(ctx, quizId, ctx.callbackQuery.message.message_id);
    }
    if (data.startsWith('showsettings:')) {
      return showSettingsMenu(ctx, data.split(':')[1], ctx.callbackQuery.message.message_id);
    }
    if (data.startsWith('confirmstart:')) {
      const parts = data.split(':');
      return startInteractiveQuiz(ctx, parts[1], parseInt(parts[2] || '0', 10));
    }
    if (data.startsWith('sendpoll:')) {
      const quizId = data.split(':')[1];
      const quiz = await store.get(`quiz:${quizId}`);
      if (!quiz) return ctx.reply('❌ Quiz not found: ' + quizId);
      return startAnonymousPolls(ctx, quiz);
    }
    if (data.startsWith('ans:')) {
      // ans:sessionId:optionIdx:msgId
      const parts = data.split(':');
      const sessionId = parts[1];
      const optIdx    = parseInt(parts[2], 10);
      const msgId     = parseInt(parts[3], 10);
      return handleInlineAnswer(ctx, sessionId, optIdx, msgId);
    }
    if (data.startsWith('endquiz:')) {
      const sessionId = data.split(':')[1];
      const sess = await getSession(ctx.chat.id);
      if (sess?.sessionId !== sessionId) return;
      await finalizeQuiz(ctx, sess);
      await deleteSession(ctx.chat.id);
    }
  }

  // ─────────────────────────────────────────────
  // INTERACTIVE QUIZ
  // ─────────────────────────────────────────────
  async function startInteractiveQuiz(ctx, quizId, startIdx = 0) {
    const existing = await getSession(ctx.chat.id);
    if (existing) await deleteSession(ctx.chat.id);

    const quiz = await store.get(`quiz:${quizId}`);
    if (!quiz) return ctx.reply('❌ Quiz not found.');

    const settings = await getUserSettings(ctx.from.id);
    const sessionId = nanoid(8);
    const isGroup = ctx.chat.type !== 'private';

    const session = {
      sessionId, quizId, chatId: ctx.chat.id,
      startedBy: ctx.from.id, currentIndex: startIdx,
      score: 0, attempted: 0, correct: 0, wrong: 0,
      settings, isGroup, participants: {}, startedAt: Date.now(),
    };
    await saveSession(ctx.chat.id, session);

    const nmText = settings.negativeMarking === 0 ? 'none' : `-${settings.negativeMarking}`;
    await ctx.reply(
      `🚀 *${quiz.name}* started!\n` +
      `❓ ${quiz.questions.length} questions | ⏱️ ${TL_LABELS[settings.timeLimit]} each | ➖ ${nmText}\n\n` +
      `_${isGroup ? 'Everyone can participate! Leaderboard at the end.' : 'Tap an option to answer. Result shown instantly!'}_`,
      { parse_mode: 'Markdown' }
    );
    await sendQuestion(ctx, session, quiz);
  }

  // ─────────────────────────────────────────────
  // SEND QUESTION
  // Private: inline keyboard with message_id encoded in callback
  // Group: Telegram quiz poll (truncated to limits)
  // ─────────────────────────────────────────────
  async function sendQuestion(ctx, session, quiz) {
    const q = quiz.questions[session.currentIndex];
    const total = quiz.questions.length;
    const num = session.currentIndex + 1;
    const { settings, isGroup } = session;

    if (isGroup) {
      const pollQuestion = safePollQuestion(`Q${num}/${total}: ${q.question}`);
      const pollOptions  = q.options.map(o => safePollOption(o));

      try {
        const pollMsg = await ctx.api.sendPoll(session.chatId, pollQuestion, pollOptions, {
          type: 'quiz',
          correct_option_id: q.correctIndex,
          is_anonymous: false,
          open_period: settings.timeLimit,
          explanation: q.explanation ? truncate(q.explanation, 200) : undefined,
        });

        await store.set(`poll:${pollMsg.poll.id}`, {
          chatId: session.chatId, questionIndex: session.currentIndex,
        }, settings.timeLimit + 60);

        session.currentPollId = pollMsg.poll.id;
        session.currentIndex++;
        await saveSession(session.chatId, session);
      } catch (err) {
        console.error('Poll failed, using text fallback:', err.message);
        await sendPrivateStyleQuestion(ctx, session, quiz, q, num, total);
      }
    } else {
      await sendPrivateStyleQuestion(ctx, session, quiz, q, num, total);
    }
  }

  // Private-style question: inline buttons, message_id in callback data for editing
  async function sendPrivateStyleQuestion(ctx, session, quiz, q, num, total) {
    const kb = new InlineKeyboard();
    // Placeholder message_id = 0; will be replaced after send
    q.options.forEach((opt, i) => {
      kb.text(opt.slice(0, 64), `ans:${session.sessionId}:${i}:0`).row();
    });
    kb.text('🛑 End Quiz', `endquiz:${session.sessionId}`);

    const sentMsg = await ctx.api.sendMessage(session.chatId,
      `❓ *Q${num}/${total}*  ⏱️ ${TL_LABELS[session.settings.timeLimit]}\n\n${q.question}`,
      { parse_mode: 'Markdown', reply_markup: kb }
    );

    // Re-edit with real message_id in callback data so we can edit it after answer
    const realKb = new InlineKeyboard();
    q.options.forEach((opt, i) => {
      realKb.text(opt.slice(0, 64), `ans:${session.sessionId}:${i}:${sentMsg.message_id}`).row();
    });
    realKb.text('🛑 End Quiz', `endquiz:${session.sessionId}`);

    await ctx.api.editMessageReplyMarkup(session.chatId, sentMsg.message_id, {
      reply_markup: realKb
    }).catch(() => {});

    if (!session.isGroup) {
      // Save current question msg id for editing after answer
      session.currentMsgId = sentMsg.message_id;
      await saveSession(session.chatId, session);
    } else {
      session.currentIndex++;
      session.currentMsgId = sentMsg.message_id;
      await saveSession(session.chatId, session);
    }
  }

  // ─────────────────────────────────────────────
  // HANDLE INLINE ANSWER — edit the question msg to show result
  // ─────────────────────────────────────────────
  async function handleInlineAnswer(ctx, sessionId, optionIdx, msgId) {
    const sess = await getSession(ctx.chat.id);
    if (!sess || sess.sessionId !== sessionId) return;

    const quiz = await store.get(`quiz:${sess.quizId}`);
    if (!quiz) return;

    const questionIndex = sess.isGroup ? sess.currentIndex - 1 : sess.currentIndex;
    const q = quiz.questions[questionIndex];
    if (!q) return;

    const userId = ctx.from.id;
    const userName = ctx.from.first_name || 'Player';
    const isCorrect = optionIdx === q.correctIndex;

    // Prevent double-answer in group
    if (sess.isGroup) {
      if (!sess.participants[userId]) sess.participants[userId] = { score: 0, correct: 0, wrong: 0, name: userName };
      if (sess.participants[userId][`q${questionIndex}`] !== undefined) {
        return ctx.answerCallbackQuery({ text: 'You already answered!', show_alert: false }).catch(() => {});
      }
      sess.participants[userId][`q${questionIndex}`] = isCorrect;
      const sc = isCorrect ? 1 : -sess.settings.negativeMarking;
      sess.participants[userId].score = (sess.participants[userId].score || 0) + sc;
      if (isCorrect) sess.participants[userId].correct = (sess.participants[userId].correct || 0) + 1;
      else sess.participants[userId].wrong = (sess.participants[userId].wrong || 0) + 1;
    } else {
      const sc = isCorrect ? 1 : -sess.settings.negativeMarking;
      sess.score = (sess.score || 0) + sc;
      sess.attempted = (sess.attempted || 0) + 1;
      if (isCorrect) sess.correct = (sess.correct || 0) + 1;
      else sess.wrong = (sess.wrong || 0) + 1;
    }

    // Show popup
    await ctx.answerCallbackQuery({
      text: isCorrect ? '✅ Correct!' : '❌ Wrong answer', show_alert: false,
    }).catch(() => {});

    // ── EDIT the question message to show result ──────────────────────────
    const currentScore = sess.isGroup
      ? (sess.participants[userId]?.score || 0)
      : Math.max(0, sess.score || 0);
    const total = quiz.questions.length;
    const num = questionIndex + 1;
    const scoreDisplay = sess.isGroup ? '' : `\n🎯 Running score: *${Math.max(0, currentScore)}*`;

    const resultText = buildAnsweredMessage(q, optionIdx, num, total, scoreDisplay);

    // Edit question message to show answered state (no keyboard)
    if (msgId && msgId > 0) {
      await ctx.api.editMessageText(sess.chatId, msgId, resultText, {
        parse_mode: 'Markdown',
      }).catch(() => {});
    }

    // ── Send explanation as separate message ──────────────────────────────
    if (q.explanation) {
      await ctx.api.sendMessage(sess.chatId,
        `📖 *Explanation:*\n${q.explanation}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }

    // ── Advance to next question ──────────────────────────────────────────
    if (!sess.isGroup) {
      sess.currentIndex++;
      await saveSession(ctx.chat.id, sess);

      if (sess.currentIndex >= quiz.questions.length) {
        await finalizeQuiz(ctx, sess);
        await deleteSession(ctx.chat.id);
      } else {
        // Small delay so user sees result before next question
        await new Promise(r => setTimeout(r, 800));
        await sendQuestion(ctx, sess, quiz);
      }
    } else {
      await saveSession(ctx.chat.id, sess);
      if (sess.currentIndex >= quiz.questions.length) {
        await finalizeGroupQuiz(ctx, sess, quiz, sess.chatId);
        await store.del(`session:${sess.chatId}`);
      } else {
        await new Promise(r => setTimeout(r, 800));
        await sendQuestion(ctx, sess, quiz);
      }
    }
  }

  // ─────────────────────────────────────────────
  // POLL ANSWER (group native polls)
  // ─────────────────────────────────────────────
  export async function handlePollAnswer(ctx) {
    const pa = ctx.pollAnswer;
    if (!pa) return;

    const pollMeta = await store.get(`poll:${pa.poll_id}`);
    if (!pollMeta) return;

    const sess = await getSession(pollMeta.chatId);
    if (!sess) return;

    const quiz = await store.get(`quiz:${sess.quizId}`);
    if (!quiz) return;

    const q = quiz.questions[pollMeta.questionIndex];
    if (!q) return;

    const userId = pa.user.id;
    const optionIdx = pa.option_ids?.[0] ?? -1;
    const isCorrect = optionIdx === q.correctIndex;

    if (!sess.participants) sess.participants = {};
    if (!sess.participants[userId]) {
      sess.participants[userId] = { score: 0, correct: 0, wrong: 0, name: pa.user.first_name || `User${userId}` };
    }
    if (sess.participants[userId][`q${pollMeta.questionIndex}`] !== undefined) return;
    sess.participants[userId][`q${pollMeta.questionIndex}`] = isCorrect;

    const sc = isCorrect ? 1 : -sess.settings.negativeMarking;
    sess.participants[userId].score = (sess.participants[userId].score || 0) + sc;
    if (isCorrect) sess.participants[userId].correct = (sess.participants[userId].correct || 0) + 1;
    else sess.participants[userId].wrong = (sess.participants[userId].wrong || 0) + 1;

    await saveSession(pollMeta.chatId, sess);
  }

  // ─────────────────────────────────────────────
  // POLL CLOSED — explanation + next question
  // ─────────────────────────────────────────────
  export async function handlePollClosed(ctx) {
    const poll = ctx.poll;
    if (!poll || !poll.is_closed) return;

    const pollMeta = await store.get(`poll:${poll.id}`);
    if (!pollMeta) return;

    const sess = await getSession(pollMeta.chatId);
    if (!sess) return;

    const quiz = await store.get(`quiz:${sess.quizId}`);
    if (!quiz) return;

    const q = quiz.questions[pollMeta.questionIndex];
    if (q?.explanation) {
      await ctx.api.sendMessage(pollMeta.chatId,
        `✅ *Correct Answer:* ${q.options[q.correctIndex]}\n\n📖 *Explanation:*\n${q.explanation}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }

    await store.del(`poll:${poll.id}`);

    if (sess.currentIndex >= quiz.questions.length) {
      await finalizeGroupQuiz(ctx, sess, quiz, pollMeta.chatId);
      await store.del(`session:${pollMeta.chatId}`);
    } else {
      await sendQuestion(ctx, sess, quiz);
    }
  }

  // ─────────────────────────────────────────────
  // FINALIZE — Private
  // ─────────────────────────────────────────────
  async function finalizeQuiz(ctx, sess) {
    const quiz = await store.get(`quiz:${sess.quizId}`);
    const total = quiz?.questions?.length || 0;
    const score = Math.max(0, sess.score || 0);
    const timeTaken = Math.round((Date.now() - sess.startedAt) / 1000);
    const mins = Math.floor(timeTaken / 60);
    const secs = timeTaken % 60;

    await ctx.api.sendMessage(sess.chatId,
      `🏁 *Quiz Complete!*\n📚 ${quiz?.name || 'Quiz'}\n\n` +
      `${scoreText(score, total)}\n\n` +
      `✅ Correct: *${sess.correct || 0}*\n` +
      `❌ Wrong: *${sess.wrong || 0}*\n` +
      `⏭️ Skipped: *${total - (sess.attempted || 0)}*\n` +
      `⏱️ Time: *${mins > 0 ? `${mins}m ` : ''}${secs}s*`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  // ─────────────────────────────────────────────
  // FINALIZE — Group Leaderboard
  // ─────────────────────────────────────────────
  async function finalizeGroupQuiz(ctx, sess, quiz, chatId) {
    const total = quiz.questions.length;
    const entries = Object.entries(sess.participants || {})
      .sort(([, a], [, b]) => (b.score || 0) - (a.score || 0));

    const MEDALS = ['🥇', '🥈', '🥉'];
    let lb = `🏆 *${quiz.name} — Final Leaderboard*\n❓ ${total} Questions\n━━━━━━━━━━━━━━━━━━━━\n`;

    if (entries.length === 0) {
      lb += '\n_No one attempted the quiz._';
    } else {
      entries.slice(0, 10).forEach(([uid, p], i) => {
        const medal = MEDALS[i] || `${i + 1}.`;
        const name  = (p.name || `User ${uid}`).slice(0, 20);
        const score = Math.max(0, p.score || 0);
        const scoreStr = Number.isInteger(score) ? `${score}` : score.toFixed(2);
        const pct   = total > 0 ? Math.round((score / total) * 100) : 0;
        lb += `${medal} *${name}*: ${scoreStr}/${total} (${pct}%) ✅${p.correct || 0} ❌${p.wrong || 0}\n`;
      });
      lb += `━━━━━━━━━━━━━━━━━━━━\n👥 ${entries.length} participant${entries.length > 1 ? 's' : ''}`;
    }

    await ctx.api.sendMessage(chatId, lb, { parse_mode: 'Markdown' }).catch(() => {});
  }

  // ─────────────────────────────────────────────
  // ANONYMOUS POLLS BROADCAST
  // ─────────────────────────────────────────────
  async function startAnonymousPolls(ctx, quiz) {
    const settings = await getUserSettings(ctx.from.id);
    const total = quiz.questions.length;

    await ctx.reply(`📊 Sending *${total}* anonymous polls from *${quiz.name}*…`, { parse_mode: 'Markdown' });

    let sent = 0;
    for (let i = 0; i < total; i++) {
      const q = quiz.questions[i];
      try {
        await ctx.api.sendPoll(ctx.chat.id,
          safePollQuestion(`Q${i + 1}/${total}: ${q.question}`),
          q.options.map(o => safePollOption(o)),
          {
            type: 'quiz', correct_option_id: q.correctIndex,
            is_anonymous: true, open_period: settings.timeLimit,
            explanation: q.explanation ? truncate(q.explanation, 200) : undefined,
          }
        );
        sent++;
        if (i < total - 1) await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        console.error(`Poll Q${i + 1} error:`, err.message);
      }
    }
    await ctx.reply(`✅ Sent ${sent}/${total} polls!`);
  }
  