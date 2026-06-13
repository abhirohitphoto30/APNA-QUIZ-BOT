import { InlineKeyboard } from 'grammy';
  import { parseQuizText } from './parser.js';
  import { store } from './store.js';
  import { nanoid } from 'nanoid';

  const TL_LABELS = {
    10:'10s',15:'15s',20:'20s',25:'25s',30:'30s',40:'40s',
    45:'45s',50:'50s',60:'1m',90:'1.5m',120:'2m',180:'3m',300:'5m',
  };
  const NM_OPTIONS  = [0, 0.25, 0.33, 0.5, 1];
  const TL_OPTIONS  = [10, 20, 30, 40, 50, 60, 90, 120, 180, 300];
  const ALPHA       = ['A','B','C','D','E'];

  function generateQuizId() {
    return 'QUIZ_' + nanoid(6).toUpperCase().replace(/[^A-Z0-9]/g,'X');
  }
  async function getUserSettings(uid) {
    return (await store.get(`settings:${uid}`)) || { negativeMarking:0, timeLimit:30, shuffle:false };
  }
  async function getSession(chatId)          { return store.get(`session:${chatId}`); }
  async function saveSession(chatId, sess)   { return store.set(`session:${chatId}`, sess, 7200); }
  async function deleteSession(chatId) {
    const s = await getSession(chatId);
    if (s?.currentPollId) await store.del(`poll:${s.currentPollId}`);
    await store.del(`session:${chatId}`);
  }

  function truncate(t, n) { return !t ? '' : t.length <= n ? t : t.slice(0,n-1)+'…'; }
  function safePQ(t)  { return truncate(t,300); }
  function safePOpt(t){ return truncate(t,100); }

  // Are any options "long" (>60 chars)?
  function hasLongOptions(opts) { return opts.some(o => o.length > 60); }

  // Build ABCD option block for text messages
  function buildOptionBlock(opts) {
    return opts.map((o,i) => `*${ALPHA[i]})* ${o}`).join('\n');
  }

  // Build the answered-state message (edits original question)
  function buildAnsweredMsg(q, selectedIdx, num, total, scoreStr, useABCD) {
    let text = `❓ *Q${num}/${total}*\n\n${q.question}\n\n`;
    q.options.forEach((opt, i) => {
      const label    = useABCD ? ALPHA[i] : opt;
      const isRight  = i === q.correctIndex;
      const isPicked = i === selectedIdx;
      if (isPicked && isRight)       text += `✅ *${label}* ← Correct ✓\n`;
      else if (isPicked && !isRight) text += `❌ *${label}* ← Your answer ✗\n`;
      else if (isRight)              text += `☑️ *${label}* ← Correct answer\n`;
      else                           text += `▫️ ${label}\n`;
    });
    if (scoreStr) text += `\n${scoreStr}`;
    return text;
  }

  // ─── /start ─────────────────────────────────────────────────────────────────
  export async function handleStart(ctx) {
    const name = ctx.from.first_name || 'there';
    await ctx.reply(
      `👋 *Hello, ${name}!*\n\nWelcome to *Apna Quiz Bot* 🎯\n\n` +
      `📤 *Send a .txt file* — upload quiz questions\n` +
      `📝 /createquiz — format guide\n` +
      `📋 /myquizzes — your saved quizzes\n` +
      `▶️ /startquiz <ID> — start a quiz\n` +
      `📊 /sendpoll <ID> — send as anonymous polls\n` +
      `ℹ️ /help — detailed help\n\n` +
      `*Mid-quiz commands:*\n` +
      `/fast /slow — adjust timer ±10s\n` +
      `/pause — pause (resume later)\n` +
      `/end — finish quiz\n`,
      { parse_mode:'Markdown' }
    );
  }

  // ─── /help ───────────────────────────────────────────────────────────────────
  export async function handleHelp(ctx) {
    await ctx.reply(
      `📖 *Apna Quiz Bot — Help*\n\n` +
      `*Supported .txt formats:*\n` +
      `Format 1: \`Q.1) Question? / Option A / Option B ✅ / Ex: ...\`\n` +
      `Format 2: \`Q1.Question? / 😂 / Option A ✅ / Ex: ...\`\n\n` +
      `*Settings before quiz:*\n` +
      `• Negative Marking (0, -0.25, -0.33, -0.5, -1)\n` +
      `• Time per question (10s–5m)\n` +
      `• 🔀 Shuffle questions\n\n` +
      `*Mid-quiz commands:*\n` +
      `/fast — ⬆️ add 10s to timer\n` +
      `/slow — ⬇️ subtract 10s from timer\n` +
      `/pause — ⏸️ pause, resume anytime\n` +
      `/end — 🏁 end quiz & see report\n\n` +
      `*Modes:* Private chat = inline buttons | Group = Telegram quiz polls`,
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
      `\`\`\`\nQ1.Consider the following:\n1. Statement one\n😂\nOnly one ✅\nOnly two\nAll three\nNone\nEx: Explanation.\n\`\`\`\n\n` +
      `📌 Mark correct answer with ✅, explanation with \`Ex:\`\n` +
      `👆 *Now send your .txt file!*`,
      { parse_mode:'Markdown' }
    );
  }

  // ─── DOCUMENT ────────────────────────────────────────────────────────────────
  export async function handleDocument(ctx) {
    const doc = ctx.message.document;
    if (!doc.file_name?.toLowerCase().endsWith('.txt'))
      return ctx.reply('❌ Please send a *.txt* file.', {parse_mode:'Markdown'});
    if (doc.file_size > 5*1024*1024) return ctx.reply('❌ File too large (max 5 MB).');

    const msg = await ctx.reply('⏳ Parsing quiz file…');
    try {
      const file = await ctx.getFile();
      const url  = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('Download failed');
      const text = await resp.text();
      const questions = parseQuizText(text);

      if (questions.length === 0)
        return ctx.api.editMessageText(ctx.chat.id, msg.message_id,
          '❌ No valid questions found.\n\nUse /createquiz to see supported formats.');
      if (questions.length > 300)
        return ctx.api.editMessageText(ctx.chat.id, msg.message_id,
          `❌ Too many questions (${questions.length}). Max 300 per quiz.`);

      await store.set(`pending:${ctx.from.id}`, { questions }, 600);
      await store.set(`state:${ctx.from.id}`, { action:'awaiting_quiz_name' }, 600);

      await ctx.api.editMessageText(ctx.chat.id, msg.message_id,
        `✅ Found *${questions.length} question${questions.length>1?'s':''}!*\n\n` +
        `Preview — Q1: _${truncate(questions[0].question, 120)}_\n\n📝 *Send me a name for this quiz:*`,
        { parse_mode:'Markdown' }
      );
    } catch(err) {
      console.error('handleDocument:', err);
      await ctx.api.editMessageText(ctx.chat.id, msg.message_id,
        '❌ Error reading file. Make sure it is a valid .txt quiz file.').catch(()=>{});
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
      const quiz   = { id:quizId, name, questions:pending.questions, createdBy:ctx.from.id, createdAt:Date.now() };
      await store.set(`quiz:${quizId}`, quiz);

      const list = (await store.get(`quizzes:${ctx.from.id}`)) || [];
      list.unshift({ id:quizId, name, count:pending.questions.length, createdAt:Date.now() });
      if (list.length > 50) list.pop();
      await store.set(`quizzes:${ctx.from.id}`, list);
      await store.del(`pending:${ctx.from.id}`);
      await store.del(`state:${ctx.from.id}`);

      const kb = new InlineKeyboard()
        .text('▶️ Start Quiz',    `confirmstart:${quizId}:0`)
        .text('📊 Send as Polls', `sendpoll:${quizId}:0`);

      await ctx.reply(
        `🎉 *Quiz saved!*\n\n📚 *${name}*\n🆔 ID: \`${quizId}\`\n❓ Questions: *${pending.questions.length}*\n\n_Share this ID with others to let them play!_`,
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
    const parts  = (ctx.message?.text||'').trim().split(/\s+/);
    const quizId = parts[1]?.toUpperCase();
    if (!quizId) return ctx.reply('Usage: /startquiz QUIZ_XXXXXX');
    await showSettingsMenu(ctx, quizId);
  }

  export async function handleSendPollCommand(ctx) {
    const parts  = (ctx.message?.text||'').trim().split(/\s+/);
    const quizId = parts[1]?.toUpperCase();
    if (!quizId) return ctx.reply('Usage: /sendpoll QUIZ_XXXXXX');
    const quiz = await store.get(`quiz:${quizId}`);
    if (!quiz) return ctx.reply(`❌ Quiz not found: ${quizId}`);
    await startAnonymousPolls(ctx, quiz);
  }

  export async function handleDeleteQuiz(ctx) {
    const parts  = (ctx.message?.text||'').trim().split(/\s+/);
    const quizId = parts[1]?.toUpperCase();
    if (!quizId) return ctx.reply('Usage: /deletequiz QUIZ_XXXXXX');
    const quiz = await store.get(`quiz:${quizId}`);
    if (!quiz) return ctx.reply(`❌ Quiz not found: ${quizId}`);
    if (quiz.createdBy !== ctx.from.id) return ctx.reply('❌ You can only delete your own quizzes.');
    await store.del(`quiz:${quizId}`);
    const list = ((await store.get(`quizzes:${ctx.from.id}`)) || []).filter(q=>q.id!==quizId);
    await store.set(`quizzes:${ctx.from.id}`, list);
    await ctx.reply(`🗑️ Quiz *${quiz.name}* deleted.`, {parse_mode:'Markdown'});
  }

  export async function handleStop(ctx) {
    return handleEndCommand(ctx); // /stop = /end
  }

  // ─── MID-QUIZ COMMANDS ────────────────────────────────────────────────────────
  export async function handleFastCommand(ctx) {
    const sess = await getSession(ctx.chat.id);
    if (!sess) return ctx.reply('No active quiz.');
    sess.settings.timeLimit = Math.min(300, (sess.settings.timeLimit||30) + 10);
    await saveSession(ctx.chat.id, sess);
    await ctx.reply(`⚡ Timer increased → *${TL_LABELS[sess.settings.timeLimit] || sess.settings.timeLimit+'s'}* per question`, {parse_mode:'Markdown'});
  }

  export async function handleSlowCommand(ctx) {
    const sess = await getSession(ctx.chat.id);
    if (!sess) return ctx.reply('No active quiz.');
    sess.settings.timeLimit = Math.max(10, (sess.settings.timeLimit||30) - 10);
    await saveSession(ctx.chat.id, sess);
    await ctx.reply(`🐢 Timer decreased → *${TL_LABELS[sess.settings.timeLimit] || sess.settings.timeLimit+'s'}* per question`, {parse_mode:'Markdown'});
  }

  export async function handleEndCommand(ctx) {
    const sess = await getSession(ctx.chat.id);
    if (!sess) return ctx.reply('No active quiz.');
    const quiz = await store.get(`quiz:${sess.quizId}`);
    await finalizeQuiz(ctx, sess, quiz, true);
    await deleteSession(ctx.chat.id);
  }

  export async function handlePauseCommand(ctx) {
    const sess = await getSession(ctx.chat.id);
    if (!sess) return ctx.reply('No active quiz.');
    if (sess.paused) return ctx.reply('Quiz is already paused. Tap Resume.');

    sess.paused = true;
    await saveSession(ctx.chat.id, sess);

    const kb = new InlineKeyboard().text('▶️ Resume Quiz', `resumequiz:${sess.sessionId}`);
    await ctx.reply(
      `⏸️ *Quiz Paused!*\n` +
      `📊 Progress: Q${(sess.currentIndex||0)+1} of ${sess.totalQuestions||'?'}\n` +
      `🎯 Score so far: ${Math.max(0, sess.score||0)}\n\n` +
      `Tap Resume when ready.`,
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

    // Negative marking row
    kb.text('➖ Negative Marking', 'noop').row();
    for (const nm of NM_OPTIONS) {
      const label = nm===0?'None':`-${nm}`;
      kb.text(s.negativeMarking===nm?`✅ ${label}`:label, `setnm:${quizId}:${nm}`);
    }
    kb.row();

    // Timer rows
    kb.text('⏱️ Time per Question', 'noop').row();
    for (const tl of [10,20,30,40,50,60])
      kb.text(s.timeLimit===tl?`✅ ${TL_LABELS[tl]}`:TL_LABELS[tl], `settl:${quizId}:${tl}`);
    kb.row();
    for (const tl of [90,120,180,300])
      kb.text(s.timeLimit===tl?`✅ ${TL_LABELS[tl]}`:TL_LABELS[tl], `settl:${quizId}:${tl}`);
    kb.row();

    // Shuffle
    kb.text(s.shuffle?'🔀 Shuffle: ON ✅':'🔀 Shuffle: OFF', `setshuffle:${quizId}`).row();

    // Start buttons
    kb.text('▶️ Start Interactive Quiz',     `confirmstart:${quizId}:0`).row();
    kb.text('📊 Broadcast Anonymous Polls',  `sendpoll:${quizId}:0`).row();

    const nmText = s.negativeMarking===0?'None':`-${s.negativeMarking}`;
    const text =
      `📚 *${quiz.name}*\n❓ ${quiz.questions.length} questions\n\n` +
      `⚙️ *Settings*\n` +
      `➖ Negative Marking: *${nmText}* per wrong\n` +
      `⏱️ Time Limit: *${TL_LABELS[s.timeLimit]||s.timeLimit+'s'}* per question\n` +
      `🔀 Shuffle: *${s.shuffle?'ON':'OFF'}*\n\n` +
      `_Choose mode below:_`;

    const opts = { parse_mode:'Markdown', reply_markup:kb };
    if (editMsgId) {
      await ctx.api.editMessageText(ctx.chat.id, editMsgId, text, opts).catch(()=>ctx.reply(text, opts));
    } else {
      await ctx.reply(text, opts);
    }
  }

  // ─── CALLBACK HANDLER ─────────────────────────────────────────────────────────
  export async function handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery().catch(()=>{});
    if (data === 'noop') return;

    if (data.startsWith('setnm:')) {
      const [,quizId,nmStr] = data.split(':');
      const s = await getUserSettings(ctx.from.id);
      s.negativeMarking = parseFloat(nmStr);
      await store.set(`settings:${ctx.from.id}`, s);
      return showSettingsMenu(ctx, quizId, ctx.callbackQuery.message.message_id);
    }
    if (data.startsWith('settl:')) {
      const [,quizId,tlStr] = data.split(':');
      const s = await getUserSettings(ctx.from.id);
      s.timeLimit = parseInt(tlStr,10);
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

    if (data.startsWith('confirmstart:')) {
      const parts = data.split(':');
      return startInteractiveQuiz(ctx, parts[1], parseInt(parts[2]||'0',10));
    }
    if (data.startsWith('sendpoll:')) {
      const quizId = data.split(':')[1];
      const quiz   = await store.get(`quiz:${quizId}`);
      if (!quiz) return ctx.reply('❌ Quiz not found: '+quizId);
      return startAnonymousPolls(ctx, quiz);
    }
    if (data.startsWith('ans:')) {
      const parts = data.split(':');
      return handleInlineAnswer(ctx, parts[1], parseInt(parts[2],10), parseInt(parts[3],10));
    }
    if (data.startsWith('resumequiz:')) {
      return handleResume(ctx, data.split(':')[1]);
    }
    if (data.startsWith('endquiz:')) {
      const sessionId = data.split(':')[1];
      const sess = await getSession(ctx.chat.id);
      if (sess?.sessionId !== sessionId) return;
      const quiz = await store.get(`quiz:${sess.quizId}`);
      await finalizeQuiz(ctx, sess, quiz, false);
      await deleteSession(ctx.chat.id);
    }
  }

  // ─── RESUME ──────────────────────────────────────────────────────────────────
  async function handleResume(ctx, sessionId) {
    const sess = await getSession(ctx.chat.id);
    if (!sess || sess.sessionId !== sessionId) return ctx.reply('Session not found.');
    if (!sess.paused) return;
    sess.paused = false;
    await saveSession(ctx.chat.id, sess);
    const quiz = await store.get(`quiz:${sess.quizId}`);
    if (!quiz) return ctx.reply('Quiz not found.');
    await ctx.reply('▶️ *Quiz Resumed!*', {parse_mode:'Markdown'});
    await sendQuestion(ctx, sess, quiz);
  }

  // ─── START INTERACTIVE QUIZ ───────────────────────────────────────────────────
  async function startInteractiveQuiz(ctx, quizId, startIdx=0) {
    const existing = await getSession(ctx.chat.id);
    if (existing) await deleteSession(ctx.chat.id);

    const quiz = await store.get(`quiz:${quizId}`);
    if (!quiz) return ctx.reply('❌ Quiz not found.');

    const s        = await getUserSettings(ctx.from.id);
    const sessionId = nanoid(8);
    const isGroup   = ctx.chat.type !== 'private';

    // Shuffle if enabled
    let questions = [...quiz.questions];
    if (s.shuffle) questions = questions.sort(()=>Math.random()-0.5);
    const shuffledQuiz = { ...quiz, questions };

    const session = {
      sessionId, quizId, chatId:ctx.chat.id,
      startedBy:ctx.from.id, currentIndex:startIdx,
      score:0, attempted:0, correct:0, wrong:0,
      settings:s, isGroup, participants:{}, startedAt:Date.now(),
      totalQuestions: questions.length,
      paused: false,
      // Store shuffled questions in session (or store as separate key)
    };

    // Store shuffled quiz for this session
    await store.set(`sqz:${sessionId}`, shuffledQuiz, 7200);
    await saveSession(ctx.chat.id, session);

    const nmText = s.negativeMarking===0?'None':`-${s.negativeMarking}`;
    const tlText = TL_LABELS[s.timeLimit]||s.timeLimit+'s';
    await ctx.reply(
      `🚀 *${quiz.name}* started!\n` +
      `❓ ${questions.length} questions | ⏱️ ${tlText} each | ➖ ${nmText} | 🔀 ${s.shuffle?'Shuffled':'In order'}\n\n` +
      `_${isGroup?'Everyone can participate! Leaderboard at the end.':'Tap an option to answer!'}_\n` +
      `_Mid-quiz: /fast /slow /pause /end_`,
      { parse_mode:'Markdown' }
    );
    await sendQuestion(ctx, session, shuffledQuiz);
  }

  // ─── SEND QUESTION ────────────────────────────────────────────────────────────
  // Format matching screenshots:
  //   Groups  → text context message THEN Telegram quiz poll
  //   Private → full question + inline buttons (A/B/C/D if options are long)
  async function sendQuestion(ctx, session, quiz) {
    if (session.paused) return;

    const q     = quiz.questions[session.currentIndex];
    const total = quiz.questions.length;
    const num   = session.currentIndex + 1;
    const { settings, isGroup } = session;
    const tlLabel = TL_LABELS[settings.timeLimit]||settings.timeLimit+'s';
    const long    = hasLongOptions(q.options);

    if (isGroup) {
      // ── Step 1: Send full question as text context ──────────────────────
      const contextLines = [`Q${num}/${total}: ${q.question}`];
      if (long) {
        contextLines.push('');
        contextLines.push('Options:');
        q.options.forEach((o,i)=>contextLines.push(`  ${ALPHA[i]}) ${o}`));
      }
      await ctx.api.sendMessage(session.chatId, contextLines.join('\n')).catch(()=>{});

      // ── Step 2: Send Telegram quiz poll ────────────────────────────────
      const pollTitle = safePQ(`[${num}/${total}] ${q.question}`);
      const pollOpts  = long
        ? q.options.map((_,i)=>ALPHA[i])                   // just A B C D
        : q.options.map(o=>safePOpt(o));

      try {
        const pollMsg = await ctx.api.sendPoll(session.chatId, pollTitle, pollOpts, {
          type:'quiz',
          correct_option_id: q.correctIndex,
          is_anonymous: false,
          open_period: settings.timeLimit,
          explanation: q.explanation ? truncate(q.explanation,200) : undefined,
        });
        await store.set(`poll:${pollMsg.poll.id}`, {
          chatId:session.chatId, questionIndex:session.currentIndex,
        }, settings.timeLimit+60);
        session.currentPollId   = pollMsg.poll.id;
        session.currentIndex++;
        await saveSession(session.chatId, session);
      } catch(err) {
        console.error('Group poll failed, text fallback:', err.message);
        await sendPrivateQuestion(ctx, session, quiz, q, num, total, long);
      }

    } else {
      await sendPrivateQuestion(ctx, session, quiz, q, num, total, long);
    }
  }

  // Private-chat question (also used as group fallback)
  async function sendPrivateQuestion(ctx, session, quiz, q, num, total, long) {
    let text = `❓ *Q${num}/${total}*  ⏱️ ${TL_LABELS[session.settings.timeLimit]||session.settings.timeLimit+'s'}\n\n${q.question}\n\n`;

    const kb = new InlineKeyboard();
    if (long) {
      // Show full options as A) B) C) D) in message, buttons show A B C D
      text += buildOptionBlock(q.options);
      text += '\n';
      const row = [];
      q.options.forEach((_,i)=>row.push(ALPHA[i]));
      row.forEach(lbl=>kb.text(lbl, `ans:${session.sessionId}:${q.options.indexOf(q.options[ALPHA.indexOf(lbl)])}:0`));
      // Fix: rebuild with correct index
      kb.row();
      q.options.forEach((_,i)=>{ /* rebuld below */ });
    } else {
      // Short options: full text as button label
    }

    // Rebuild keyboard correctly
    const kb2 = new InlineKeyboard();
    if (long) {
      q.options.forEach((_,i)=>kb2.text(ALPHA[i], `ans:${session.sessionId}:${i}:0`));
    } else {
      q.options.forEach((o,i)=>kb2.text(o.slice(0,64), `ans:${session.sessionId}:${i}:0`).row());
    }
    kb2.text('🛑 End Quiz', `endquiz:${session.sessionId}`);

    // Send message
    const sentMsg = await ctx.api.sendMessage(session.chatId, text, {
      parse_mode:'Markdown', reply_markup: kb2
    });

    // Re-edit keyboard to embed real message_id in callback data
    const kb3 = new InlineKeyboard();
    if (long) {
      q.options.forEach((_,i)=>kb3.text(ALPHA[i], `ans:${session.sessionId}:${i}:${sentMsg.message_id}`));
    } else {
      q.options.forEach((o,i)=>kb3.text(o.slice(0,64), `ans:${session.sessionId}:${i}:${sentMsg.message_id}`).row());
    }
    kb3.text('🛑 End Quiz', `endquiz:${session.sessionId}`);

    await ctx.api.editMessageReplyMarkup(session.chatId, sentMsg.message_id, {
      reply_markup: kb3
    }).catch(()=>{});

    session.currentMsgId = sentMsg.message_id;
    if (!session.isGroup) {
      await saveSession(session.chatId, session);
    } else {
      session.currentIndex++;
      await saveSession(session.chatId, session);
    }
  }

  // ─── HANDLE INLINE ANSWER ────────────────────────────────────────────────────
  async function handleInlineAnswer(ctx, sessionId, optionIdx, msgId) {
    const sess = await getSession(ctx.chat.id);
    if (!sess || sess.sessionId !== sessionId) return;

    // Use shuffled quiz from session store
    const quiz = await store.get(`sqz:${sessionId}`) || await store.get(`quiz:${sess.quizId}`);
    if (!quiz) return;

    const questionIndex = sess.isGroup ? sess.currentIndex-1 : sess.currentIndex;
    const q = quiz.questions[questionIndex];
    if (!q) return;

    const userId   = ctx.from.id;
    const userName = ctx.from.first_name||'Player';
    const isCorrect = optionIdx === q.correctIndex;
    const long = hasLongOptions(q.options);

    if (sess.isGroup) {
      if (!sess.participants[userId])
        sess.participants[userId] = { score:0, correct:0, wrong:0, name:userName };
      if (sess.participants[userId][`q${questionIndex}`] !== undefined) {
        return ctx.answerCallbackQuery({ text:'You already answered!', show_alert:false }).catch(()=>{});
      }
      sess.participants[userId][`q${questionIndex}`] = isCorrect;
      const sc = isCorrect ? 1 : -sess.settings.negativeMarking;
      sess.participants[userId].score  = (sess.participants[userId].score||0)+sc;
      if (isCorrect) sess.participants[userId].correct = (sess.participants[userId].correct||0)+1;
      else           sess.participants[userId].wrong   = (sess.participants[userId].wrong||0)+1;
    } else {
      const sc = isCorrect ? 1 : -sess.settings.negativeMarking;
      sess.score    = (sess.score||0)+sc;
      sess.attempted = (sess.attempted||0)+1;
      if (isCorrect) sess.correct = (sess.correct||0)+1;
      else           sess.wrong   = (sess.wrong||0)+1;
    }

    await ctx.answerCallbackQuery({ text:isCorrect?'✅ Correct!':'❌ Wrong!', show_alert:false }).catch(()=>{});

    // Edit question message to show result
    const num    = questionIndex+1;
    const total  = quiz.questions.length;
    const rawSc  = Math.max(0, sess.score||0);
    const scoreStr = sess.isGroup ? '' : `🎯 Running score: *${Number.isInteger(rawSc)?rawSc:rawSc.toFixed(2)}*`;
    const resultText = buildAnsweredMsg(q, optionIdx, num, total, scoreStr, long);

    if (msgId && msgId > 0) {
      await ctx.api.editMessageText(sess.chatId, msgId, resultText, {parse_mode:'Markdown'}).catch(()=>{});
    }

    // Send explanation
    if (q.explanation) {
      await ctx.api.sendMessage(sess.chatId,
        `📖 *Explanation:*\n${q.explanation}`, {parse_mode:'Markdown'}).catch(()=>{});
    }

    // Next question
    if (!sess.isGroup) {
      sess.currentIndex++;
      await saveSession(ctx.chat.id, sess);
      if (sess.currentIndex >= quiz.questions.length) {
        await finalizeQuiz(ctx, sess, quiz, false);
        await deleteSession(ctx.chat.id);
      } else {
        await new Promise(r=>setTimeout(r,800));
        await sendQuestion(ctx, sess, quiz);
      }
    } else {
      await saveSession(ctx.chat.id, sess);
      if (sess.currentIndex >= quiz.questions.length) {
        await finalizeGroupQuiz(ctx, sess, quiz, sess.chatId);
        await store.del(`session:${sess.chatId}`);
        await store.del(`sqz:${sessionId}`);
      } else {
        await new Promise(r=>setTimeout(r,800));
        await sendQuestion(ctx, sess, quiz);
      }
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

    const q = quiz.questions[pollMeta.questionIndex];
    if (!q) return;

    const userId = pa.user.id;
    const optionIdx = pa.option_ids?.[0] ?? -1;
    const isCorrect = optionIdx === q.correctIndex;

    if (!sess.participants) sess.participants = {};
    if (!sess.participants[userId])
      sess.participants[userId] = { score:0, correct:0, wrong:0, name:pa.user.first_name||`User${userId}` };
    if (sess.participants[userId][`q${pollMeta.questionIndex}`] !== undefined) return;
    sess.participants[userId][`q${pollMeta.questionIndex}`] = isCorrect;
    const sc = isCorrect ? 1 : -sess.settings.negativeMarking;
    sess.participants[userId].score  = (sess.participants[userId].score||0)+sc;
    if (isCorrect) sess.participants[userId].correct = (sess.participants[userId].correct||0)+1;
    else           sess.participants[userId].wrong   = (sess.participants[userId].wrong||0)+1;
    await saveSession(pollMeta.chatId, sess);
  }

  // ─── POLL CLOSED ─────────────────────────────────────────────────────────────
  export async function handlePollClosed(ctx) {
    const poll = ctx.poll;
    if (!poll?.is_closed) return;
    const pollMeta = await store.get(`poll:${poll.id}`);
    if (!pollMeta) return;
    const sess = await getSession(pollMeta.chatId);
    if (!sess) return;
    const quiz = await store.get(`sqz:${sess.sessionId}`) || await store.get(`quiz:${sess.quizId}`);
    if (!quiz) return;

    const q = quiz.questions[pollMeta.questionIndex];
    if (q?.explanation) {
      await ctx.api.sendMessage(pollMeta.chatId,
        `✅ *Correct:* ${q.options[q.correctIndex]}\n\n📖 *Explanation:*\n${q.explanation}`,
        {parse_mode:'Markdown'}).catch(()=>{});
    }

    await store.del(`poll:${poll.id}`);

    if (sess.currentIndex >= quiz.questions.length) {
      await finalizeGroupQuiz(ctx, sess, quiz, pollMeta.chatId);
      await store.del(`session:${pollMeta.chatId}`);
      await store.del(`sqz:${sess.sessionId}`);
    } else {
      await sendQuestion(ctx, sess, quiz);
    }
  }

  // ─── FINALIZE — enhanced report ───────────────────────────────────────────────
  async function finalizeQuiz(ctx, sess, quiz, forced) {
    const total     = quiz?.questions?.length || 0;
    const attempted = sess.attempted || 0;
    const correct   = sess.correct   || 0;
    const wrong     = sess.wrong     || 0;
    const skipped   = total - attempted;
    const rawScore  = correct;
    const penalty   = wrong * (sess.settings?.negativeMarking||0);
    const finalSc   = Math.max(0, rawScore - penalty);
    const pct       = total>0 ? ((finalSc/total)*100).toFixed(1) : '0.0';
    const grade     = parseFloat(pct)>=90?'🏆 Excellent!':parseFloat(pct)>=70?'🥇 Good!':parseFloat(pct)>=50?'✅ Pass':'📚 Keep practicing';

    const timeTaken = Math.round((Date.now()-sess.startedAt)/1000);
    const mins      = Math.floor(timeTaken/60);
    const secs      = timeTaken%60;
    const timeStr   = mins>0?`${mins}m ${secs}s`:`${secs}s`;

    const nm        = sess.settings?.negativeMarking||0;
    const nmLine    = nm>0?`\n➖ Penalty       : -${penalty.toFixed(penalty%1===0?0:2)} (${wrong}×${nm})`:'';

    await ctx.api.sendMessage(sess.chatId,
      `${forced?'🛑':'🏁'} *Quiz ${forced?'Ended':'Complete'}!*\n` +
      `📚 ${quiz?.name||'Quiz'}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📊 *Result Report*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📝 Total Questions  : ${total}\n` +
      `✍️ Attempted        : ${attempted}\n` +
      `✅ Correct          : ${correct}\n` +
      `❌ Wrong            : ${wrong}\n` +
      `⏭️ Skipped          : ${skipped}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📈 Raw Score        : ${rawScore}/${total}${nmLine}\n` +
      `🎯 Final Score      : *${Number.isInteger(finalSc)?finalSc:finalSc.toFixed(2)}*/${total}\n` +
      `📊 Percentage       : *${pct}%*\n` +
      `🏅 Grade            : ${grade}\n` +
      `⏱️ Time Taken       : ${timeStr}`,
      { parse_mode:'Markdown' }
    ).catch(()=>{});
  }

  // ─── GROUP LEADERBOARD ────────────────────────────────────────────────────────
  async function finalizeGroupQuiz(ctx, sess, quiz, chatId) {
    const total   = quiz.questions.length;
    const entries = Object.entries(sess.participants||{})
      .sort(([,a],[,b])=>(b.score||0)-(a.score||0));

    const MEDALS = ['🥇','🥈','🥉'];
    let lb = `🏆 *${quiz.name} — Final Leaderboard*\n` +
      `❓ ${total} Questions\n` +
      `━━━━━━━━━━━━━━━━━━━━\n`;

    if (!entries.length) {
      lb += '\n_No one attempted the quiz._';
    } else {
      entries.slice(0,10).forEach(([uid,p],i)=>{
        const medal   = MEDALS[i]||`${i+1}.`;
        const name    = (p.name||`User ${uid}`).slice(0,20);
        const nm      = sess.settings?.negativeMarking||0;
        const penalty = (p.wrong||0)*nm;
        const finalSc = Math.max(0, (p.correct||0)-penalty);
        const scoreStr = Number.isInteger(finalSc)?finalSc:finalSc.toFixed(2);
        const pct     = total>0?Math.round((finalSc/total)*100):0;
        lb += `${medal} *${name}*: ${scoreStr}/${total} (${pct}%) ✅${p.correct||0} ❌${p.wrong||0}\n`;
      });
      lb += `━━━━━━━━━━━━━━━━━━━━\n👥 ${entries.length} participant${entries.length>1?'s':''}`;
    }

    await ctx.api.sendMessage(chatId, lb, {parse_mode:'Markdown'}).catch(()=>{});
  }

  // ─── ANONYMOUS POLLS BROADCAST ────────────────────────────────────────────────
  async function startAnonymousPolls(ctx, quiz) {
    const s     = await getUserSettings(ctx.from.id);
    const total = quiz.questions.length;
    await ctx.reply(`📊 Sending *${total}* anonymous polls from *${quiz.name}*…`, {parse_mode:'Markdown'});

    let sent = 0;
    for (let i=0; i<total; i++) {
      const q    = quiz.questions[i];
      const long = hasLongOptions(q.options);
      try {
        if (long) {
          // Send full question + options as text, then poll with A/B/C/D
          const contextLines = [`Q${i+1}/${total}: ${q.question}\n\nOptions:`];
          q.options.forEach((o,idx)=>contextLines.push(`  ${ALPHA[idx]}) ${o}`));
          await ctx.api.sendMessage(ctx.chat.id, contextLines.join('\n'));
        }
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
        if (i<total-1) await new Promise(r=>setTimeout(r,500));
      } catch(err) { console.error(`Poll Q${i+1} error:`, err.message); }
    }
    await ctx.reply(`✅ Sent ${sent}/${total} polls!`);
  }
  