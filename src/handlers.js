import { InlineKeyboard } from 'grammy';
import { parseQuizText } from './parser.js';
import { store } from './store.js';
import { nanoid } from 'nanoid';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const TL_LABELS = {
  10: '10s', 20: '20s', 30: '30s', 40: '40s',
  50: '50s', 60: '1m', 90: '1.5m', 120: '2m',
  180: '3m', 300: '5m',
};
const NM_OPTIONS = [0, 0.25, 0.33, 0.5, 1];
const TL_OPTIONS = [10, 20, 30, 40, 50, 60, 90, 120, 180, 300];

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
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

function scoreText(score, total, negativeMarking) {
  const maxScore = total;
  const pct = Math.round((score / maxScore) * 100);
  let grade = pct >= 90 ? '🏆 Excellent!' : pct >= 70 ? '🥇 Good!' : pct >= 50 ? '✅ Pass' : '❌ Needs work';
  return `*Score: ${score}/${maxScore}* (${pct}%) ${grade}`;
}

function truncate(text, max = 100) {
  if (!text) return '';
  return text.length <= max ? text : text.slice(0, max - 1) + '…';
}

// ─────────────────────────────────────────────
// /start
// ─────────────────────────────────────────────
export async function handleStart(ctx) {
  const name = ctx.from.first_name || 'there';
  await ctx.reply(
    `👋 *Hello, ${name}!*\n\nWelcome to *Apna Quiz Bot* — your smart quiz companion.\n\n` +
    `📤 *Send a .txt file* to create a quiz\n` +
    `📋 /myquizzes — see your saved quizzes\n` +
    `▶️ /startquiz <ID> — start a quiz\n` +
    `📊 /sendpoll <ID> — send as anonymous polls\n` +
    `ℹ️ /help — detailed help\n\n` +
    `_Supports both multi-line (😂 separator) and single-line question formats._`,
    { parse_mode: 'Markdown' }
  );
}

// ─────────────────────────────────────────────
// /help
// ─────────────────────────────────────────────
export async function handleHelp(ctx) {
  await ctx.reply(
    `📖 *How to use Apna Quiz Bot*\n\n` +
    `*Step 1 — Upload*\nSend a .txt file with questions in the supported format.\n\n` +
    `*Step 2 — Name your quiz*\nThe bot will ask for a quiz name.\n\n` +
    `*Step 3 — Play!*\n` +
    `• In *private chat*: questions come instantly after each answer\n` +
    `• In *groups*: bot sends a timed poll; next question after the timer\n\n` +
    `*Supported .txt formats:*\n` +
    `Format 1 (😂 separator):\n` +
    `\`\`\`\nQ1.Question text\n😂\nOption A ✅\nOption B\nEx: explanation\n\`\`\`\n\n` +
    `Format 2 (Q.1) style):\n` +
    `\`\`\`\nQ.1) Question 1️⃣ stmt\nOption A\nOption B ✅\nEx: explanation\n\`\`\`\n\n` +
    `*Commands*\n` +
    `/myquizzes — list all your quizzes\n` +
    `/startquiz <ID> — start interactive quiz\n` +
    `/sendpoll <ID> — broadcast as anon polls\n` +
    `/deletequiz <ID> — delete a quiz\n` +
    `/stop — stop current quiz\n`,
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
  if (doc.file_size > 5 * 1024 * 1024) {
    return ctx.reply('❌ File too large (max 5 MB).');
  }

  const msg = await ctx.reply('⏳ Parsing quiz file…');

  try {
    const file = await ctx.getFile();
    const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Download failed');
    const text = await resp.text();

    const questions = parseQuizText(text);

    if (questions.length === 0) {
      return ctx.api.editMessageText(
        ctx.chat.id, msg.message_id,
        '❌ No valid questions found. Check your file format.\n\nUse /help to see supported formats.'
      );
    }
    if (questions.length > 300) {
      return ctx.api.editMessageText(
        ctx.chat.id, msg.message_id,
        `❌ Too many questions (${questions.length}). Max 300 per quiz.`
      );
    }

    await store.set(`pending:${ctx.from.id}`, { questions }, 600);
    await store.set(`state:${ctx.from.id}`, { action: 'awaiting_quiz_name' }, 600);

    await ctx.api.editMessageText(
      ctx.chat.id, msg.message_id,
      `✅ Found *${questions.length} question${questions.length > 1 ? 's' : ''}!*\n\n` +
      `Preview — Q1: _${truncate(questions[0].question, 120)}_\n\n` +
      `📝 *Send me a name for this quiz:*`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('handleDocument error:', err);
    await ctx.api.editMessageText(
      ctx.chat.id, msg.message_id,
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
    const quiz = {
      id: quizId,
      name,
      questions: pending.questions,
      createdBy: ctx.from.id,
      createdAt: Date.now(),
    };

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
      `🎉 *Quiz saved!*\n\n` +
      `📚 *${name}*\n` +
      `🆔 ID: \`${quizId}\`\n` +
      `❓ Questions: *${pending.questions.length}*\n\n` +
      `_Share the ID with others so they can play too!_`,
      { parse_mode: 'Markdown', reply_markup: kb }
    );
  }
}

// ─────────────────────────────────────────────
// /myquizzes
// ─────────────────────────────────────────────
export async function handleMyQuizzes(ctx) {
  const list = (await store.get(`quizzes:${ctx.from.id}`)) || [];
  if (list.length === 0) {
    return ctx.reply('📭 No quizzes yet.\n\nSend me a .txt file to create your first quiz!');
  }

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

// ─────────────────────────────────────────────
// /startquiz <ID>
// ─────────────────────────────────────────────
export async function handleStartQuizCommand(ctx) {
  const parts = (ctx.message?.text || '').trim().split(/\s+/);
  const quizId = parts[1]?.toUpperCase();
  if (!quizId) return ctx.reply('Usage: /startquiz QUIZ_XXXXXX\n\nUse /myquizzes to see your quizzes.');
  await showSettingsMenu(ctx, quizId);
}

// ─────────────────────────────────────────────
// /sendpoll <ID>
// ─────────────────────────────────────────────
export async function handleSendPollCommand(ctx) {
  const parts = (ctx.message?.text || '').trim().split(/\s+/);
  const quizId = parts[1]?.toUpperCase();
  if (!quizId) return ctx.reply('Usage: /sendpoll QUIZ_XXXXXX');

  const quiz = await store.get(`quiz:${quizId}`);
  if (!quiz) return ctx.reply(`❌ Quiz not found: ${quizId}`);

  await startAnonymousPolls(ctx, quiz);
}

// ─────────────────────────────────────────────
// /deletequiz <ID>
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// /stop
// ─────────────────────────────────────────────
export async function handleStop(ctx) {
  const sess = await getSession(ctx.chat.id);
  if (!sess) return ctx.reply('No active quiz in this chat.');
  await deleteSession(ctx.chat.id);
  await ctx.reply('🛑 Quiz stopped.');
}

// ─────────────────────────────────────────────
// SETTINGS MENU (shown before starting)
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

  // Negative marking row
  kb.text('— Negative Marking —', 'noop').row();
  for (const nm of NM_OPTIONS) {
    const label = nm === 0 ? 'None' : `-${nm}`;
    const active = settings.negativeMarking === nm;
    kb.text(active ? `✅ ${label}` : label, `setnm:${quizId}:${nm}`);
  }
  kb.row();

  // Time limit rows
  kb.text('— Time Limit —', 'noop').row();
  const tlRow1 = [10, 20, 30, 40, 50, 60];
  for (const tl of tlRow1) {
    const active = settings.timeLimit === tl;
    kb.text(active ? `✅ ${TL_LABELS[tl]}` : TL_LABELS[tl], `settl:${quizId}:${tl}`);
  }
  kb.row();
  const tlRow2 = [90, 120, 180, 300];
  for (const tl of tlRow2) {
    const active = settings.timeLimit === tl;
    kb.text(active ? `✅ ${TL_LABELS[tl]}` : TL_LABELS[tl], `settl:${quizId}:${tl}`);
  }
  kb.row();

  // Action buttons
  kb.text('▶️ Start Interactive Quiz', `confirmstart:${quizId}:0`).row();
  kb.text('📊 Broadcast Anonymous Polls', `sendpoll:${quizId}:0`).row();

  const nmText = settings.negativeMarking === 0 ? 'None' : `-${settings.negativeMarking}`;
  const text =
    `📚 *${quiz.name}*\n` +
    `❓ ${quiz.questions.length} questions\n\n` +
    `⚙️ *Settings*\n` +
    `➖ Negative Marking: *${nmText}* per wrong answer\n` +
    `⏱️ Time Limit: *${TL_LABELS[settings.timeLimit]}* per question\n\n` +
    `_Choose mode below:_`;

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

  // setnm:QUIZ_XXX:0.25
  if (data.startsWith('setnm:')) {
    const [, quizId, nmStr] = data.split(':');
    const nm = parseFloat(nmStr);
    const settings = await getUserSettings(ctx.from.id);
    settings.negativeMarking = nm;
    await store.set(`settings:${ctx.from.id}`, settings);
    await showSettingsMenu(ctx, quizId, ctx.callbackQuery.message.message_id);
    return;
  }

  // settl:QUIZ_XXX:30
  if (data.startsWith('settl:')) {
    const [, quizId, tlStr] = data.split(':');
    const tl = parseInt(tlStr, 10);
    const settings = await getUserSettings(ctx.from.id);
    settings.timeLimit = tl;
    await store.set(`settings:${ctx.from.id}`, settings);
    await showSettingsMenu(ctx, quizId, ctx.callbackQuery.message.message_id);
    return;
  }

  // showsettings:QUIZ_XXX
  if (data.startsWith('showsettings:')) {
    const quizId = data.split(':')[1];
    await showSettingsMenu(ctx, quizId, ctx.callbackQuery.message.message_id);
    return;
  }

  // confirmstart:QUIZ_XXX:0  (last segment = starting question index)
  if (data.startsWith('confirmstart:')) {
    const parts = data.split(':');
    const quizId = parts[1];
    const startIdx = parseInt(parts[2] || '0', 10);
    await startInteractiveQuiz(ctx, quizId, startIdx);
    return;
  }

  // sendpoll:QUIZ_XXX:0
  if (data.startsWith('sendpoll:')) {
    const parts = data.split(':');
    const quizId = parts[1];
    const quiz = await store.get(`quiz:${quizId}`);
    if (!quiz) return ctx.reply('❌ Quiz not found: ' + quizId);
    await startAnonymousPolls(ctx, quiz);
    return;
  }

  // ans:sessionId:optionIndex
  if (data.startsWith('ans:')) {
    const [, sessionId, optIdxStr] = data.split(':');
    await handleInlineAnswer(ctx, sessionId, parseInt(optIdxStr, 10));
    return;
  }

  // nextq:sessionId
  if (data.startsWith('nextq:')) {
    const sessionId = data.split(':')[1];
    await handleNextQuestion(ctx, sessionId);
    return;
  }

  // endquiz:sessionId
  if (data.startsWith('endquiz:')) {
    const sessionId = data.split(':')[1];
    const sess = await getSession(ctx.chat.id);
    if (sess?.sessionId !== sessionId) return;
    await finalizeQuiz(ctx, sess);
    await deleteSession(ctx.chat.id);
    return;
  }
}

// ─────────────────────────────────────────────
// INTERACTIVE QUIZ (inline keyboards)
// ─────────────────────────────────────────────
async function startInteractiveQuiz(ctx, quizId, startIdx = 0) {
  const existing = await getSession(ctx.chat.id);
  if (existing) {
    await deleteSession(ctx.chat.id);
  }

  const quiz = await store.get(`quiz:${quizId}`);
  if (!quiz) return ctx.reply('❌ Quiz not found.');

  const settings = await getUserSettings(ctx.from.id);
  const sessionId = nanoid(8);
  const isGroup = ctx.chat.type !== 'private';

  const session = {
    sessionId,
    quizId,
    chatId: ctx.chat.id,
    startedBy: ctx.from.id,
    currentIndex: startIdx,
    score: 0,
    attempted: 0,
    correct: 0,
    wrong: 0,
    settings,
    isGroup,
    participants: {},
    startedAt: Date.now(),
  };

  await saveSession(ctx.chat.id, session);

  const nmText = settings.negativeMarking === 0 ? 'none' : `-${settings.negativeMarking}`;
  await ctx.reply(
    `🚀 *${quiz.name}* started!\n` +
    `❓ ${quiz.questions.length} questions | ⏱️ ${TL_LABELS[settings.timeLimit]} each | ➖ Negative: ${nmText}\n\n` +
    `_${isGroup ? 'Everyone can participate! Scores tracked per user.' : 'Answer each question to proceed.'}_`,
    { parse_mode: 'Markdown' }
  );

  await sendQuestion(ctx, session, quiz);
}

async function sendQuestion(ctx, session, quiz) {
  const q = quiz.questions[session.currentIndex];
  const total = quiz.questions.length;
  const num = session.currentIndex + 1;
  const settings = session.settings;
  const isGroup = session.isGroup;

  if (isGroup) {
    // GROUP: native Telegram quiz poll with open_period timer
    const pollMsg = await ctx.api.sendPoll(session.chatId, q.question, q.options, {
      type: 'quiz',
      correct_option_id: q.correctIndex,
      is_anonymous: false,
      open_period: settings.timeLimit,
      explanation: q.explanation
        ? truncate(q.explanation, 200)
        : undefined,
      protect_content: false,
    });

    // Map poll → session for poll_answer handling
    await store.set(`poll:${pollMsg.poll.id}`, {
      chatId: session.chatId,
      questionIndex: session.currentIndex,
    }, settings.timeLimit + 60);

    session.currentPollId = pollMsg.poll.id;
    session.currentIndex++;

    const header = await ctx.api.sendMessage(
      session.chatId,
      `❓ *Q${num}/${total}* ⏱️ ${TL_LABELS[settings.timeLimit]}`,
      { parse_mode: 'Markdown' }
    );

    session.lastHeaderMsgId = header.message_id;
    await saveSession(session.chatId, session);

  } else {
    // PRIVATE: inline keyboard buttons
    const kb = new InlineKeyboard();
    q.options.forEach((opt, i) => {
      kb.text(opt, `ans:${session.sessionId}:${i}`).row();
    });
    kb.text('🛑 End Quiz', `endquiz:${session.sessionId}`);

    await ctx.api.sendMessage(
      session.chatId,
      `❓ *Q${num}/${total}*  ⏱️ ${TL_LABELS[settings.timeLimit]}\n\n${q.question}`,
      { parse_mode: 'Markdown', reply_markup: kb }
    );
  }
}

async function handleInlineAnswer(ctx, sessionId, optionIdx) {
  const sess = await getSession(ctx.chat.id);
  if (!sess || sess.sessionId !== sessionId) return;

  const quiz = await store.get(`quiz:${sess.quizId}`);
  if (!quiz) return;

  const qIdx = sess.currentIndex - (sess.isGroup ? 0 : 0);
  // For private chat, currentIndex hasn't advanced yet
  const questionIndex = sess.isGroup ? sess.currentIndex - 1 : sess.currentIndex;
  const q = quiz.questions[questionIndex];
  if (!q) return;

  const userId = ctx.from.id;
  const userName = ctx.from.first_name || 'Player';
  const isCorrect = optionIdx === q.correctIndex;

  // Prevent double-answering in group
  if (sess.isGroup) {
    if (!sess.participants[userId]) sess.participants[userId] = { score: 0, correct: 0, wrong: 0 };
    if (sess.participants[userId][`q${questionIndex}`] !== undefined) {
      return ctx.answerCallbackQuery({ text: 'You already answered this question!', show_alert: false }).catch(() => {});
    }
    sess.participants[userId][`q${questionIndex}`] = isCorrect;
  }

  const feedback = isCorrect ? '✅ Correct!' : `❌ Wrong! Correct: *${q.options[q.correctIndex]}*`;
  const scoreChange = isCorrect ? 1 : -sess.settings.negativeMarking;

  if (sess.isGroup) {
    if (!sess.participants[userId]) sess.participants[userId] = { score: 0, correct: 0, wrong: 0 };
    sess.participants[userId].score = (sess.participants[userId].score || 0) + scoreChange;
    if (isCorrect) sess.participants[userId].correct = (sess.participants[userId].correct || 0) + 1;
    else sess.participants[userId].wrong = (sess.participants[userId].wrong || 0) + 1;
  } else {
    sess.score = (sess.score || 0) + scoreChange;
    sess.attempted = (sess.attempted || 0) + 1;
    if (isCorrect) sess.correct = (sess.correct || 0) + 1;
    else sess.wrong = (sess.wrong || 0) + 1;
  }

  await ctx.answerCallbackQuery({
    text: isCorrect ? '✅ Correct!' : '❌ Wrong answer',
    show_alert: true,
  }).catch(() => {});

  let expMsg = feedback;
  if (q.explanation) expMsg += `\n\n📖 *Explanation:*\n${q.explanation}`;

  await ctx.api.sendMessage(session.chatId || sess.chatId, expMsg, { parse_mode: 'Markdown' }).catch(() => {});

  if (!sess.isGroup) {
    sess.currentIndex++;
    await saveSession(ctx.chat.id, sess);

    if (sess.currentIndex >= quiz.questions.length) {
      await finalizeQuiz(ctx, sess);
      await deleteSession(ctx.chat.id);
    } else {
      await sendQuestion(ctx, sess, quiz);
    }
  } else {
    await saveSession(ctx.chat.id, sess);
  }
}

async function handleNextQuestion(ctx, sessionId) {
  const sess = await getSession(ctx.chat.id);
  if (!sess || sess.sessionId !== sessionId) return;

  const quiz = await store.get(`quiz:${sess.quizId}`);
  if (!quiz) return;

  if (sess.currentIndex >= quiz.questions.length) {
    await finalizeQuiz(ctx, sess);
    await deleteSession(ctx.chat.id);
  } else {
    await sendQuestion(ctx, sess, quiz);
  }
}

// ─────────────────────────────────────────────
// POLL ANSWER (group polls)
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

  const qIdx = pollMeta.questionIndex;
  const q = quiz.questions[qIdx];
  if (!q) return;

  const userId = pa.user.id;
  const optionIdx = pa.option_ids?.[0] ?? -1;
  const isCorrect = optionIdx === q.correctIndex;

  if (!sess.participants) sess.participants = {};
  if (!sess.participants[userId]) {
    sess.participants[userId] = { score: 0, correct: 0, wrong: 0, name: pa.user.first_name };
  }

  // Prevent double-answer
  if (sess.participants[userId][`q${qIdx}`] !== undefined) return;
  sess.participants[userId][`q${qIdx}`] = isCorrect;

  const scoreChange = isCorrect ? 1 : -sess.settings.negativeMarking;
  sess.participants[userId].score = (sess.participants[userId].score || 0) + scoreChange;
  if (isCorrect) sess.participants[userId].correct = (sess.participants[userId].correct || 0) + 1;
  else sess.participants[userId].wrong = (sess.participants[userId].wrong || 0) + 1;

  await saveSession(pollMeta.chatId, sess);
}

// ─────────────────────────────────────────────
// POLL CLOSED (group polls — send explanation + next Q)
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

  const qIdx = pollMeta.questionIndex;
  const q = quiz.questions[qIdx];
  if (!q) return;

  // Send explanation
  if (q.explanation) {
    const correctOpt = q.options[q.correctIndex];
    await ctx.api.sendMessage(
      pollMeta.chatId,
      `✅ *Correct Answer:* ${correctOpt}\n\n📖 *Explanation:*\n${q.explanation}`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  await store.del(`poll:${poll.id}`);

  // Are there more questions?
  if (sess.currentIndex >= quiz.questions.length) {
    await finalizeGroupQuiz(ctx, sess, quiz, pollMeta.chatId);
    await store.del(`session:${pollMeta.chatId}`);
  } else {
    await sendQuestion(ctx, sess, quiz);
  }
}

// ─────────────────────────────────────────────
// FINALIZE QUIZ
// ─────────────────────────────────────────────
async function finalizeQuiz(ctx, sess) {
  const quiz = await store.get(`quiz:${sess.quizId}`);
  const total = quiz?.questions?.length || 0;
  const score = Math.max(0, sess.score || 0);

  await ctx.api.sendMessage(
    sess.chatId,
    `🏁 *Quiz Complete — ${quiz?.name || 'Quiz'}*\n\n` +
    `${scoreText(score, total, sess.settings.negativeMarking)}\n\n` +
    `✅ Correct: ${sess.correct || 0}\n` +
    `❌ Wrong: ${sess.wrong || 0}\n` +
    `📊 Total: ${total}`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});
}

async function finalizeGroupQuiz(ctx, sess, quiz, chatId) {
  const total = quiz.questions.length;
  const participants = sess.participants || {};
  const entries = Object.entries(participants)
    .sort(([, a], [, b]) => (b.score || 0) - (a.score || 0));

  let leaderboard = `🏁 *${quiz.name}* — Final Results\n\n`;

  if (entries.length === 0) {
    leaderboard += '_No one attempted the quiz._';
  } else {
    entries.slice(0, 10).forEach(([uid, p], i) => {
      const medals = ['🥇', '🥈', '🥉'];
      const medal = medals[i] || `${i + 1}.`;
      const name = p.name || `User ${uid}`;
      const score = Math.max(0, p.score || 0).toFixed(2).replace('.00', '');
      leaderboard += `${medal} *${name}*: ${score}/${total} (✅${p.correct || 0} ❌${p.wrong || 0})\n`;
    });
  }

  await ctx.api.sendMessage(chatId, leaderboard, { parse_mode: 'Markdown' }).catch(() => {});
}

// ─────────────────────────────────────────────
// ANONYMOUS POLLS BROADCAST
// ─────────────────────────────────────────────
async function startAnonymousPolls(ctx, quiz) {
  const settings = await getUserSettings(ctx.from.id);
  const total = quiz.questions.length;

  await ctx.reply(
    `📊 Sending *${total}* anonymous quiz polls from *${quiz.name}*…`,
    { parse_mode: 'Markdown' }
  );

  for (let i = 0; i < total; i++) {
    const q = quiz.questions[i];
    try {
      await ctx.api.sendPoll(ctx.chat.id, `Q${i + 1}/${total}: ${q.question}`, q.options, {
        type: 'quiz',
        correct_option_id: q.correctIndex,
        is_anonymous: true,
        open_period: settings.timeLimit,
        explanation: q.explanation ? truncate(q.explanation, 200) : undefined,
      });
      // Small delay to avoid flood limits
      if (i < total - 1) await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.error(`Poll send error Q${i + 1}:`, err.message);
    }
  }

  await ctx.reply(`✅ All ${total} polls sent! Correct answers will be shown after each timer.`);
}
