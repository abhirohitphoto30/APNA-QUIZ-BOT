import { InlineKeyboard } from 'grammy';
  import { parseQuizText } from './parser.js';
  import { store } from './store.js';
  import { nanoid } from 'nanoid';

  const TL_LABELS = {
    10:'10s',15:'15s',20:'20s',25:'25s',30:'30s',40:'40s',
    45:'45s',50:'50s',60:'1m',90:'1.5m',120:'2m',180:'3m',300:'5m',
  };
  const NM_OPTIONS = [0, 0.25, 0.33, 0.5, 1];
  const ALPHA      = ['A','B','C','D','E'];

  function generateQuizId() {
    return 'QUIZ_' + nanoid(6).toUpperCase().replace(/[^A-Z0-9]/g,'X');
  }
  async function getUserSettings(uid) {
    return (await store.get(`settings:${uid}`)) || { negativeMarking:0, timeLimit:30, shuffle:false };
  }
  async function getSession(chatId)        { return store.get(`session:${chatId}`); }
  async function saveSession(chatId, sess) { return store.set(`session:${chatId}`, sess, 7200); }
  async function deleteSession(chatId) {
    const s = await getSession(chatId);
    if (s?.currentPollId) await store.del(`poll:${s.currentPollId}`);
    await store.del(`session:${chatId}`);
  }

  function truncate(t, n) { return !t ? '' : t.length <= n ? t : t.slice(0,n-1)+'…'; }
  function safePQ(t)  { return truncate(t, 300); }
  function safePOpt(t){ return truncate(t, 100); }
  function tlLabel(tl){ return TL_LABELS[tl] || tl+'s'; }
  function hasLong(opts){ return opts.some(o => o.length > 60); }

  // Build answered message (edits original question msg after answer)
  function buildAnsweredMsg(q, selectedIdx, num, total, runningScore, useABCD) {
    let text = `❓ *Q${num}/${total}*\n\n${q.question}\n\n`;
    q.options.forEach((opt, i) => {
      const label   = useABCD ? ALPHA[i] : opt;
      const correct = i === q.correctIndex;
      const picked  = i === selectedIdx;
      if (picked && correct)        text += `✅ *${label}* ← Correct ✓\n`;
      else if (picked && !correct)  text += `❌ *${label}* ← Your answer ✗\n`;
      else if (correct)             text += `☑️ *${label}* ← Correct answer\n`;
      else                          text += `▫️ ${label}\n`;
    });
    if (runningScore !== '') text += `\n🎯 Score: *${runningScore}*`;
    return text;
  }

  // ─── /start ──────────────────────────────────────────────────────────────────
  export async function handleStart(ctx) {
    const name = ctx.from.first_name || 'there';
    await ctx.reply(
      `👋 *Hello, ${name}!*\n\nWelcome to *Apna Quiz Bot* 🎯\n\n` +
      `📤 Send a *.txt* file — upload quiz questions\n` +
      `📝 /createquiz — format guide\n` +
      `📋 /myquizzes — your saved quizzes\n` +
      `▶️ /startquiz <ID> — start a quiz\n` +
      `📊 /sendpoll <ID> — broadcast anonymous polls\n` +
      `ℹ️ /help — full guide\n\n` +
      `*Mid-quiz commands:*\n/fast /slow /pause /end`,
      { parse_mode:'Markdown' }
    );
  }

  // ─── /help ───────────────────────────────────────────────────────────────────
  export async function handleHelp(ctx) {
    await ctx.reply(
      `📖 *Apna Quiz Bot — Help*\n\n` +
      `*Quiz format (.txt):*\n` +
      `Format 1: Q.1) Question? / Options / Ex: ...\n` +
      `Format 2: Q1.Question? / 😂 / Options / Ex: ...\n` +
      `Mark correct answer with ✅\n\n` +
      `*Mid-quiz commands:*\n` +
      `/fast — ⚡ +10s to timer\n` +
      `/slow — 🐢 -10s from timer\n` +
      `/pause — ⏸️ pause quiz\n` +
      `/end — 🏁 finish quiz & see report\n\n` +
      `*Both private & group have same format!*\n` +
      `Private chat adds a real timer countdown per question.`,
      { parse_mode:'Markdown' }
    );
  }

  // ─── /createquiz ─────────────────────────────────────────────────────────────
  export async function handleCreateQuiz(ctx) {
    await ctx.reply(
      `📝 *Create a Quiz*\n\n` +
      `*Format 1 — Q.1) style:*\n` +
      `\`\`\`\nQ.1) Which planet is closest to the Sun?\nVenus\nMercury ✅\nMars\nEarth\nEx: Mercury is the closest.\n\`\`\`\n\n` +
      `*Format 2 — 😂 separator:*\n` +
      `\`\`\`\nQ1.Consider the following:\n1. Statement one\n😂\nOnly one ✅\nOnly two\nAll three\nEx: Explanation.\n\`\`\`\n\n` +
      `📌 Mark correct with ✅ | Explanation starts with \`Ex:\`\n` +
      `👆 *Now send your .txt file!*`,
      { parse_mode:'Markdown' }
    );
  }

  // ─── DOCUMENT ────────────────────────────────────────────────────────────────
  export async function handleDocument(ctx) {
    const doc = ctx.message.document;
    if (!doc.file_name?.toLowerCase().endsWith('.txt'))
      return ctx.reply('❌ Please send a *.txt* file.', { parse_mode:'Markdown' });
    if (doc.file_size > 5*1024*1024) return ctx.reply('❌ File too large (max 5 MB).');

    const msg = await ctx.reply('⏳ Parsing quiz file…');
    try {
      const file = await ctx.getFile();
      const url  = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('Download failed');
      const questions = parseQuizText(await resp.text());

      if (!questions.length)
        return ctx.api.editMessageText(ctx.chat.id, msg.message_id,
          '❌ No valid questions found. Use /createquiz to see supported formats.');
      if (questions.length > 300)
        return ctx.api.editMessageText(ctx.chat.id, msg.message_id,
          `❌ Too many questions (${questions.length}). Max 300 per quiz.`);

      await store.set(`pending:${ctx.from.id}`, { questions }, 600);
      await store.set(`state:${ctx.from.id}`,   { action:'awaiting_quiz_name' }, 600);

      await ctx.api.editMessageText(ctx.chat.id, msg.message_id,
        `✅ Found *${questions.length} question${questions.length>1?'s':''}!*\n\n` +
        `Preview — Q1: _${truncate(questions[0].question, 120)}_\n\n📝 *Send me a name for this quiz:*`,
        { parse_mode:'Markdown' }
      );
    } catch(err) {
      console.error('handleDocument:', err);
      await ctx.api.editMessageText(ctx.chat.id, msg.message_id,
        '❌ Error reading file.').catch(()=>{});
    }
  }

  // ─── TEXT (state machine) ────────────────────────────────────────────────────
  export async function handleText(ctx) {
    const state = await store.get(`state:${ctx.from.id}`);
    if (!state) return;

    if (state.action === 'awaiting_quiz_name') {
      const name    = ctx.message.text.trim().slice(0,100);
      const pending = await store.get(`pending:${ctx.from.id}`);
      if (!pending) return ctx.reply('⏰ Session expired. Upload the file again.');

      const quizId = generateQuizId();
      await store.set(`quiz:${quizId}`, {
        id:quizId, name, questions:pending.questions,
        createdBy:ctx.from.id, createdAt:Date.now()
      });
      const list = (await store.get(`quizzes:${ctx.from.id}`)) || [];
      list.unshift({ id:quizId, name, count:pending.questions.length, createdAt:Date.now() });
      if (list.length > 50) list.pop();
      await store.set(`quizzes:${ctx.from.id}`, list);
      await store.del(`pending:${ctx.from.id}`);
      await store.del(`state:${ctx.from.id}`);

      const kb = new InlineKeyboard()
        .text('▶️ Start Quiz',    `confirmstart:${quizId}`)
        .text('📊 Send as Polls', `sendpoll:${quizId}`);

      await ctx.reply(
        `🎉 *Quiz saved!*\n📚 *${name}*\n🆔 \`${quizId}\`\n❓ *${pending.questions.length}* questions\n\n_Share ID with others to let them play!_`,
        { parse_mode:'Markdown', reply_markup:kb }
      );
    }
  }

  // ─── /myquizzes ──────────────────────────────────────────────────────────────
  export async function handleMyQuizzes(ctx) {
    const list = (await store.get(`quizzes:${ctx.from.id}`)) || [];
    if (!list.length) return ctx.reply('📭 No quizzes yet. Send a .txt file to create one!');
    let text = `📚 *Your Quizzes (${list.length})*\n\n`;
    const kb  = new InlineKeyboard();
    for (const q of list.slice(0,10)) {
      const d = new Date(q.createdAt).toLocaleDateString('en-IN');
      text += `📝 *${q.name}*\n🆔 \`${q.id}\` • ❓ ${q.count} Qs • 📅 ${d}\n\n`;
      kb.text(`▶️ ${q.name.slice(0,25)}`, `showsettings:${q.id}`).row();
    }
    if (list.length > 10) text += `_…and ${list.length-10} more_\n`;
    await ctx.reply(text, { parse_mode:'Markdown', reply_markup:kb });
  }

  export async function handleStartQuizCommand(ctx) {
    const parts = (ctx.message?.text||'').trim().split(/\s+/);
    const id    = parts[1]?.toUpperCase();
    if (!id) return ctx.reply('Usage: /startquiz QUIZ_XXXXXX');
    await showSettingsMenu(ctx, id);
  }

  export async function handleSendPollCommand(ctx) {
    const parts = (ctx.message?.text||'').trim().split(/\s+/);
    const id    = parts[1]?.toUpperCase();
    if (!id) return ctx.reply('Usage: /sendpoll QUIZ_XXXXXX');
    const quiz  = await store.get(`quiz:${id}`);
    if (!quiz) return ctx.reply('❌ Quiz not found: '+id);
    await startAnonymousPolls(ctx, quiz);
  }

  export async function handleDeleteQuiz(ctx) {
    const parts = (ctx.message?.text||'').trim().split(/\s+/);
    const id    = parts[1]?.toUpperCase();
    if (!id) return ctx.reply('Usage: /deletequiz QUIZ_XXXXXX');
    const quiz  = await store.get(`quiz:${id}`);
    if (!quiz) return ctx.reply('❌ Quiz not found: '+id);
    if (quiz.createdBy !== ctx.from.id) return ctx.reply('❌ You can only delete your own quizzes.');
    await store.del(`quiz:${id}`);
    const list = ((await store.get(`quizzes:${ctx.from.id}`)) || []).filter(q=>q.id!==id);
    await store.set(`quizzes:${ctx.from.id}`, list);
    await ctx.reply(`🗑️ *${quiz.name}* deleted.`, {parse_mode:'Markdown'});
  }

  export async function handleStop(ctx) { return handleEndCommand(ctx); }

  // ─── MID-QUIZ COMMANDS ────────────────────────────────────────────────────────
  export async function handleFastCommand(ctx) {
    const sess = await getSession(ctx.chat.id);
    if (!sess) return ctx.reply('⚠️ No active quiz in this chat.');
    sess.settings.timeLimit = Math.min(300, (sess.settings.timeLimit||30) + 10);
    await saveSession(ctx.chat.id, sess);
    await ctx.reply(`⚡ Timer → *${tlLabel(sess.settings.timeLimit)}* per question`, {parse_mode:'Markdown'});
  }

  export async function handleSlowCommand(ctx) {
    const sess = await getSession(ctx.chat.id);
    if (!sess) return ctx.reply('⚠️ No active quiz in this chat.');
    sess.settings.timeLimit = Math.max(10, (sess.settings.timeLimit||30) - 10);
    await saveSession(ctx.chat.id, sess);
    await ctx.reply(`🐢 Timer → *${tlLabel(sess.settings.timeLimit)}* per question`, {parse_mode:'Markdown'});
  }

  export async function handleEndCommand(ctx) {
    const sess = await getSession(ctx.chat.id);
    if (!sess) return ctx.reply('⚠️ No active quiz in this chat.');
    const quiz = await store.get(`quiz:${sess.quizId}`);
    await sendFinalReport(ctx.api, sess, quiz, true);
    await deleteSession(ctx.chat.id);
    await store.del(`sqz:${sess.sessionId}`);
  }

  export async function handlePauseCommand(ctx) {
    const sess = await getSession(ctx.chat.id);
    if (!sess) return ctx.reply('⚠️ No active quiz in this chat.');
    if (sess.paused) return ctx.reply('Quiz is already paused. Tap Resume below.');
    sess.paused = true;
    await saveSession(ctx.chat.id, sess);
    const kb = new InlineKeyboard().text('▶️ Resume Quiz', `resumequiz:${sess.sessionId}`);
    await ctx.reply(
      `⏸️ *Quiz Paused!*\nProgress: Q${(sess.currentIndex||0)+1}/${sess.totalQuestions||'?'}`,
      { parse_mode:'Markdown', reply_markup:kb }
    );
  }

  // ─── SETTINGS MENU ────────────────────────────────────────────────────────────
  export async function showSettingsMenu(ctx, quizId, editMsgId) {
    const quiz = await store.get(`quiz:${quizId}`);
    if (!quiz) {
      const m = '❌ Quiz not found: '+quizId;
      return editMsgId
        ? ctx.api.editMessageText(ctx.chat.id, editMsgId, m).catch(()=>ctx.reply(m))
        : ctx.reply(m);
    }
    const s  = await getUserSettings(ctx.from.id);
    const kb = new InlineKeyboard();

    kb.text('➖ Negative Marking', 'noop').row();
    for (const nm of NM_OPTIONS) {
      const lbl = nm===0?'None':`-${nm}`;
      kb.text(s.negativeMarking===nm?`✅${lbl}`:lbl, `setnm:${quizId}:${nm}`);
    }
    kb.row();
    kb.text('⏱️ Time per Question', 'noop').row();
    for (const tl of [10,20,30,40,50,60])
      kb.text(s.timeLimit===tl?`✅${TL_LABELS[tl]}`:TL_LABELS[tl], `settl:${quizId}:${tl}`);
    kb.row();
    for (const tl of [90,120,180,300])
      kb.text(s.timeLimit===tl?`✅${TL_LABELS[tl]}`:TL_LABELS[tl], `settl:${quizId}:${tl}`);
    kb.row();
    kb.text(s.shuffle?'🔀 Shuffle: ON ✅':'🔀 Shuffle: OFF', `setshuffle:${quizId}`).row();
    kb.text('▶️ Start Quiz',               `confirmstart:${quizId}`).row();
    kb.text('📊 Broadcast Anonymous Polls', `sendpoll:${quizId}`).row();

    const nm  = s.negativeMarking===0?'None':`-${s.negativeMarking}`;
    const text =
      `📚 *${quiz.name}*\n❓ ${quiz.questions.length} questions\n\n` +
      `⚙️ *Settings*\n➖ Negative Marking: *${nm}*\n` +
      `⏱️ Timer: *${tlLabel(s.timeLimit)}*/question\n🔀 Shuffle: *${s.shuffle?'ON':'OFF'}*\n\n` +
      `_Choose mode below:_`;

    const opts = { parse_mode:'Markdown', reply_markup:kb };
    if (editMsgId)
      await ctx.api.editMessageText(ctx.chat.id, editMsgId, text, opts).catch(()=>ctx.reply(text, opts));
    else
      await ctx.reply(text, opts);
  }

  // ─── CALLBACK ────────────────────────────────────────────────────────────────
  export async function handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery().catch(()=>{});
    if (data === 'noop') return;

    if (data.startsWith('setnm:')) {
      const [,quizId,nm] = data.split(':');
      const s = await getUserSettings(ctx.from.id);
      s.negativeMarking = parseFloat(nm);
      await store.set(`settings:${ctx.from.id}`, s);
      return showSettingsMenu(ctx, quizId, ctx.callbackQuery.message.message_id);
    }
    if (data.startsWith('settl:')) {
      const [,quizId,tl] = data.split(':');
      const s = await getUserSettings(ctx.from.id);
      s.timeLimit = parseInt(tl, 10);
      await store.set(`settings:${ctx.from.id}`, s);
      return showSettingsMenu(ctx, quizId, ctx.callbackQuery.message.message_id);
    }
    if (data.startsWith('setshuffle:')) {
      const quizId = data.split(':')[1];
      const s = await getUserSettings(ctx.from.id);
      s.shuffle = !s.shuffle;
      await store.set(`settings:${ctx.from.id}`, s);
      return showSettingsMenu(ctx, quizId, ctx.callbackQuery.message.message_id);
    }
    if (data.startsWith('showsettings:'))
      return showSettingsMenu(ctx, data.split(':')[1], ctx.callbackQuery.message.message_id);

    if (data.startsWith('confirmstart:'))
      return startInteractiveQuiz(ctx, data.split(':')[1]);

    if (data.startsWith('sendpoll:')) {
      const quiz = await store.get(`quiz:${data.split(':')[1]}`);
      if (!quiz) return ctx.reply('❌ Quiz not found.');
      return startAnonymousPolls(ctx, quiz);
    }

    // ans:sessionId:optionIdx  (msgId is stored in session, no longer in callback)
    if (data.startsWith('ans:')) {
      const [,sid,optStr] = data.split(':');
      return handleInlineAnswer(ctx, sid, parseInt(optStr, 10));
    }

    if (data.startsWith('resumequiz:')) {
      return handleResume(ctx, data.split(':')[1]);
    }

    if (data.startsWith('endquiz:')) {
      const sess = await getSession(ctx.chat.id);
      if (!sess || sess.sessionId !== data.split(':')[1]) return;
      const quiz = await store.get(`sqz:${sess.sessionId}`) || await store.get(`quiz:${sess.quizId}`);
      await sendFinalReport(ctx.api, sess, quiz, false);
      await deleteSession(ctx.chat.id);
      await store.del(`sqz:${sess.sessionId}`);
    }
  }

  // ─── RESUME ──────────────────────────────────────────────────────────────────
  async function handleResume(ctx, sessionId) {
    const sess = await getSession(ctx.chat.id);
    if (!sess || sess.sessionId !== sessionId) return ctx.reply('Session not found.');
    if (!sess.paused) return;
    sess.paused = false;
    await saveSession(ctx.chat.id, sess);
    const quiz = await store.get(`sqz:${sessionId}`) || await store.get(`quiz:${sess.quizId}`);
    if (!quiz) return ctx.reply('Quiz not found.');
    await ctx.reply('▶️ *Quiz Resumed!*', {parse_mode:'Markdown'});
    await sendQuestion(ctx.api, sess, quiz);
  }

  // ─── START INTERACTIVE QUIZ ───────────────────────────────────────────────────
  async function startInteractiveQuiz(ctx, quizId) {
    const existing = await getSession(ctx.chat.id);
    if (existing) {
      await deleteSession(ctx.chat.id);
      await store.del(`sqz:${existing.sessionId}`);
    }

    const quiz    = await store.get(`quiz:${quizId}`);
    if (!quiz) return ctx.reply('❌ Quiz not found.');

    const s       = await getUserSettings(ctx.from.id);
    const sid     = nanoid(8);
    const isGroup = ctx.chat.type !== 'private';

    let questions = [...quiz.questions];
    if (s.shuffle) questions = questions.sort(()=>Math.random()-0.5);

    const sess = {
      sessionId: sid, quizId, chatId: ctx.chat.id,
      startedBy: ctx.from.id, currentIndex: 0,
      score:0, attempted:0, correct:0, wrong:0,
      settings: s, isGroup, participants: {},
      startedAt: Date.now(), totalQuestions: questions.length,
      paused: false, currentMsgId: 0,
    };

    // Store shuffled quiz separately so we always use the right order
    await store.set(`sqz:${sid}`, { ...quiz, questions }, 7200);
    await saveSession(ctx.chat.id, sess);

    const nm  = s.negativeMarking===0?'None':`-${s.negativeMarking}`;
    await ctx.reply(
      `🚀 *${quiz.name}* started!\n` +
      `❓ ${questions.length} Qs | ⏱️ ${tlLabel(s.timeLimit)}/Q | ➖ ${nm} | 🔀 ${s.shuffle?'Shuffled':'In order'}\n\n` +
      `${isGroup?'_Everyone can participate! Leaderboard at end._':'_Tap an option to answer!_'}\n` +
      `_Commands: /fast /slow /pause /end_`,
      { parse_mode:'Markdown' }
    );

    await sendQuestion(ctx.api, sess, { ...quiz, questions });
  }

  // ─── SEND QUESTION — UNIFIED FORMAT FOR BOTH PRIVATE AND GROUP ───────────────
  //
  // Both private and group follow the SAME two-step format:
  //   Step 1: Context text  — full question with numbered items
  //   Step 2: Question msg  — just last question + options/buttons + timer
  //
  // Group  → Step 2 is a Telegram quiz poll
  // Private → Step 2 is a text message with inline keyboard
  //
  async function sendQuestion(api, session, quiz) {
    if (session.paused) return;

    const q      = quiz.questions[session.currentIndex];
    const total  = quiz.questions.length;
    const num    = session.currentIndex + 1;
    const { settings, isGroup, chatId } = session;
    const long   = hasLong(q.options);

    // ── STEP 1: Context text message ────────────────────────────────────────
    // Shows full question including numbered statements
    const contextLines = [`Q${num}/${total}: ${q.question}`];
    if (long) {
      contextLines.push('');
      contextLines.push('Options:');
      q.options.forEach((o,i) => contextLines.push(`  ${ALPHA[i]}) ${o}`));
    }
    await api.sendMessage(chatId, contextLines.join('\n')).catch(()=>{});

    if (isGroup) {
      // ── STEP 2 (GROUP): Telegram quiz poll ─────────────────────────────
      // Poll title = just the key question sentence (last sentence of question)
      const pollTitle   = safePQ(`[${num}/${total}] ${q.question}`);
      const pollOptions = long
        ? q.options.map((_,i)=>ALPHA[i])
        : q.options.map(o=>safePOpt(o));

      try {
        const pollMsg = await api.sendPoll(chatId, pollTitle, pollOptions, {
          type: 'quiz',
          correct_option_id: q.correctIndex,
          is_anonymous: false,
          open_period:  settings.timeLimit,
          explanation:  q.explanation ? truncate(q.explanation, 200) : undefined,
        });

        await store.set(`poll:${pollMsg.poll.id}`, {
          chatId, questionIndex: session.currentIndex, sessionId: session.sessionId,
        }, settings.timeLimit + 120);

        session.currentPollId = pollMsg.poll.id;
        session.currentIndex++;
        await saveSession(chatId, session);

      } catch(err) {
        console.error('Poll failed, using button fallback:', err.message);
        // Fallback: send as private-style question
        await sendButtonQuestion(api, session, quiz, q, num, total, long);
      }

    } else {
      // ── STEP 2 (PRIVATE): Inline keyboard question with timer ───────────
      await sendButtonQuestion(api, session, quiz, q, num, total, long);
    }
  }

  // Sends a question as an inline keyboard message (used in private chat + group fallback)
  async function sendButtonQuestion(api, session, quiz, q, num, total, long) {
    const { settings, chatId } = session;
    const kb = new InlineKeyboard();

    if (long) {
      // A B C D in a single row
      q.options.forEach((_,i) => kb.text(ALPHA[i], `ans:${session.sessionId}:${i}`));
      kb.row();
    } else {
      // Full option text, one per row
      q.options.forEach((o,i) => kb.text(o.slice(0,64), `ans:${session.sessionId}:${i}`).row());
    }
    kb.text('🛑 End Quiz', `endquiz:${session.sessionId}`);

    // Build message text — just the core question + timer (full question shown in context text)
    const questionShort = truncate(q.question, 200);
    const text = `❓ *[${num}/${total}] ${questionShort}*\n\n⏱️ *${tlLabel(settings.timeLimit)}* to answer`;

    const sentMsg = await api.sendMessage(chatId, text, {
      parse_mode:'Markdown', reply_markup: kb
    });

    session.currentMsgId = sentMsg.message_id;
    session.currentIndex++;
    await saveSession(chatId, session);
  }

  // ─── HANDLE INLINE ANSWER ────────────────────────────────────────────────────
  async function handleInlineAnswer(ctx, sessionId, optionIdx) {
    const sess = await getSession(ctx.chat.id);
    if (!sess || sess.sessionId !== sessionId) return;

    const quiz = await store.get(`sqz:${sessionId}`) || await store.get(`quiz:${sess.quizId}`);
    if (!quiz) return;

    const qIdx = sess.currentIndex - 1;  // currentIndex already incremented after sending
    const q    = quiz.questions[qIdx];
    if (!q) return;

    const userId    = ctx.from.id;
    const userName  = ctx.from.first_name || 'Player';
    const isCorrect = optionIdx === q.correctIndex;
    const long      = hasLong(q.options);

    // Prevent double-answer in group fallback
    if (sess.isGroup) {
      if (!sess.participants[userId])
        sess.participants[userId] = { score:0, correct:0, wrong:0, name:userName };
      if (sess.participants[userId][`q${qIdx}`] !== undefined) {
        return ctx.answerCallbackQuery({ text:'You already answered!', show_alert:false }).catch(()=>{});
      }
      sess.participants[userId][`q${qIdx}`] = isCorrect;
      const sc = isCorrect ? 1 : -sess.settings.negativeMarking;
      sess.participants[userId].score  = (sess.participants[userId].score||0) + sc;
      if (isCorrect) sess.participants[userId].correct = (sess.participants[userId].correct||0)+1;
      else           sess.participants[userId].wrong   = (sess.participants[userId].wrong||0)+1;
    } else {
      const sc = isCorrect ? 1 : -sess.settings.negativeMarking;
      sess.score     = (sess.score||0) + sc;
      sess.attempted = (sess.attempted||0) + 1;
      if (isCorrect) sess.correct = (sess.correct||0)+1;
      else           sess.wrong   = (sess.wrong||0)+1;
    }

    await ctx.answerCallbackQuery({
      text: isCorrect ? '✅ Correct!' : '❌ Wrong!', show_alert: false
    }).catch(()=>{});

    // Edit the question message to show result
    const num    = qIdx + 1;
    const total  = quiz.questions.length;
    const sc     = Math.max(0, sess.score || 0);
    const scStr  = sess.isGroup ? '' : (Number.isInteger(sc) ? `${sc}` : sc.toFixed(2));
    const edited = buildAnsweredMsg(q, optionIdx, num, total, scStr, long);

    if (sess.currentMsgId) {
      await ctx.api.editMessageText(sess.chatId, sess.currentMsgId, edited, {
        parse_mode:'Markdown'
      }).catch(()=>{});
    }

    // Send explanation as separate message
    if (q.explanation) {
      await ctx.api.sendMessage(sess.chatId,
        `📖 *Explanation:*\n${q.explanation}`, { parse_mode:'Markdown' }
      ).catch(()=>{});
    }

    // Advance
    await saveSession(ctx.chat.id, sess);

    if (sess.currentIndex >= quiz.questions.length) {
      await sendFinalReport(ctx.api, sess, quiz, false);
      await deleteSession(ctx.chat.id);
      await store.del(`sqz:${sessionId}`);
    } else {
      await new Promise(r => setTimeout(r, 800));
      await sendQuestion(ctx.api, sess, quiz);
    }
  }

  // ─── POLL ANSWER (group native polls) ────────────────────────────────────────
  export async function handlePollAnswer(ctx) {
    const pa = ctx.pollAnswer;
    if (!pa) return;

    const pollMeta = await store.get(`poll:${pa.poll_id}`);
    if (!pollMeta) return;

    const sess = await getSession(pollMeta.chatId);
    if (!sess) return;

    const quiz = await store.get(`sqz:${sess.sessionId}`) || await store.get(`quiz:${sess.quizId}`);
    if (!quiz) return;

    const qIdx      = pollMeta.questionIndex;
    const q         = quiz.questions[qIdx];
    if (!q) return;

    const userId    = pa.user.id;
    const optionIdx = pa.option_ids?.[0] ?? -1;
    const isCorrect = optionIdx === q.correctIndex;

    if (!sess.participants) sess.participants = {};
    if (!sess.participants[userId])
      sess.participants[userId] = { score:0, correct:0, wrong:0, name:pa.user.first_name || `User${userId}` };
    if (sess.participants[userId][`q${qIdx}`] !== undefined) return;

    sess.participants[userId][`q${qIdx}`] = isCorrect;
    const sc = isCorrect ? 1 : -sess.settings.negativeMarking;
    sess.participants[userId].score  = (sess.participants[userId].score||0) + sc;
    if (isCorrect) sess.participants[userId].correct = (sess.participants[userId].correct||0)+1;
    else           sess.participants[userId].wrong   = (sess.participants[userId].wrong||0)+1;

    await saveSession(pollMeta.chatId, sess);
  }

  // ─── POLL CLOSED — send explanation + next question ───────────────────────────
  export async function handlePollClosed(ctx) {
    const poll = ctx.poll;
    if (!poll?.is_closed) return;

    const pollMeta = await store.get(`poll:${poll.id}`);
    if (!pollMeta) return;

    // Clean up poll meta immediately to prevent double-trigger
    await store.del(`poll:${poll.id}`);

    const sess = await getSession(pollMeta.chatId);
    if (!sess) return;

    const quiz = await store.get(`sqz:${sess.sessionId}`) || await store.get(`quiz:${sess.quizId}`);
    if (!quiz) return;

    const q = quiz.questions[pollMeta.questionIndex];

    // Send explanation as separate message
    if (q) {
      const correctText = `✅ *Correct Answer: ${hasLong(q.options) ? ALPHA[q.correctIndex] : q.options[q.correctIndex]}*`;
      const expText = q.explanation ? `\n\n📖 *Explanation:*\n${q.explanation}` : '';
      await ctx.api.sendMessage(pollMeta.chatId, correctText + expText, {
        parse_mode:'Markdown'
      }).catch(()=>{});
    }

    // Check if quiz is done
    if (sess.currentIndex >= quiz.questions.length) {
      await sendFinalReport(ctx.api, sess, quiz, false);
      await store.del(`session:${pollMeta.chatId}`);
      await store.del(`sqz:${sess.sessionId}`);
    } else {
      // Small delay before next question
      await new Promise(r => setTimeout(r, 1500));
      await sendQuestion(ctx.api, sess, quiz);
    }
  }

  // ─── FINAL REPORT ────────────────────────────────────────────────────────────
  async function sendFinalReport(api, sess, quiz, forced) {
    if (sess.isGroup) {
      // Group: leaderboard
      const total   = quiz?.questions?.length || 0;
      const entries = Object.entries(sess.participants || {})
        .sort(([,a],[,b]) => (b.score||0) - (a.score||0));

      const MEDALS = ['🥇','🥈','🥉'];
      let lb = `${forced?'🛑':'🏆'} *${quiz?.name||'Quiz'} — ${forced?'Quiz Stopped':'Final Leaderboard'}*\n` +
        `❓ ${total} Questions\n━━━━━━━━━━━━━━━━━━━━\n`;

      if (!entries.length) {
        lb += '\n_No one attempted the quiz._';
      } else {
        entries.slice(0,10).forEach(([uid,p],i) => {
          const medal   = MEDALS[i] || `${i+1}.`;
          const name    = (p.name||'Player').slice(0,20);
          const nm      = sess.settings?.negativeMarking || 0;
          const penalty = (p.wrong||0) * nm;
          const final   = Math.max(0, (p.correct||0) - penalty);
          const fs      = Number.isInteger(final) ? final : final.toFixed(2);
          const pct     = total > 0 ? Math.round((final/total)*100) : 0;
          lb += `${medal} *${name}*: ${fs}/${total} (${pct}%) ✅${p.correct||0} ❌${p.wrong||0}\n`;
        });
        lb += `━━━━━━━━━━━━━━━━━━━━\n👥 ${entries.length} participant${entries.length>1?'s':''}`;
      }
      await api.sendMessage(sess.chatId, lb, {parse_mode:'Markdown'}).catch(()=>{});

    } else {
      // Private: detailed personal report
      const total    = quiz?.questions?.length || 0;
      const attempted = sess.attempted || 0;
      const correct  = sess.correct || 0;
      const wrong    = sess.wrong || 0;
      const skipped  = total - attempted;
      const nm       = sess.settings?.negativeMarking || 0;
      const penalty  = wrong * nm;
      const finalSc  = Math.max(0, correct - penalty);
      const fs       = Number.isInteger(finalSc) ? finalSc : finalSc.toFixed(2);
      const pct      = total > 0 ? ((finalSc/total)*100).toFixed(1) : '0.0';
      const grade    = parseFloat(pct)>=90?'🏆 Excellent!':parseFloat(pct)>=70?'🥇 Good!':parseFloat(pct)>=50?'✅ Pass':'📚 Keep practicing';

      const elapsed  = Math.round((Date.now()-sess.startedAt)/1000);
      const mins     = Math.floor(elapsed/60);
      const secs     = elapsed%60;
      const timeStr  = mins>0?`${mins}m ${secs}s`:`${secs}s`;

      const nmLine   = nm > 0
        ? `\n➖ Penalty         : -${(penalty%1===0?penalty:penalty.toFixed(2))} (${wrong}×${nm})`
        : '';

      await api.sendMessage(sess.chatId,
        `${forced?'🛑':'🏁'} *Quiz ${forced?'Ended':'Complete'}!*\n` +
        `📚 ${quiz?.name||'Quiz'}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📊 *Result Report*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📝 Total Questions   : ${total}\n` +
        `✍️ Attempted          : ${attempted}\n` +
        `✅ Correct            : ${correct}\n` +
        `❌ Wrong              : ${wrong}\n` +
        `⏭️ Skipped            : ${skipped}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📈 Raw Score          : ${correct}/${total}${nmLine}\n` +
        `🎯 Final Score        : *${fs}*/${total}\n` +
        `📊 Percentage         : *${pct}%*\n` +
        `🏅 Grade              : ${grade}\n` +
        `⏱️ Time Taken         : ${timeStr}`,
        { parse_mode:'Markdown' }
      ).catch(()=>{});
    }
  }

  // ─── ANONYMOUS POLLS BROADCAST ────────────────────────────────────────────────
  async function startAnonymousPolls(ctx, quiz) {
    const s     = await getUserSettings(ctx.from.id);
    const total = quiz.questions.length;
    await ctx.reply(`📊 Sending *${total}* anonymous polls from *${quiz.name}*…`, {parse_mode:'Markdown'});

    let sent = 0;
    for (let i=0; i<total; i++) {
      const q    = quiz.questions[i];
      const long = hasLong(q.options);
      try {
        // Context text (always)
        const lines = [`Q${i+1}/${total}: ${q.question}`];
        if (long) {
          lines.push('\nOptions:');
          q.options.forEach((o,idx)=>lines.push(`  ${ALPHA[idx]}) ${o}`));
        }
        await ctx.api.sendMessage(ctx.chat.id, lines.join('\n'));

        // Quiz poll
        await ctx.api.sendPoll(ctx.chat.id,
          safePQ(`[${i+1}/${total}] ${q.question}`),
          long ? q.options.map((_,idx)=>ALPHA[idx]) : q.options.map(o=>safePOpt(o)),
          {
            type:'quiz', correct_option_id:q.correctIndex,
            is_anonymous:true, open_period:s.timeLimit,
            explanation: q.explanation ? truncate(q.explanation,200) : undefined,
          }
        );
        sent++;
        if (i<total-1) await new Promise(r=>setTimeout(r,600));
      } catch(err) { console.error(`Poll Q${i+1} error:`, err.message); }
    }
    await ctx.reply(`✅ Sent ${sent}/${total} polls successfully!`);
  }
  