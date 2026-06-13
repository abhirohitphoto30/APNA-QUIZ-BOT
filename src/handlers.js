import { InlineKeyboard } from 'grammy';
import { parseQuizText } from './parser.js';
import { store } from './store.js';
import { nanoid } from 'nanoid';

const TL_LABELS = {
  10:'10s',15:'15s',20:'20s',25:'25s',30:'30s',40:'40s',
  45:'45s',50:'50s',60:'1m',90:'1.5m',120:'2m',180:'3m',300:'5m',
};
const NM_OPTIONS = [0, 0.25, 0.33, 0.5, 1];
const ALPHA = ['A','B','C','D','E'];

function tlLabel(tl) { return TL_LABELS[tl] || tl + 's'; }
function truncate(t, n) { return !t ? '' : t.length <= n ? t : t.slice(0, n-1) + '\u2026'; }
function safePQ(t)   { return truncate(t, 300); }
function safePOpt(t) { return truncate(t, 100); }
function hasLong(opts) { return opts.some(o => o.length > 60); }
function generateQuizId() { return 'QUIZ_' + nanoid(6).toUpperCase().replace(/[^A-Z0-9]/g, 'X'); }

async function getUserSettings(uid) {
  return (await store.get('settings:' + uid)) || { negativeMarking: 0, timeLimit: 30, shuffle: false };
}
async function getSession(chatId)        { return store.get('session:' + chatId); }
async function saveSession(chatId, sess) { return store.set('session:' + chatId, sess, 7200); }
async function deleteSession(chatId) {
  const s = await getSession(chatId);
  if (s?.currentPollId) await store.del('poll:' + s.currentPollId);
  await store.del('session:' + chatId);
}

// Format: Q1/100: Q1. [question]
function contextHeader(num, total) {
  return 'Q' + num + '/' + total + ': Q' + num + '.';
}

// Get last non-empty line of question for poll title
function lastLine(question) {
  const lines = question.split('\n').map(l => l.trim()).filter(Boolean);
  return lines[lines.length - 1] || question;
}

// ─── /start ──────────────────────────────────────────────────────────────────
export async function handleStart(ctx) {
  const name = ctx.from.first_name || 'there';
  await ctx.reply(
    '\uD83D\uDC4B *Hello, ' + name + '!*\n\nWelcome to *Apna Quiz Bot* \uD83C\uDFAF\n\n' +
    '\uD83D\uDCE4 Send a *.txt* file \u2014 upload quiz questions\n' +
    '\uD83D\uDCDD /createquiz \u2014 format guide\n' +
    '\uD83D\uDCCB /myquizzes \u2014 your saved quizzes\n' +
    '\u25B6\uFE0F /startquiz <ID> \u2014 start a quiz\n' +
    '\uD83D\uDCCA /sendpoll <ID> \u2014 broadcast anonymous polls\n\n' +
    '*Mid-quiz:* /fast /slow /pause /end',
    { parse_mode: 'Markdown' }
  );
}

export async function handleHelp(ctx) {
  await ctx.reply(
    '\uD83D\uDCD6 *Help*\n\n' +
    '*Formats:*\nFormat 1: Q.1) Question\nFormat 2: Q1.Question / \uD83D\uDE02 separator\n' +
    'Mark correct with \u2705 | Explanation: Ex: ...\n\n' +
    '*Mid-quiz:* /fast +10s | /slow -10s | /pause | /end',
    { parse_mode: 'Markdown' }
  );
}

export async function handleCreateQuiz(ctx) {
  await ctx.reply(
    '\uD83D\uDCDD *Create a Quiz*\n\n' +
    '*Format 1 \u2014 Q.1) style:*\n' +
    '```\nQ.1) Which planet is closest to the Sun?\nVenus\nMercury \u2705\nMars\nEarth\nEx: Mercury is closest.\n```\n\n' +
    '*Format 2 \u2014 \uD83D\uDE02 separator:*\n' +
    '```\nQ1.Consider the following:\n1. Statement one\n\uD83D\uDE02\nOnly one \u2705\nOnly two\nEx: Explanation.\n```\n\n' +
    '\uD83D\uDCCC Mark correct with \u2705 | Explanation: Ex:\n\uD83D\uDC46 *Now send your .txt file!*',
    { parse_mode: 'Markdown' }
  );
}

// ─── DOCUMENT ────────────────────────────────────────────────────────────────
export async function handleDocument(ctx) {
  const doc = ctx.message.document;
  if (!doc.file_name?.toLowerCase().endsWith('.txt'))
    return ctx.reply('\u274C Please send a *.txt* file.', { parse_mode: 'Markdown' });
  if (doc.file_size > 5 * 1024 * 1024) return ctx.reply('\u274C File too large (max 5 MB).');
  const msg = await ctx.reply('\u23F3 Parsing quiz file\u2026');
  try {
    const file = await ctx.getFile();
    const url  = 'https://api.telegram.org/file/bot' + process.env.BOT_TOKEN + '/' + file.file_path;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Download failed');
    const questions = parseQuizText(await resp.text());
    if (!questions.length)
      return ctx.api.editMessageText(ctx.chat.id, msg.message_id,
        '\u274C No valid questions found. Use /createquiz to see supported formats.');
    if (questions.length > 300)
      return ctx.api.editMessageText(ctx.chat.id, msg.message_id,
        '\u274C Too many questions (' + questions.length + '). Max 300 per quiz.');
    await store.set('pending:' + ctx.from.id, { questions }, 600);
    await store.set('state:' + ctx.from.id,   { action: 'awaiting_quiz_name' }, 600);
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id,
      '\u2705 Found *' + questions.length + ' question' + (questions.length > 1 ? 's' : '') + '!*\n\n' +
      'Preview \u2014 Q1: _' + truncate(questions[0].question.split('\n')[0], 100) + '_\n\n' +
      '\uD83D\uDCDD *Send me a name for this quiz:*',
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('handleDocument:', err);
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, '\u274C Error reading file.').catch(() => {});
  }
}

// ─── TEXT (state machine) ────────────────────────────────────────────────────
export async function handleText(ctx) {
  const state = await store.get('state:' + ctx.from.id);
  if (!state) return;
  if (state.action === 'awaiting_quiz_name') {
    const name    = ctx.message.text.trim().slice(0, 100);
    const pending = await store.get('pending:' + ctx.from.id);
    if (!pending) return ctx.reply('\u23F0 Session expired. Upload the file again.');
    const quizId = generateQuizId();
    await store.set('quiz:' + quizId, { id: quizId, name, questions: pending.questions, createdBy: ctx.from.id, createdAt: Date.now() });
    const list = (await store.get('quizzes:' + ctx.from.id)) || [];
    list.unshift({ id: quizId, name, count: pending.questions.length, createdAt: Date.now() });
    if (list.length > 50) list.pop();
    await store.set('quizzes:' + ctx.from.id, list);
    await store.del('pending:' + ctx.from.id);
    await store.del('state:' + ctx.from.id);
    const kb = new InlineKeyboard()
      .text('\u25B6\uFE0F Start Quiz',    'confirmstart:' + quizId)
      .text('\uD83D\uDCCA Send as Polls', 'sendpoll:' + quizId);
    await ctx.reply(
      '\uD83C\uDF89 *Quiz saved!*\n\uD83D\uDCDA *' + name + '*\n\uD83C\uDD94 `' + quizId + '`\n\u2753 *' + pending.questions.length + '* questions',
      { parse_mode: 'Markdown', reply_markup: kb }
    );
  }
}

// ─── /myquizzes ──────────────────────────────────────────────────────────────
export async function handleMyQuizzes(ctx) {
  const list = (await store.get('quizzes:' + ctx.from.id)) || [];
  if (!list.length) return ctx.reply('\uD83D\uDCED No quizzes yet. Send a .txt file to create one!');
  let text = '\uD83D\uDCDA *Your Quizzes (' + list.length + ')*\n\n';
  const kb  = new InlineKeyboard();
  for (const q of list.slice(0, 10)) {
    const d = new Date(q.createdAt).toLocaleDateString('en-IN');
    text += '\uD83D\uDCDD *' + q.name + '*\n\uD83C\uDD94 `' + q.id + '` \u2022 \u2753 ' + q.count + ' Qs \u2022 \uD83D\uDCC5 ' + d + '\n\n';
    kb.text('\u25B6\uFE0F ' + q.name.slice(0, 25), 'showsettings:' + q.id).row();
  }
  await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb });
}

export async function handleStartQuizCommand(ctx) {
  const id = (ctx.message?.text || '').trim().split(/\s+/)[1]?.toUpperCase();
  if (!id) return ctx.reply('Usage: /startquiz QUIZ_XXXXXX');
  await showSettingsMenu(ctx, id);
}
export async function handleSendPollCommand(ctx) {
  const id   = (ctx.message?.text || '').trim().split(/\s+/)[1]?.toUpperCase();
  if (!id) return ctx.reply('Usage: /sendpoll QUIZ_XXXXXX');
  const quiz = await store.get('quiz:' + id);
  if (!quiz) return ctx.reply('\u274C Quiz not found: ' + id);
  await startAnonymousPolls(ctx, quiz);
}
export async function handleDeleteQuiz(ctx) {
  const id   = (ctx.message?.text || '').trim().split(/\s+/)[1]?.toUpperCase();
  if (!id) return ctx.reply('Usage: /deletequiz QUIZ_XXXXXX');
  const quiz = await store.get('quiz:' + id);
  if (!quiz) return ctx.reply('\u274C Quiz not found: ' + id);
  if (quiz.createdBy !== ctx.from.id) return ctx.reply('\u274C You can only delete your own quizzes.');
  await store.del('quiz:' + id);
  const list = ((await store.get('quizzes:' + ctx.from.id)) || []).filter(q => q.id !== id);
  await store.set('quizzes:' + ctx.from.id, list);
  await ctx.reply('\uD83D\uDDD1\uFE0F *' + quiz.name + '* deleted.', { parse_mode: 'Markdown' });
}
export async function handleStop(ctx) { return handleEndCommand(ctx); }

// ─── MID-QUIZ ─────────────────────────────────────────────────────────────────
export async function handleFastCommand(ctx) {
  const sess = await getSession(ctx.chat.id);
  if (!sess) return ctx.reply('\u26A0\uFE0F No active quiz.');
  sess.settings.timeLimit = Math.min(300, (sess.settings.timeLimit || 30) + 10);
  await saveSession(ctx.chat.id, sess);
  await ctx.reply('\u26A1 Timer \u2192 *' + tlLabel(sess.settings.timeLimit) + '*', { parse_mode: 'Markdown' });
}
export async function handleSlowCommand(ctx) {
  const sess = await getSession(ctx.chat.id);
  if (!sess) return ctx.reply('\u26A0\uFE0F No active quiz.');
  sess.settings.timeLimit = Math.max(10, (sess.settings.timeLimit || 30) - 10);
  await saveSession(ctx.chat.id, sess);
  await ctx.reply('\uD83D\uDC22 Timer \u2192 *' + tlLabel(sess.settings.timeLimit) + '*', { parse_mode: 'Markdown' });
}
export async function handleEndCommand(ctx) {
  const sess = await getSession(ctx.chat.id);
  if (!sess) return ctx.reply('\u26A0\uFE0F No active quiz.');
  const quiz = await store.get('sqz:' + sess.sessionId) || await store.get('quiz:' + sess.quizId);
  await sendFinalReport(ctx.api, sess, quiz, true);
  await deleteSession(ctx.chat.id);
  await store.del('sqz:' + sess.sessionId);
}
export async function handlePauseCommand(ctx) {
  const sess = await getSession(ctx.chat.id);
  if (!sess) return ctx.reply('\u26A0\uFE0F No active quiz.');
  if (sess.paused) return ctx.reply('Already paused.');
  sess.paused = true;
  await saveSession(ctx.chat.id, sess);
  const kb = new InlineKeyboard().text('\u25B6\uFE0F Resume Quiz', 'resumequiz:' + sess.sessionId);
  await ctx.reply('\u23F8\uFE0F *Quiz Paused!* Q' + ((sess.currentIndex || 0) + 1) + '/' + (sess.totalQuestions || '?'),
    { parse_mode: 'Markdown', reply_markup: kb });
}

// ─── SETTINGS MENU ────────────────────────────────────────────────────────────
export async function showSettingsMenu(ctx, quizId, editMsgId) {
  const quiz = await store.get('quiz:' + quizId);
  if (!quiz) {
    const m = '\u274C Quiz not found: ' + quizId;
    return editMsgId ? ctx.api.editMessageText(ctx.chat.id, editMsgId, m).catch(() => ctx.reply(m)) : ctx.reply(m);
  }
  const s  = await getUserSettings(ctx.from.id);
  const kb = new InlineKeyboard();
  kb.text('\u2796 Negative Marking', 'noop').row();
  for (const nm of NM_OPTIONS) {
    const lbl = nm === 0 ? 'None' : '-' + nm;
    kb.text(s.negativeMarking === nm ? '\u2705' + lbl : lbl, 'setnm:' + quizId + ':' + nm);
  }
  kb.row();
  kb.text('\u23F1\uFE0F Time per Question', 'noop').row();
  for (const tl of [10, 20, 30, 40, 50, 60])
    kb.text(s.timeLimit === tl ? '\u2705' + TL_LABELS[tl] : TL_LABELS[tl], 'settl:' + quizId + ':' + tl);
  kb.row();
  for (const tl of [90, 120, 180, 300])
    kb.text(s.timeLimit === tl ? '\u2705' + TL_LABELS[tl] : TL_LABELS[tl], 'settl:' + quizId + ':' + tl);
  kb.row();
  kb.text(s.shuffle ? '\uD83D\uDD00 Shuffle: ON \u2705' : '\uD83D\uDD00 Shuffle: OFF', 'setshuffle:' + quizId).row();
  kb.text('\u25B6\uFE0F Start Quiz',                'confirmstart:' + quizId).row();
  kb.text('\uD83D\uDCCA Broadcast Anonymous Polls', 'sendpoll:' + quizId).row();
  const nm   = s.negativeMarking === 0 ? 'None' : '-' + s.negativeMarking;
  const text = '\uD83D\uDCDA *' + quiz.name + '*\n\u2753 ' + quiz.questions.length + ' questions\n\n' +
    '\u2699\uFE0F *Settings*\n\u2796 Negative Marking: *' + nm + '*\n' +
    '\u23F1\uFE0F Timer: *' + tlLabel(s.timeLimit) + '*/question\n' +
    '\uD83D\uDD00 Shuffle: *' + (s.shuffle ? 'ON' : 'OFF') + '*\n\n_Choose mode below:_';
  const opts = { parse_mode: 'Markdown', reply_markup: kb };
  if (editMsgId)
    await ctx.api.editMessageText(ctx.chat.id, editMsgId, text, opts).catch(() => ctx.reply(text, opts));
  else
    await ctx.reply(text, opts);
}

// ─── CALLBACK ────────────────────────────────────────────────────────────────
export async function handleCallback(ctx) {
  const data = ctx.callbackQuery.data;
  await ctx.answerCallbackQuery().catch(() => {});
  if (data === 'noop') return;
  if (data.startsWith('setnm:')) {
    const [, quizId, nm] = data.split(':');
    const s = await getUserSettings(ctx.from.id);
    s.negativeMarking = parseFloat(nm);
    await store.set('settings:' + ctx.from.id, s);
    return showSettingsMenu(ctx, quizId, ctx.callbackQuery.message.message_id);
  }
  if (data.startsWith('settl:')) {
    const [, quizId, tl] = data.split(':');
    const s = await getUserSettings(ctx.from.id);
    s.timeLimit = parseInt(tl, 10);
    await store.set('settings:' + ctx.from.id, s);
    return showSettingsMenu(ctx, quizId, ctx.callbackQuery.message.message_id);
  }
  if (data.startsWith('setshuffle:')) {
    const s = await getUserSettings(ctx.from.id);
    s.shuffle = !s.shuffle;
    await store.set('settings:' + ctx.from.id, s);
    return showSettingsMenu(ctx, data.split(':')[1], ctx.callbackQuery.message.message_id);
  }
  if (data.startsWith('showsettings:'))
    return showSettingsMenu(ctx, data.split(':')[1], ctx.callbackQuery.message.message_id);
  if (data.startsWith('confirmstart:'))
    return startInteractiveQuiz(ctx, data.split(':')[1]);
  if (data.startsWith('sendpoll:')) {
    const quiz = await store.get('quiz:' + data.split(':')[1]);
    if (!quiz) return ctx.reply('\u274C Quiz not found.');
    return startAnonymousPolls(ctx, quiz);
  }
  if (data.startsWith('ans:')) {
    const parts = data.split(':');
    return handleInlineAnswer(ctx, parts[1], parseInt(parts[2], 10));
  }
  if (data.startsWith('resumequiz:'))
    return handleResume(ctx, data.split(':')[1]);
  if (data.startsWith('endquiz:')) {
    const sess = await getSession(ctx.chat.id);
    if (!sess || sess.sessionId !== data.split(':')[1]) return;
    const quiz = await store.get('sqz:' + sess.sessionId) || await store.get('quiz:' + sess.quizId);
    await sendFinalReport(ctx.api, sess, quiz, false);
    await deleteSession(ctx.chat.id);
    await store.del('sqz:' + sess.sessionId);
    return;
  }
  // Admin skip — advances group quiz if poll_closed update not received
  if (data.startsWith('skipq:')) {
    const [, sid, qIdxStr] = data.split(':');
    const sess = await getSession(ctx.chat.id);
    if (!sess || sess.sessionId !== sid) return;
    if (sess.startedBy !== ctx.from.id) {
      return ctx.answerCallbackQuery({ text: '\u26A0\uFE0F Only the quiz creator can skip!', show_alert: true }).catch(() => {});
    }
    const qIdx = parseInt(qIdxStr, 10);
    if (sess.skippedAt === qIdx) return;
    sess.skippedAt = qIdx;
    await saveSession(ctx.chat.id, sess);
    const quiz = await store.get('sqz:' + sid) || await store.get('quiz:' + sess.quizId);
    if (!quiz) return;
    if (sess.currentIndex >= quiz.questions.length) {
      await sendFinalReport(ctx.api, sess, quiz, false);
      await deleteSession(ctx.chat.id);
      await store.del('sqz:' + sid);
    } else {
      await sendQuestion(ctx.api, sess, quiz);
    }
    return;
  }
}

// ─── RESUME ──────────────────────────────────────────────────────────────────
async function handleResume(ctx, sessionId) {
  const sess = await getSession(ctx.chat.id);
  if (!sess || sess.sessionId !== sessionId) return ctx.reply('Session not found.');
  if (!sess.paused) return;
  sess.paused = false;
  await saveSession(ctx.chat.id, sess);
  const quiz = await store.get('sqz:' + sessionId) || await store.get('quiz:' + sess.quizId);
  if (!quiz) return ctx.reply('Quiz not found.');
  await ctx.reply('\u25B6\uFE0F *Quiz Resumed!*', { parse_mode: 'Markdown' });
  await sendQuestion(ctx.api, sess, quiz);
}

// ─── START INTERACTIVE QUIZ ───────────────────────────────────────────────────
async function startInteractiveQuiz(ctx, quizId) {
  const existing = await getSession(ctx.chat.id);
  if (existing) { await deleteSession(ctx.chat.id); await store.del('sqz:' + existing.sessionId); }
  const quiz = await store.get('quiz:' + quizId);
  if (!quiz) return ctx.reply('\u274C Quiz not found.');
  const s       = await getUserSettings(ctx.from.id);
  const sid     = nanoid(8);
  const isGroup = ctx.chat.type !== 'private';
  let questions = [...quiz.questions];
  if (s.shuffle) questions = questions.sort(() => Math.random() - 0.5);
  const sess = {
    sessionId: sid, quizId, chatId: ctx.chat.id, startedBy: ctx.from.id,
    currentIndex: 0, score: 0, attempted: 0, correct: 0, wrong: 0,
    settings: s, isGroup, participants: {},
    startedAt: Date.now(), totalQuestions: questions.length,
    paused: false, currentMsgId: 0, skippedAt: -1,
  };
  await store.set('sqz:' + sid, { ...quiz, questions }, 7200);
  await saveSession(ctx.chat.id, sess);
  const nm = s.negativeMarking === 0 ? 'None' : '-' + s.negativeMarking;
  await ctx.reply(
    '\uD83D\uDE80 *' + quiz.name + '* started!\n' +
    '\u2753 ' + questions.length + ' Qs | \u23F1\uFE0F ' + tlLabel(s.timeLimit) + '/Q | \u2796 ' + nm + ' | \uD83D\uDD00 ' + (s.shuffle ? 'Shuffled' : 'In order') + '\n\n' +
    (isGroup ? '_Everyone can participate! Leaderboard at end._' : '_Tap an option to answer!_') + '\n' +
    '_Commands: /fast /slow /pause /end_',
    { parse_mode: 'Markdown' }
  );
  await sendQuestion(ctx.api, sess, { ...quiz, questions });
}

// ─── SEND QUESTION ────────────────────────────────────────────────────────────
// SAME format in BOTH private and group:
//   ONE message = contextHeader + full question text (newlines preserved)
//                 + A) B) C) D) if options are long
//                 + inline keyboard buttons
// Group additionally sends a Telegram native quiz poll + admin skip button.
async function sendQuestion(api, session, quiz) {
  if (session.paused) return;
  const q     = quiz.questions[session.currentIndex];
  const total = quiz.questions.length;
  const num   = session.currentIndex + 1;
  const { settings, isGroup, chatId } = session;
  const long  = hasLong(q.options);
  // Build message text
  let msgText = contextHeader(num, total) + ' ' + q.question;
  if (long) {
    msgText += '\n\nOptions:';
    q.options.forEach((o, i) => { msgText += '\n  ' + ALPHA[i] + ') ' + o; });
  }
  // Build keyboard
  const kb = new InlineKeyboard();
  if (long) {
    q.options.forEach((_, i) => kb.text(ALPHA[i], 'ans:' + session.sessionId + ':' + i));
    kb.row();
  } else {
    q.options.forEach((o, i) => kb.text(o.slice(0, 64), 'ans:' + session.sessionId + ':' + i).row());
  }
  kb.text('\uD83D\uDED1 End Quiz', 'endquiz:' + session.sessionId);
  // Send the question message
  const sentMsg = await api.sendMessage(chatId, msgText, { reply_markup: kb });
  session.currentMsgId = sentMsg.message_id;
  if (isGroup) {
    // Send native quiz poll (for the timer and poll UI)
    const pollTitle   = safePQ('[' + num + '/' + total + '] ' + lastLine(q.question));
    const pollOptions = long ? q.options.map((_, i) => ALPHA[i]) : q.options.map(o => safePOpt(o));
    try {
      const pollMsg = await api.sendPoll(chatId, pollTitle, pollOptions, {
        type: 'quiz', correct_option_id: q.correctIndex,
        is_anonymous: false, open_period: settings.timeLimit,
        explanation: q.explanation ? truncate(q.explanation, 200) : undefined,
      });
      await store.set('poll:' + pollMsg.poll.id, {
        chatId, questionIndex: session.currentIndex, sessionId: session.sessionId,
      }, settings.timeLimit + 180);
      session.currentPollId = pollMsg.poll.id;
    } catch (pollErr) {
      console.error('Poll send failed:', pollErr.message);
    }
    // Admin skip button (fallback if poll_closed update not received)
    const skipKb = new InlineKeyboard()
      .text('\u23ED\uFE0F Next Question (Admin Only)', 'skipq:' + session.sessionId + ':' + session.currentIndex);
    await api.sendMessage(chatId,
      '\u23F1\uFE0F Q' + num + '/' + total + ' \u2014 ' + tlLabel(settings.timeLimit),
      { reply_markup: skipKb }
    ).catch(() => {});
  }
  session.currentIndex++;
  await saveSession(chatId, session);
}

// ─── HANDLE INLINE ANSWER ────────────────────────────────────────────────────
async function handleInlineAnswer(ctx, sessionId, optionIdx) {
  const sess = await getSession(ctx.chat.id);
  if (!sess || sess.sessionId !== sessionId) return;
  const quiz = await store.get('sqz:' + sessionId) || await store.get('quiz:' + sess.quizId);
  if (!quiz) return;
  const qIdx = sess.currentIndex - 1;
  const q    = quiz.questions[qIdx];
  if (!q) return;
  const userId    = ctx.from.id;
  const userName  = ctx.from.first_name || 'Player';
  const isCorrect = optionIdx === q.correctIndex;
  const long      = hasLong(q.options);
  if (sess.isGroup) {
    if (!sess.participants[userId])
      sess.participants[userId] = { score: 0, correct: 0, wrong: 0, name: userName };
    if (sess.participants[userId]['q' + qIdx] !== undefined) {
      return ctx.answerCallbackQuery({ text: 'You already answered!', show_alert: false }).catch(() => {});
    }
    sess.participants[userId]['q' + qIdx] = isCorrect;
    const sc = isCorrect ? 1 : -sess.settings.negativeMarking;
    sess.participants[userId].score   = (sess.participants[userId].score || 0) + sc;
    if (isCorrect) sess.participants[userId].correct = (sess.participants[userId].correct || 0) + 1;
    else           sess.participants[userId].wrong   = (sess.participants[userId].wrong || 0) + 1;
    await saveSession(ctx.chat.id, sess);
  } else {
    const sc = isCorrect ? 1 : -sess.settings.negativeMarking;
    sess.score     = (sess.score || 0) + sc;
    sess.attempted = (sess.attempted || 0) + 1;
    if (isCorrect) sess.correct = (sess.correct || 0) + 1;
    else           sess.wrong   = (sess.wrong || 0) + 1;
    await saveSession(ctx.chat.id, sess);
  }
  await ctx.answerCallbackQuery({ text: isCorrect ? '\u2705 Correct!' : '\u274C Wrong!', show_alert: false }).catch(() => {});
  // Edit question message to show result
  const sc    = Math.max(0, sess.score || 0);
  const scStr = sess.isGroup ? '' : (Number.isInteger(sc) ? String(sc) : sc.toFixed(2));
  const num   = qIdx + 1;
  const total = quiz.questions.length;
  let editText = contextHeader(num, total) + ' ' + q.question + '\n\n';
  q.options.forEach((o, i) => {
    const lbl = long ? ALPHA[i] + ') ' + o : o;
    if (i === optionIdx && isCorrect)        editText += '\u2705 ' + lbl + ' \u2190 Correct \u2713\n';
    else if (i === optionIdx && !isCorrect)  editText += '\u274C ' + lbl + ' \u2190 Your answer \u2717\n';
    else if (i === q.correctIndex)           editText += '\u2611\uFE0F ' + lbl + ' \u2190 Correct answer\n';
    else                                     editText += '\u25AB\uFE0F ' + lbl + '\n';
  });
  if (scStr) editText += '\n\uD83C\uDFAF Score: ' + scStr;
  if (sess.currentMsgId) {
    await ctx.api.editMessageText(sess.chatId, sess.currentMsgId, editText).catch(() => {});
  }
  // Explanation as SEPARATE message
  if (q.explanation) {
    await ctx.api.sendMessage(sess.chatId, '\uD83D\uDCD6 Explanation:\n' + q.explanation).catch(() => {});
  }
  // Private: auto-advance; Group: waits for poll_closed or admin skip
  if (!sess.isGroup) {
    if (sess.currentIndex >= quiz.questions.length) {
      await sendFinalReport(ctx.api, sess, quiz, false);
      await deleteSession(ctx.chat.id);
      await store.del('sqz:' + sessionId);
    } else {
      await new Promise(r => setTimeout(r, 800));
      await sendQuestion(ctx.api, sess, quiz);
    }
  }
}

// ─── POLL ANSWER ─────────────────────────────────────────────────────────────
export async function handlePollAnswer(ctx) {
  const pa = ctx.pollAnswer;
  if (!pa) return;
  const pollMeta = await store.get('poll:' + pa.poll_id);
  if (!pollMeta) return;
  const sess = await getSession(pollMeta.chatId);
  if (!sess) return;
  const quiz = await store.get('sqz:' + sess.sessionId) || await store.get('quiz:' + sess.quizId);
  if (!quiz) return;
  const qIdx      = pollMeta.questionIndex;
  const q         = quiz.questions[qIdx];
  if (!q) return;
  const userId    = pa.user.id;
  const optionIdx = pa.option_ids?.[0] ?? -1;
  const isCorrect = optionIdx === q.correctIndex;
  if (!sess.participants) sess.participants = {};
  if (!sess.participants[userId])
    sess.participants[userId] = { score: 0, correct: 0, wrong: 0, name: pa.user.first_name || 'User' + userId };
  if (sess.participants[userId]['q' + qIdx] !== undefined) return;
  sess.participants[userId]['q' + qIdx] = isCorrect;
  const sc = isCorrect ? 1 : -sess.settings.negativeMarking;
  sess.participants[userId].score  = (sess.participants[userId].score || 0) + sc;
  if (isCorrect) sess.participants[userId].correct = (sess.participants[userId].correct || 0) + 1;
  else           sess.participants[userId].wrong   = (sess.participants[userId].wrong || 0) + 1;
  await saveSession(pollMeta.chatId, sess);
}

// ─── POLL CLOSED ─────────────────────────────────────────────────────────────
export async function handlePollClosed(ctx) {
  const poll = ctx.poll;
  if (!poll?.is_closed) return;
  const pollMeta = await store.get('poll:' + poll.id);
  if (!pollMeta) return;
  await store.del('poll:' + poll.id);
  const sess = await getSession(pollMeta.chatId);
  if (!sess) return;
  // Skip if admin already advanced this question
  if (typeof sess.skippedAt === 'number' && sess.skippedAt === pollMeta.questionIndex) return;
  const quiz = await store.get('sqz:' + sess.sessionId) || await store.get('quiz:' + sess.quizId);
  if (!quiz) return;
  const q = quiz.questions[pollMeta.questionIndex];
  // Send explanation as separate message
  if (q) {
    const correctOpt = hasLong(q.options)
      ? ALPHA[q.correctIndex] + ') ' + q.options[q.correctIndex]
      : q.options[q.correctIndex];
    let expMsg = '\u2705 Correct Answer: ' + correctOpt;
    if (q.explanation) expMsg += '\n\n\uD83D\uDCD6 Explanation:\n' + q.explanation;
    await ctx.api.sendMessage(pollMeta.chatId, expMsg).catch(err => {
      console.error('Explanation send error:', err.message);
    });
  }
  // Advance quiz
  if (sess.currentIndex >= quiz.questions.length) {
    await sendFinalReport(ctx.api, sess, quiz, false);
    await store.del('session:' + pollMeta.chatId);
    await store.del('sqz:' + sess.sessionId);
  } else {
    await new Promise(r => setTimeout(r, 1000));
    await sendQuestion(ctx.api, sess, quiz);
  }
}

// ─── FINAL REPORT ────────────────────────────────────────────────────────────
async function sendFinalReport(api, sess, quiz, forced) {
  if (sess.isGroup) {
    const total   = quiz?.questions?.length || 0;
    const entries = Object.entries(sess.participants || {}).sort(([,a],[,b]) => (b.score||0)-(a.score||0));
    const MEDALS = ['\uD83E\uDD47','\uD83E\uDD48','\uD83E\uDD49'];
    let lb = (forced ? '\uD83D\uDED1' : '\uD83C\uDFC6') + ' *' + (quiz?.name||'Quiz') + ' \u2014 ' + (forced ? 'Quiz Stopped' : 'Final Leaderboard') + '*\n\u2753 ' + total + ' Questions\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n';
    if (!entries.length) {
      lb += '\n_No one attempted the quiz._';
    } else {
      entries.slice(0, 10).forEach(([uid, p], i) => {
        const medal   = MEDALS[i] || (i+1)+'.';
        const name    = (p.name||'Player').slice(0,20);
        const nm      = sess.settings?.negativeMarking || 0;
        const penalty = (p.wrong||0) * nm;
        const final   = Math.max(0, (p.correct||0) - penalty);
        const fs      = Number.isInteger(final) ? final : final.toFixed(2);
        const pct     = total > 0 ? Math.round((final/total)*100) : 0;
        lb += medal + ' *' + name + '*: ' + fs + '/' + total + ' (' + pct + '%) \u2705' + (p.correct||0) + ' \u274C' + (p.wrong||0) + '\n';
      });
      lb += '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\uD83D\uDC65 ' + entries.length + ' participant' + (entries.length>1?'s':'');
    }
    await api.sendMessage(sess.chatId, lb, { parse_mode: 'Markdown' }).catch(() => {});
  } else {
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
    const grade    = parseFloat(pct)>=90?'\uD83C\uDFC6 Excellent!':parseFloat(pct)>=70?'\uD83E\uDD47 Good!':parseFloat(pct)>=50?'\u2705 Pass':'\uD83D\uDCDA Keep practicing';
    const elapsed  = Math.round((Date.now() - sess.startedAt)/1000);
    const mins     = Math.floor(elapsed/60);
    const secs     = elapsed%60;
    const timeStr  = mins>0 ? mins+'m '+secs+'s' : secs+'s';
    const nmLine   = nm > 0 ? '\n\u2796 Penalty         : -' + (penalty%1===0?penalty:penalty.toFixed(2)) + ' ('+wrong+'\u00D7'+nm+')' : '';
    await api.sendMessage(sess.chatId,
      (forced?'\uD83D\uDED1':'\uD83C\uDFC1') + ' *Quiz ' + (forced?'Ended':'Complete') + '!*\n' +
      '\uD83D\uDCDA ' + (quiz?.name||'Quiz') + '\n' +
      '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n' +
      '\uD83D\uDCCA *Result Report*\n' +
      '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n' +
      '\uD83D\uDCDD Total Questions   : ' + total + '\n' +
      '\u270D\uFE0F Attempted          : ' + attempted + '\n' +
      '\u2705 Correct            : ' + correct + '\n' +
      '\u274C Wrong              : ' + wrong + '\n' +
      '\u23ED\uFE0F Skipped            : ' + skipped + '\n' +
      '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n' +
      '\uD83D\uDCC8 Raw Score          : ' + correct + '/' + total + nmLine + '\n' +
      '\uD83C\uDFAF Final Score        : *' + fs + '*/' + total + '\n' +
      '\uD83D\uDCCA Percentage         : *' + pct + '%*\n' +
      '\uD83C\uDF85 Grade              : ' + grade + '\n' +
      '\u23F1\uFE0F Time Taken         : ' + timeStr,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }
}

// ─── ANONYMOUS POLLS BROADCAST ────────────────────────────────────────────────
async function startAnonymousPolls(ctx, quiz) {
  const s     = await getUserSettings(ctx.from.id);
  const total = quiz.questions.length;
  await ctx.reply('\uD83D\uDCCA Sending *' + total + '* anonymous polls from *' + quiz.name + '*\u2026', { parse_mode: 'Markdown' });
  let sent = 0;
  for (let i = 0; i < total; i++) {
    const q    = quiz.questions[i];
    const long = hasLong(q.options);
    try {
      let contextText = contextHeader(i+1, total) + ' ' + q.question;
      if (long) {
        contextText += '\n\nOptions:';
        q.options.forEach((o, idx) => { contextText += '\n  ' + ALPHA[idx] + ') ' + o; });
      }
      await ctx.api.sendMessage(ctx.chat.id, contextText);
      const pollTitle   = safePQ('[' + (i+1) + '/' + total + '] ' + lastLine(q.question));
      const pollOptions = long ? q.options.map((_, idx) => ALPHA[idx]) : q.options.map(o => safePOpt(o));
      await ctx.api.sendPoll(ctx.chat.id, pollTitle, pollOptions, {
        type: 'quiz', correct_option_id: q.correctIndex,
        is_anonymous: true, open_period: s.timeLimit,
        explanation: q.explanation ? truncate(q.explanation, 200) : undefined,
      });
      sent++;
      if (i < total - 1) await new Promise(r => setTimeout(r, 600));
    } catch (err) { console.error('Poll Q' + (i+1) + ' error:', err.message); }
  }
  await ctx.reply('\u2705 Sent ' + sent + '/' + total + ' polls successfully!');
}