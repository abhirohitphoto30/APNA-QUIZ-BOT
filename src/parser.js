/**
 * Quiz Parser — supports two formats:
 *
 * FORMAT 1 (file 6311 style):
 *   Q1.Question text
 *   1. statement one
 *   2. statement two
 *   😂
 *   Option A ✅
 *   Option B
 *   Option C
 *   Option D
 *   Ex: Explanation text...
 *
 * FORMAT 2 (file 6312 style):
 *   Q.1) Question text 1️⃣ statement 2️⃣ statement
 *   Option A
 *   Option B ✅
 *   Option C
 *   Option D
 *   Ex: Explanation text...
 */

function cleanText(text) {
  return text
    .replace(/DARK[\s\u0000]*HORSE[\s\u0000]*/gi, '')
    .replace(/[\u0000]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function isOptionLine(line) {
  const t = line.trim();
  if (!t) return false;
  if (t === '😂') return false;
  if (t.startsWith('Ex:')) return false;
  if (/^Q\.?\d+[.)]/i.test(t)) return false;
  if (/^\d+\.\s/.test(t)) return false;
  if (/^[1-9]️⃣/.test(t)) return false;
  return true;
}

function parseBlock(block) {
  const rawLines = block.split('\n');
  const lines = rawLines.map(l => l.trim());

  // ── Find explanation ──────────────────────────────────────────────────────
  let exIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('Ex:')) { exIdx = i; break; }
  }

  const mainLines = exIdx !== -1 ? lines.slice(0, exIdx) : lines;
  const explanation = exIdx !== -1
    ? lines.slice(exIdx).join(' ').replace(/^Ex:\s*/, '').replace(/\s+/g, ' ').trim()
    : '';

  // ── Find the ✅ (correct answer) ─────────────────────────────────────────
  const correctLineIdx = mainLines.findIndex(l => l.includes('✅'));
  if (correctLineIdx === -1) return null;

  // ── Walk backwards to find where options start ───────────────────────────
  let optionStartIdx = correctLineIdx;
  while (optionStartIdx > 0) {
    const prev = mainLines[optionStartIdx - 1];
    if (!isOptionLine(prev)) break;
    optionStartIdx--;
  }

  // ── Collect options (max 4) ───────────────────────────────────────────────
  const options = [];
  let correctIndex = -1;

  for (let i = optionStartIdx; i < mainLines.length && options.length < 4; i++) {
    const line = mainLines[i];
    if (!line || line === '😂' || line.startsWith('Ex:')) continue;
    if (!isOptionLine(line)) break;

    if (line.includes('✅')) {
      correctIndex = options.length;
      options.push(cleanText(line.replace(/✅/g, '').trim()));
    } else {
      options.push(cleanText(line));
    }
  }

  if (options.length < 2 || correctIndex === -1) return null;

  // ── Build question text ───────────────────────────────────────────────────
  const questionLines = mainLines
    .slice(0, optionStartIdx)
    .filter(l => l && l !== '😂');

  let question = questionLines.join('\n')
    .replace(/^Q\.?\d+[.)]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!question) return null;

  return { question, options, correctIndex, explanation };
}

export function parseQuizText(text) {
  text = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u0000]/g, '')
    .replace(/DARK[\s]*HORSE[\s]*/gi, '');

  // Split on Q1. / Q2. / Q.1) / Q.2) etc.
  const blocks = text.split(/(?=Q\.?\d+[.)]\s)/i).filter(b => b.trim());

  const questions = [];
  for (const block of blocks) {
    const parsed = parseBlock(block);
    if (parsed && parsed.options.length >= 2 && parsed.correctIndex !== -1) {
      questions.push(parsed);
    }
  }

  return questions;
}
