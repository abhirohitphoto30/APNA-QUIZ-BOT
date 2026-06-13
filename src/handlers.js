import { InlineKeyboard } from 'grammy';
  import { parseQuizText } from './parser.js';
  import { store } from './store.js';
  import { nanoid } from 'nanoid';

  const TL_LABELS = {5:'5s',10:'10s',15:'15s',20:'20s',25:'25s',30:'30s',40:'40s',45:'45s',50:'50s',60:'1m',90:'1.5m',120:'2m',180:'3m',300:'5m'};
  const NM_OPTIONS = [0,0.25,0.33,0.5,1];
  const ALPHA = ['A','B','C','D','E'];

  function tlLabel(tl){ return TL_LABELS[tl]||(tl+'s'); }
  function tr(t,n){ return !t?'':t.length<=n?t:t.slice(0,n-1)+'\u2026'; }
  export function safePQ(t){ return tr(t,300); }
  export function safePOpt(t){ return tr(t,100); }
  export function hasLong(opts){ return opts.some(o=>o.length>60); }
  function genId(){ return 'QUIZ_'+nanoid(6).toUpperCase().replace(/[^A-Z0-9]/g,'X'); }
  export function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
  function lastLine(q){ const ls=q.split('\n').map(l=>l.trim()).filter(Boolean); return ls[ls.length-1]||q; }
  export function safeTimeLimit(t){ return Math.max(5,Math.min(600,Number(t)||30)); }

  export async function getSettings(uid){ return (await store.get('settings:'+uid))||{negativeMarking:0,timeLimit:30,shuffle:false}; }
  export async function getSess(cid){ return store.get('session:'+cid); }
  export async function saveSess(cid,s){ return store.set('session:'+cid,s,7200); }
  export async function delSess(cid){
    const s=await getSess(cid);
    if(s?.currentPollId) await store.del('poll:'+s.currentPollId);
    await store.del('session:'+cid);
  }

  // ─── Schedule advance via QStash ─────────────────────────────────────────────
  // Called after each group quiz poll is sent. Fires after (tl+3) seconds
  // guaranteed, even if Telegram's poll_closed update never arrives.
  async function scheduleAdvance(chatId, sessionId, questionIndex, delaySeconds) {
    const token = process.env.QSTASH_TOKEN;
    if (!token) {
      console.log('[QStash] QSTASH_TOKEN not set — relying on poll_closed event only');
      return;
    }
    // Derive advance URL from WEBHOOK_URL or VERCEL_URL
    let advUrl = null;
    if (process.env.WEBHOOK_URL) {
      advUrl = process.env.WEBHOOK_URL.replace('/api/webhook', '/api/advance');
    } else if (process.env.VERCEL_URL) {
      advUrl = 'https://' + process.env.VERCEL_URL + '/api/advance';
    }
    if (!advUrl) { console.log('[QStash] Cannot determine advance URL'); return; }

    try {
      const r = await fetch('https://qstash.upstash.io/v2/publish/' + encodeURIComponent(advUrl), {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json',
          'Upstash-Delay': delaySeconds + 's',
        },
        body: JSON.stringify({ chatId, sessionId, questionIndex }),
      });
      const d = await r.json();
      if (d.messageId) console.log('[QStash] Scheduled advance msgId=' + d.messageId + ' delay=' + delaySeconds + 's');
      else console.error('[QStash] Error:', JSON.stringify(d));
    } catch (err) {
      console.error('[QStash] Fetch error:', err.message);
    }
  }

  // ─── /start /help /createquiz ─────────────────────────────────────────────────
  export async function handleStart(ctx) {
    const name=ctx.from.first_name||'there';
    await ctx.reply(
      '\uD83D\uDC4B *Hello, '+name+'!*\n\nWelcome to *Apna Quiz Bot* \uD83C\uDFAF\n\n'+
      '\uD83D\uDCE4 Send a *.txt* file \u2014 upload quiz questions\n'+
      '\uD83D\uDCDD /createquiz \u2014 format guide\n'+
      '\uD83D\uDCCB /myquizzes \u2014 your saved quizzes\n'+
      '\u25B6\uFE0F /startquiz <ID> \u2014 start a quiz\n'+
      '\uD83D\uDCCA /sendpoll <ID> \u2014 broadcast anonymous polls\n\n'+
      '*Mid-quiz:* /fast /slow /pause /end',
      {parse_mode:'Markdown'});
  }
  export async function handleHelp(ctx) {
    await ctx.reply(
      '\uD83D\uDCD6 *Help*\n\n*Formats:*\n'+
      'Format 1: Q.1) Question\nFormat 2: Q1.Question / \uD83D\uDE02 separator\n'+
      'Mark correct with \u2705 | Explanation: Ex: ...\n\n'+
      '*Mid-quiz:* /fast +10s | /slow -10s | /pause | /end',
      {parse_mode:'Markdown'});
  }
  export async function handleCreateQuiz(ctx) {
    await ctx.reply(
      '\uD83D\uDCDD *Create a Quiz*\n\n*Format 1:*\n```\nQ.1) Which planet?\nVenus\nMercury \u2705\nMars\nEx: Mercury is closest.\n```\n\n'+
      '*Format 2:*\n```\nQ1.Consider:\n1. Statement A\n\uD83D\uDE02\nOnly 1 \u2705\nOnly 2\nEx: Explanation.\n```\n\n'+
      '\u2705 = correct | Ex: = explanation\n\uD83D\uDC46 *Send .txt file now!*',
      {parse_mode:'Markdown'});
  }

  // ─── DOCUMENT ────────────────────────────────────────────────────────────────
  export async function handleDocument(ctx) {
    const doc=ctx.message.document;
    if (!doc.file_name?.toLowerCase().endsWith('.txt')) return ctx.reply('\u274C Please send a *.txt* file.',{parse_mode:'Markdown'});
    if (doc.file_size>5*1024*1024) return ctx.reply('\u274C File too large (max 5 MB).');
    const msg=await ctx.reply('\u23F3 Parsing quiz file\u2026');
    try {
      const file=await ctx.getFile();
      const resp=await fetch('https://api.telegram.org/file/bot'+process.env.BOT_TOKEN+'/'+file.file_path);
      if (!resp.ok) throw new Error('Download failed');
      const questions=parseQuizText(await resp.text());
      if (!questions.length) return ctx.api.editMessageText(ctx.chat.id,msg.message_id,'\u274C No valid questions found. Use /createquiz.');
      if (questions.length>300) return ctx.api.editMessageText(ctx.chat.id,msg.message_id,'\u274C Too many questions ('+questions.length+'). Max 300.');
      await store.set('pending:'+ctx.from.id,{questions},600);
      await store.set('state:'+ctx.from.id,{action:'awaiting_quiz_name'},600);
      await ctx.api.editMessageText(ctx.chat.id,msg.message_id,
        '\u2705 Found *'+questions.length+' question'+(questions.length>1?'s':'')+'!*\n\n'+
        'Preview \u2014 Q1: _'+tr(questions[0].question.split('\n')[0],100)+'_\n\n'+
        '\uD83D\uDCDD *Send me a name for this quiz:*',{parse_mode:'Markdown'});
    } catch(err) {
      console.error('handleDocument:',err);
      await ctx.api.editMessageText(ctx.chat.id,msg.message_id,'\u274C Error reading file.').catch(()=>{});
    }
  }

  // ─── TEXT ────────────────────────────────────────────────────────────────────
  export async function handleText(ctx) {
    const state=await store.get('state:'+ctx.from.id);
    if (!state||state.action!=='awaiting_quiz_name') return;
    const name=ctx.message.text.trim().slice(0,100);
    const pending=await store.get('pending:'+ctx.from.id);
    if (!pending) return ctx.reply('\u23F0 Session expired. Upload file again.');
    const quizId=genId();
    await store.set('quiz:'+quizId,{id:quizId,name,questions:pending.questions,createdBy:ctx.from.id,createdAt:Date.now()});
    const list=(await store.get('quizzes:'+ctx.from.id))||[];
    list.unshift({id:quizId,name,count:pending.questions.length,createdAt:Date.now()});
    if(list.length>50) list.pop();
    await store.set('quizzes:'+ctx.from.id,list);
    await store.del('pending:'+ctx.from.id); await store.del('state:'+ctx.from.id);
    const kb=new InlineKeyboard().text('\u25B6\uFE0F Start Quiz','confirmstart:'+quizId).text('\uD83D\uDCCA Send as Polls','sendpoll:'+quizId);
    await ctx.reply('\uD83C\uDF89 *Quiz saved!*\n\uD83D\uDCDA *'+name+'*\n\uD83C\uDD94 `'+quizId+'`\n\u2753 *'+pending.questions.length+'* questions',{parse_mode:'Markdown',reply_markup:kb});
  }

  // ─── /myquizzes ──────────────────────────────────────────────────────────────
  export async function handleMyQuizzes(ctx) {
    const list=(await store.get('quizzes:'+ctx.from.id))||[];
    if (!list.length) return ctx.reply('\uD83D\uDCED No quizzes yet. Send a .txt file!');
    let text='\uD83D\uDCDA *Your Quizzes ('+list.length+')*\n\n';
    const kb=new InlineKeyboard();
    for (const q of list.slice(0,10)) {
      const d=new Date(q.createdAt).toLocaleDateString('en-IN');
      text+='\uD83D\uDCDD *'+q.name+'*\n\uD83C\uDD94 `'+q.id+'` \u2022 \u2753 '+q.count+' Qs \u2022 \uD83D\uDCC5 '+d+'\n\n';
      kb.text('\u25B6\uFE0F '+q.name.slice(0,25),'showsettings:'+q.id).row();
    }
    await ctx.reply(text,{parse_mode:'Markdown',reply_markup:kb});
  }

  export async function handleStartQuizCommand(ctx) {
    const id=(ctx.message?.text||'').trim().split(/\s+/)[1]?.toUpperCase();
    if (!id) return ctx.reply('Usage: /startquiz QUIZ_XXXXXX');
    await showSettings(ctx,id);
  }
  export async function handleSendPollCommand(ctx) {
    const id=(ctx.message?.text||'').trim().split(/\s+/)[1]?.toUpperCase();
    if (!id) return ctx.reply('Usage: /sendpoll QUIZ_XXXXXX');
    const quiz=await store.get('quiz:'+id);
    if (!quiz) return ctx.reply('\u274C Quiz not found: '+id);
    await broadcastPolls(ctx,quiz);
  }
  export async function handleDeleteQuiz(ctx) {
    const id=(ctx.message?.text||'').trim().split(/\s+/)[1]?.toUpperCase();
    if (!id) return ctx.reply('Usage: /deletequiz QUIZ_XXXXXX');
    const quiz=await store.get('quiz:'+id);
    if (!quiz) return ctx.reply('\u274C Quiz not found.');
    if (quiz.createdBy!==ctx.from.id) return ctx.reply('\u274C Only your quizzes can be deleted.');
    await store.del('quiz:'+id);
    const list=((await store.get('quizzes:'+ctx.from.id))||[]).filter(q=>q.id!==id);
    await store.set('quizzes:'+ctx.from.id,list);
    await ctx.reply('\uD83D\uDDD1\uFE0F *'+quiz.name+'* deleted.',{parse_mode:'Markdown'});
  }
  export async function handleStop(ctx){ return handleEndCommand(ctx); }

  // ─── MID-QUIZ COMMANDS ────────────────────────────────────────────────────────
  export async function handleFastCommand(ctx) {
    const s=await getSess(ctx.chat.id); if (!s) return ctx.reply('\u26A0\uFE0F No active quiz.');
    s.settings.timeLimit=Math.min(300,(s.settings.timeLimit||30)+10);
    await saveSess(ctx.chat.id,s);
    await ctx.reply('\u26A1 Timer \u2192 *'+tlLabel(s.settings.timeLimit)+'*',{parse_mode:'Markdown'});
  }
  export async function handleSlowCommand(ctx) {
    const s=await getSess(ctx.chat.id); if (!s) return ctx.reply('\u26A0\uFE0F No active quiz.');
    s.settings.timeLimit=Math.max(5,(s.settings.timeLimit||30)-10);
    await saveSess(ctx.chat.id,s);
    await ctx.reply('\uD83D\uDC22 Timer \u2192 *'+tlLabel(s.settings.timeLimit)+'*',{parse_mode:'Markdown'});
  }
  export async function handleEndCommand(ctx) {
    const s=await getSess(ctx.chat.id); if (!s) return ctx.reply('\u26A0\uFE0F No active quiz.');
    const quiz=await store.get('sqz:'+s.sessionId)||await store.get('quiz:'+s.quizId);
    await sendReport(ctx.api,s,quiz,true);
    await delSess(ctx.chat.id); await store.del('sqz:'+s.sessionId);
  }
  export async function handlePauseCommand(ctx) {
    const s=await getSess(ctx.chat.id); if (!s) return ctx.reply('\u26A0\uFE0F No active quiz.');
    if (s.paused) return ctx.reply('Already paused.');
    s.paused=true; await saveSess(ctx.chat.id,s);
    const kb=new InlineKeyboard().text('\u25B6\uFE0F Resume','resumequiz:'+s.sessionId);
    await ctx.reply('\u23F8\uFE0F *Quiz Paused!*',{parse_mode:'Markdown',reply_markup:kb});
  }
  // handleNextCommand kept as last-resort manual skip (creator only)
  export async function handleNextCommand(ctx) {
    const s=await getSess(ctx.chat.id); if (!s) return ctx.reply('\u26A0\uFE0F No active quiz.');
    if (s.startedBy!==ctx.from.id) return ctx.reply('\u26A0\uFE0F Only quiz creator can use /next.');
    const quiz=await store.get('sqz:'+s.sessionId)||await store.get('quiz:'+s.quizId);
    if (!quiz) return;
    if (s.currentIndex>=quiz.questions.length) {
      await sendReport(ctx.api,s,quiz,false);
      await delSess(ctx.chat.id); await store.del('sqz:'+s.sessionId);
    } else {
      await sendQ(ctx.api,s,quiz);
    }
  }

  // ─── SETTINGS MENU ────────────────────────────────────────────────────────────
  export async function showSettings(ctx,quizId,editId) {
    const quiz=await store.get('quiz:'+quizId);
    if (!quiz) { const m='\u274C Quiz not found: '+quizId; return editId?ctx.api.editMessageText(ctx.chat.id,editId,m).catch(()=>ctx.reply(m)):ctx.reply(m); }
    const s=await getSettings(ctx.from.id);
    const kb=new InlineKeyboard();
    kb.text('\u2796 Negative Marking','noop').row();
    for (const nm of NM_OPTIONS) { const l=nm===0?'None':'-'+nm; kb.text(s.negativeMarking===nm?'\u2705'+l:l,'setnm:'+quizId+':'+nm); }
    kb.row().text('\u23F1\uFE0F Time/Question','noop').row();
    for (const tl of [10,20,30,40,50,60]) kb.text(s.timeLimit===tl?'\u2705'+TL_LABELS[tl]:TL_LABELS[tl],'settl:'+quizId+':'+tl);
    kb.row();
    for (const tl of [90,120,180,300]) kb.text(s.timeLimit===tl?'\u2705'+TL_LABELS[tl]:TL_LABELS[tl],'settl:'+quizId+':'+tl);
    kb.row().text(s.shuffle?'\uD83D\uDD00 Shuffle: ON \u2705':'\uD83D\uDD00 Shuffle: OFF','setshuffle:'+quizId).row();
    kb.text('\u25B6\uFE0F Start Quiz','confirmstart:'+quizId).row();
    kb.text('\uD83D\uDCCA Broadcast Anonymous Polls','sendpoll:'+quizId).row();
    const nm=s.negativeMarking===0?'None':'-'+s.negativeMarking;
    const text='\uD83D\uDCDA *'+quiz.name+'*\n\u2753 '+quiz.questions.length+' questions\n\n'+
      '\u2699\uFE0F *Settings*\n\u2796 NM: *'+nm+'* | \u23F1\uFE0F Timer: *'+tlLabel(s.timeLimit)+'* | \uD83D\uDD00 Shuffle: *'+(s.shuffle?'ON':'OFF')+'*';
    const opts={parse_mode:'Markdown',reply_markup:kb};
    if (editId) await ctx.api.editMessageText(ctx.chat.id,editId,text,opts).catch(()=>ctx.reply(text,opts));
    else await ctx.reply(text,opts);
  }

  // ─── CALLBACK ────────────────────────────────────────────────────────────────
  export async function handleCallback(ctx) {
    const data=ctx.callbackQuery.data;
    await ctx.answerCallbackQuery().catch(()=>{});
    if (data==='noop') return;
    if (data.startsWith('setnm:')) { const [,qid,nm]=data.split(':'); const s=await getSettings(ctx.from.id); s.negativeMarking=parseFloat(nm); await store.set('settings:'+ctx.from.id,s); return showSettings(ctx,qid,ctx.callbackQuery.message.message_id); }
    if (data.startsWith('settl:')) { const [,qid,tl]=data.split(':'); const s=await getSettings(ctx.from.id); s.timeLimit=parseInt(tl,10); await store.set('settings:'+ctx.from.id,s); return showSettings(ctx,qid,ctx.callbackQuery.message.message_id); }
    if (data.startsWith('setshuffle:')) { const s=await getSettings(ctx.from.id); s.shuffle=!s.shuffle; await store.set('settings:'+ctx.from.id,s); return showSettings(ctx,data.split(':')[1],ctx.callbackQuery.message.message_id); }
    if (data.startsWith('showsettings:')) return showSettings(ctx,data.split(':')[1],ctx.callbackQuery.message.message_id);
    if (data.startsWith('confirmstart:')) return startQuiz(ctx,data.split(':')[1]);
    if (data.startsWith('sendpoll:')) { const quiz=await store.get('quiz:'+data.split(':')[1]); if (!quiz) return ctx.reply('\u274C Quiz not found.'); return broadcastPolls(ctx,quiz); }
    if (data.startsWith('ans:')) { const p=data.split(':'); return handleAnswer(ctx,p[1],parseInt(p[2],10)); }
    if (data.startsWith('resumequiz:')) return handleResume(ctx,data.split(':')[1]);
    if (data.startsWith('endquiz:')) {
      const s=await getSess(ctx.chat.id); if (!s||s.sessionId!==data.split(':')[1]) return;
      const quiz=await store.get('sqz:'+s.sessionId)||await store.get('quiz:'+s.quizId);
      await sendReport(ctx.api,s,quiz,false);
      await delSess(ctx.chat.id); await store.del('sqz:'+s.sessionId);
    }
  }

  async function handleResume(ctx,sessionId) {
    const s=await getSess(ctx.chat.id); if (!s||s.sessionId!==sessionId) return ctx.reply('Session not found.');
    if (!s.paused) return; s.paused=false; await saveSess(ctx.chat.id,s);
    const quiz=await store.get('sqz:'+sessionId)||await store.get('quiz:'+s.quizId);
    if (!quiz) return ctx.reply('Quiz not found.');
    await ctx.reply('\u25B6\uFE0F *Quiz Resumed!*',{parse_mode:'Markdown'});
    await sendQ(ctx.api,s,quiz);
  }

  // ─── START QUIZ ───────────────────────────────────────────────────────────────
  async function startQuiz(ctx,quizId) {
    const existing=await getSess(ctx.chat.id);
    if (existing) { await delSess(ctx.chat.id); await store.del('sqz:'+existing.sessionId); }
    const quiz=await store.get('quiz:'+quizId);
    if (!quiz) return ctx.reply('\u274C Quiz not found.');
    const s=await getSettings(ctx.from.id);
    const sid=nanoid(8), isGroup=ctx.chat.type!=='private';
    let questions=[...quiz.questions];
    if (s.shuffle) questions=questions.sort(()=>Math.random()-0.5);
    const sess={
      sessionId:sid,quizId,chatId:ctx.chat.id,startedBy:ctx.from.id,
      currentIndex:0,score:0,attempted:0,correct:0,wrong:0,
      settings:s,isGroup,participants:{},
      startedAt:Date.now(),totalQuestions:questions.length,
      paused:false,currentMsgId:0,
    };
    await store.set('sqz:'+sid,{...quiz,questions},7200);
    await saveSess(ctx.chat.id,sess);
    const nm=s.negativeMarking===0?'None':'-'+s.negativeMarking;
    await ctx.reply(
      '\uD83D\uDE80 *'+quiz.name+'* started!\n'+
      '\u2753 '+questions.length+' Qs | \u23F1\uFE0F '+tlLabel(s.timeLimit)+'/Q | \u2796 '+nm+'\n\n'+
      (isGroup?'_Everyone can participate! Quiz auto-advances when timer expires._':'_Tap an option to answer!_')+'\n'+
      '_Commands: /fast /slow /pause /end_',
      {parse_mode:'Markdown'});
    await sendQ(ctx.api,sess,{...quiz,questions});
  }

  // ─── SEND EXPLANATION ─────────────────────────────────────────────────────────
  export async function sendExplanation(api,chatId,q) {
    if (!q) return;
    const correct=hasLong(q.options)?ALPHA[q.correctIndex]+') '+q.options[q.correctIndex]:q.options[q.correctIndex];
    let msg='\u2705 Correct Answer: '+correct;
    if (q.explanation) msg+='\n\n\uD83D\uDCD6 Explanation:\n'+q.explanation;
    await api.sendMessage(chatId,msg).catch(err=>console.error('sendExplanation error:',err.message));
  }

  // ─── SEND QUESTION ────────────────────────────────────────────────────────────
  // Exported so api/advance.js can call it.
  // FORMAT: Msg1=full question text | Msg2=poll(group) or inline keyboard(private)
  export async function sendQ(api,session,quiz) {
    if (session.paused) return;
    const q=quiz.questions[session.currentIndex];
    const total=quiz.questions.length, num=session.currentIndex+1;
    const {settings,isGroup,chatId}=session;
    const tl=safeTimeLimit(settings.timeLimit);
    const long=hasLong(q.options);
    const sid=session.sessionId;
    const qIdx=session.currentIndex;  // index BEFORE increment

    // Message 1: full question text
    let qText='Q'+num+'/'+total+': Q'+num+'. '+q.question;
    if (long) { qText+='\n\nOptions:'; q.options.forEach((o,i)=>{ qText+='\n  '+ALPHA[i]+') '+o; }); }
    await api.sendMessage(chatId,qText);
    await wait(350);

    const pollTitle=safePQ('['+num+'/'+total+'] '+lastLine(q.question));
    const pollOpts=long?q.options.map((_,i)=>ALPHA[i]):q.options.map(o=>safePOpt(o));

    if (isGroup) {
      // Message 2: native quiz poll with open_period timer
      try {
        const pollMsg=await api.sendPoll(chatId,pollTitle,pollOpts,{
          type:'quiz',
          correct_option_id:q.correctIndex,
          is_anonymous:false,
          open_period:tl,
          explanation:q.explanation?tr(q.explanation,200):undefined,
        });
        const pollId=pollMsg.poll.id;
        await store.set('poll:'+pollId,{chatId,questionIndex:qIdx,sessionId:sid},tl+300);
        session.currentPollId=pollId;
        console.log('Poll sent ok id='+pollId+' tl='+tl+'s');

        // Schedule guaranteed advance via QStash (fires after tl+3 seconds)
        await scheduleAdvance(chatId,sid,qIdx,tl+3);

      } catch(err) {
        console.error('sendPoll FAILED (tl='+tl+'):', err.message);
        // Fallback inline keyboard
        const kb=new InlineKeyboard();
        if (long) { q.options.forEach((_,i)=>kb.text(ALPHA[i],'ans:'+sid+':'+i)); kb.row(); }
        else { q.options.forEach((o,i)=>kb.text(o.slice(0,64),'ans:'+sid+':'+i).row()); }
        kb.text('\uD83D\uDED1 End Quiz','endquiz:'+sid);
        const fb=await api.sendMessage(chatId,'\u2753 '+pollTitle,{reply_markup:kb});
        session.currentMsgId=fb.message_id;
        // Still schedule QStash advance for fallback
        await scheduleAdvance(chatId,sid,qIdx,tl+3);
      }
    } else {
      // Private: inline keyboard
      const kb=new InlineKeyboard();
      if (long) { q.options.forEach((_,i)=>kb.text(ALPHA[i],'ans:'+sid+':'+i)); kb.row(); }
      else { q.options.forEach((o,i)=>kb.text(o.slice(0,64),'ans:'+sid+':'+i).row()); }
      kb.text('\uD83D\uDED1 End Quiz','endquiz:'+sid);
      const optTxt='\u2753 ['+num+'/'+total+'] '+lastLine(q.question)+'\n\u23F1\uFE0F '+tlLabel(tl);
      const m2=await api.sendMessage(chatId,optTxt,{reply_markup:kb});
      session.currentMsgId=m2.message_id;
    }

    session.currentIndex++;
    await saveSess(chatId,session);
  }

  // ─── FINAL REPORT ─────────────────────────────────────────────────────────────
  export async function sendReport(api,sess,quiz,forced) {
    const total=quiz?.questions?.length||0;
    if (sess.isGroup) {
      const entries=Object.entries(sess.participants||{}).sort(([,a],[,b])=>(b.score||0)-(a.score||0));
      const MEDALS=['\uD83E\uDD47','\uD83E\uDD48','\uD83E\uDD49'];
      let lb=(forced?'\uD83D\uDED1':'\uD83C\uDFC6')+' *'+(quiz?.name||'Quiz')+' \u2014 '+(forced?'Stopped':'Final Leaderboard')+'*\n';
      lb+='\u2753 '+total+' Questions\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n';
      if (!entries.length) lb+='_No one attempted._';
      else {
        entries.slice(0,10).forEach(([,p],i)=>{
          const med=MEDALS[i]||(i+1)+'.';
          const nm=sess.settings?.negativeMarking||0;
          const fin=Math.max(0,(p.correct||0)-(p.wrong||0)*nm);
          const fs=Number.isInteger(fin)?fin:fin.toFixed(2);
          const pct=total>0?Math.round((fin/total)*100):0;
          lb+=med+' *'+(p.name||'Player').slice(0,20)+'*: '+fs+'/'+total+' ('+pct+'%) \u2705'+(p.correct||0)+' \u274C'+(p.wrong||0)+'\n';
        });
        lb+='\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\uD83D\uDC65 '+entries.length+' participant'+(entries.length>1?'s':'');
      }
      await api.sendMessage(sess.chatId,lb,{parse_mode:'Markdown'}).catch(()=>{});
    } else {
      const attempted=sess.attempted||0,correct=sess.correct||0,wrong=sess.wrong||0;
      const nm=sess.settings?.negativeMarking||0;
      const fin=Math.max(0,correct-wrong*nm);
      const fs=Number.isInteger(fin)?fin:fin.toFixed(2);
      const pct=total>0?((fin/total)*100).toFixed(1):'0.0';
      const grade=parseFloat(pct)>=90?'\uD83C\uDFC6 Excellent!':parseFloat(pct)>=70?'\uD83E\uDD47 Good!':parseFloat(pct)>=50?'\u2705 Pass':'\uD83D\uDCDA Keep practicing';
      const elapsed=Math.round((Date.now()-sess.startedAt)/1000);
      const timeStr=Math.floor(elapsed/60)>0?Math.floor(elapsed/60)+'m '+(elapsed%60)+'s':(elapsed%60)+'s';
      const nmLine=nm>0?'\n\u2796 Penalty   : -'+(wrong*nm%1===0?wrong*nm:(wrong*nm).toFixed(2))+'('+wrong+'\u00D7'+nm+')':'';
      await api.sendMessage(sess.chatId,
        (forced?'\uD83D\uDED1':'\uD83C\uDFC1')+' *Quiz '+(forced?'Ended':'Complete')+'!*\n'+
        '\uD83D\uDCDA '+(quiz?.name||'Quiz')+'\n'+
        '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n'+
        '\uD83D\uDCDD Total Qs   : '+total+'\n'+
        '\u270D\uFE0F Attempted  : '+attempted+'\n'+
        '\u2705 Correct    : '+correct+'\n'+
        '\u274C Wrong      : '+wrong+'\n'+
        '\u23ED\uFE0F Skipped    : '+(total-attempted)+'\n'+
        '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n'+
        '\uD83C\uDFAF Final Score: *'+fs+'*/'+total+nmLine+'\n'+
        '\uD83D\uDCCA Percentage : *'+pct+'%*\n'+
        '\uD83C\uDF85 Grade      : '+grade+'\n'+
        '\u23F1\uFE0F Time Taken : '+timeStr,
        {parse_mode:'Markdown'}).catch(()=>{});
    }
  }

  // ─── HANDLE INLINE ANSWER (private + group fallback keyboard) ─────────────────
  async function handleAnswer(ctx,sessionId,optionIdx) {
    const sess=await getSess(ctx.chat.id);
    if (!sess||sess.sessionId!==sessionId) return;
    const quiz=await store.get('sqz:'+sessionId)||await store.get('quiz:'+sess.quizId); if (!quiz) return;
    const qIdx=sess.currentIndex-1;
    const q=quiz.questions[qIdx]; if (!q) return;
    const uid=ctx.from.id, uname=ctx.from.first_name||'Player';
    const isCorrect=optionIdx===q.correctIndex, long=hasLong(q.options);
    if (sess.isGroup) {
      if (!sess.participants[uid]) sess.participants[uid]={score:0,correct:0,wrong:0,name:uname};
      if (sess.participants[uid]['q'+qIdx]!==undefined)
        return ctx.answerCallbackQuery({text:'You already answered!',show_alert:false}).catch(()=>{});
      sess.participants[uid]['q'+qIdx]=isCorrect;
      const sc=isCorrect?1:-sess.settings.negativeMarking;
      sess.participants[uid].score=(sess.participants[uid].score||0)+sc;
      if (isCorrect) sess.participants[uid].correct=(sess.participants[uid].correct||0)+1;
      else           sess.participants[uid].wrong  =(sess.participants[uid].wrong||0)+1;
    } else {
      const sc=isCorrect?1:-sess.settings.negativeMarking;
      sess.score=(sess.score||0)+sc; sess.attempted=(sess.attempted||0)+1;
      if (isCorrect) sess.correct=(sess.correct||0)+1;
      else           sess.wrong  =(sess.wrong||0)+1;
    }
    await saveSess(ctx.chat.id,sess);
    await ctx.answerCallbackQuery({text:isCorrect?'\u2705 Correct!':'\u274C Wrong!',show_alert:false}).catch(()=>{});
    // Edit options message to show result
    const num=qIdx+1,total=quiz.questions.length;
    let res='\u2753 ['+num+'/'+total+'] '+lastLine(q.question)+'\n\n';
    q.options.forEach((o,i)=>{
      const lbl=long?ALPHA[i]+') '+o:o;
      if (i===optionIdx&&isCorrect)        res+='\u2705 '+lbl+' \u2190 Correct \u2713\n';
      else if (i===optionIdx&&!isCorrect)  res+='\u274C '+lbl+' \u2190 Your answer \u2717\n';
      else if (i===q.correctIndex)         res+='\u2611\uFE0F '+lbl+' \u2190 Correct answer\n';
      else                                 res+='\u25AB\uFE0F '+lbl+'\n';
    });
    if (!sess.isGroup) { const sc=Math.max(0,sess.score||0); res+='\n\uD83C\uDFAF Score: '+(Number.isInteger(sc)?sc:sc.toFixed(2)); }
    if (sess.currentMsgId) await ctx.api.editMessageText(sess.chatId,sess.currentMsgId,res).catch(()=>{});
    // Explanation as separate message
    await wait(300);
    await sendExplanation(ctx.api,sess.chatId,q);
    // Private: auto-advance; Group: QStash handles it
    if (!sess.isGroup) {
      if (sess.currentIndex>=quiz.questions.length) {
        await sendReport(ctx.api,sess,quiz,false);
        await delSess(ctx.chat.id); await store.del('sqz:'+sessionId);
      } else {
        await wait(900);
        await sendQ(ctx.api,sess,quiz);
      }
    }
  }

  // ─── POLL ANSWER (records group poll votes) ───────────────────────────────────
  export async function handlePollAnswer(ctx) {
    const pa=ctx.pollAnswer; if (!pa) return;
    const meta=await store.get('poll:'+pa.poll_id); if (!meta) return;
    const sess=await getSess(meta.chatId); if (!sess) return;
    const quiz=await store.get('sqz:'+sess.sessionId)||await store.get('quiz:'+sess.quizId); if (!quiz) return;
    const qIdx=meta.questionIndex, q=quiz.questions[qIdx]; if (!q) return;
    const uid=pa.user.id, optIdx=pa.option_ids?.[0]??-1, isC=optIdx===q.correctIndex;
    if (!sess.participants) sess.participants={};
    if (!sess.participants[uid]) sess.participants[uid]={score:0,correct:0,wrong:0,name:pa.user.first_name||'User'};
    if (sess.participants[uid]['q'+qIdx]!==undefined) return;
    sess.participants[uid]['q'+qIdx]=isC;
    const sc=isC?1:-sess.settings.negativeMarking;
    sess.participants[uid].score=(sess.participants[uid].score||0)+sc;
    if (isC) sess.participants[uid].correct=(sess.participants[uid].correct||0)+1;
    else     sess.participants[uid].wrong  =(sess.participants[uid].wrong||0)+1;
    await saveSess(meta.chatId,sess);
  }

  // ─── POLL CLOSED (Telegram's native event — bonus trigger) ───────────────────
  // QStash is the primary timer. This fires if Telegram sends it (not always reliable).
  export async function handlePollClosed(ctx) {
    const poll=ctx.update?.poll;
    if (!poll?.is_closed) return;
    console.log('[poll_closed] poll.id='+poll.id);
    const meta=await store.get('poll:'+poll.id); if (!meta) { console.log('[poll_closed] no meta'); return; }
    // Use advance lock to prevent double-advance with QStash
    const lockKey='adv:'+meta.sessionId+':'+meta.questionIndex;
    const locked=await store.get(lockKey);
    if (locked) { console.log('[poll_closed] QStash already advancing'); return; }
    await store.set(lockKey,1,120);
    await store.del('poll:'+poll.id);
    const sess=await getSess(meta.chatId); if (!sess) return;
    const quiz=await store.get('sqz:'+sess.sessionId)||await store.get('quiz:'+sess.quizId); if (!quiz) return;
    const q=quiz.questions[meta.questionIndex];
    await sendExplanation(ctx.api,meta.chatId,q);
    await wait(500);
    if (sess.currentIndex>=quiz.questions.length) {
      await sendReport(ctx.api,sess,quiz,false);
      await store.del('session:'+meta.chatId);
      await store.del('sqz:'+sess.sessionId);
    } else {
      await sendQ(ctx.api,sess,quiz);
    }
  }

  // ─── BROADCAST ANONYMOUS POLLS ────────────────────────────────────────────────
  async function broadcastPolls(ctx,quiz) {
    const s=await getSettings(ctx.from.id);
    const total=quiz.questions.length, tl=safeTimeLimit(s.timeLimit);
    await ctx.reply('\uD83D\uDCCA Sending *'+total+'* anonymous polls from *'+quiz.name+'*\u2026',{parse_mode:'Markdown'});
    let sent=0;
    for (let i=0;i<total;i++) {
      const q=quiz.questions[i]; const long=hasLong(q.options);
      try {
        let qt='Q'+(i+1)+'/'+total+': Q'+(i+1)+'. '+q.question;
        if (long) { qt+='\n\nOptions:'; q.options.forEach((o,idx)=>{ qt+='\n  '+ALPHA[idx]+') '+o; }); }
        await ctx.api.sendMessage(ctx.chat.id,qt);
        await wait(350);
        const pt=safePQ('['+(i+1)+'/'+total+'] '+lastLine(q.question));
        const po=long?q.options.map((_,idx)=>ALPHA[idx]):q.options.map(o=>safePOpt(o));
        await ctx.api.sendPoll(ctx.chat.id,pt,po,{
          type:'quiz',correct_option_id:q.correctIndex,
          is_anonymous:true,open_period:tl,
          explanation:q.explanation?tr(q.explanation,200):undefined,
        });
        sent++;
        if (i<total-1) await wait(800);
      } catch(err) { console.error('broadcastPoll Q'+(i+1)+' error:',err.message); }
    }
    await ctx.reply('\u2705 Sent '+sent+'/'+total+' polls!');
  }
  