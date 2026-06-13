/**
   * Quiz Parser — supports two formats:
   *
   * FORMAT 1 (Q.1) style):
   *   Q.1) Question text (multi-line allowed)
   *   Option A
   *   Option B ✅
   *   Ex: Explanation
   *
   * FORMAT 2 (😂 separator):
   *   Q1.Question text (multi-line)
   *   1. Statement one
   *   😂
   *   Option A ✅
   *   Option B
   *   Ex: Explanation
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
    if (t.toLowerCase().startsWith('ex:')) return false;
    if (/^Q\.?\d+[.)]/i.test(t)) return false;
    if (/^\d+\.\s/.test(t)) return false;
    if (/^[1-9]️⃣/.test(t)) return false;
    return true;
  }

  function parseBlock(rawBlock) {
    const rawLines = rawBlock.split('\n');
    const lines = rawLines.map(l => l.trim()).filter((_, i) => i > 0 || rawLines[i]);

    // Find explanation
    let exIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().startsWith('ex:')) { exIdx = i; break; }
    }
    const mainLines = exIdx !== -1 ? lines.slice(0, exIdx) : lines;
    const explanation = exIdx !== -1
      ? lines.slice(exIdx).join(' ').replace(/^[Ee]x:\s*/, '').replace(/\s+/g, ' ').trim()
      : '';

    // Find correct answer marker
    const correctLineIdx = mainLines.findIndex(l => l.includes('✅'));
    if (correctLineIdx === -1) return null;

    // Walk backwards to find where options start
    let optionStartIdx = correctLineIdx;
    while (optionStartIdx > 0) {
      const prev = mainLines[optionStartIdx - 1];
      if (!isOptionLine(prev)) break;
      optionStartIdx--;
    }

    // Collect options
    const options = [];
    let correctIndex = -1;
    for (let i = optionStartIdx; i < mainLines.length; i++) {
      const line = mainLines[i];
      if (!line || line === '😂') continue;
      if (line.toLowerCase().startsWith('ex:')) break;
      if (!isOptionLine(line)) break;
      if (options.length >= 10) break;
      if (line.includes('✅')) {
        correctIndex = options.length;
        options.push(cleanText(line.replace(/✅/g, '').trim()));
      } else {
        options.push(cleanText(line));
      }
    }

    if (options.length < 2 || correctIndex === -1) return null;

    // Build question text from lines before options — PRESERVE NEWLINES
    const questionLines = mainLines
      .slice(0, optionStartIdx)
      .filter(l => l && l !== '😂');

    // Strip the leading Q number marker from first line only
    if (questionLines.length > 0) {
      questionLines[0] = questionLines[0].replace(/^Q\.?\d+[.):]?\s*/i, '');
    }

    let question = questionLines.join('\n').trim();
    if (!question) return null;

    return {
      question,
      options: options.slice(0, 4),
      correctIndex: Math.min(correctIndex, 3),
      explanation
    };
  }

  export function parseQuizText(text) {
    text = text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[\u0000]/g, '')
      .replace(/DARK[\s]*HORSE[\s]*/gi, '');

    let blocks = text.split(/(?=Q\.?\d+[.)][^\d])/i).filter(b => b.trim());

    if (blocks.length <= 1) {
      blocks = text.split(/\n{2,}/).filter(b => b.trim() && /Q\.?\d+/i.test(b));
    }

    const questions = [];
    const seen = new Set();

    for (const block of blocks) {
      const parsed = parseBlock(block);
      if (parsed && parsed.options.length >= 2 && parsed.correctIndex !== -1) {
        const key = parsed.question.slice(0, 50);
        if (!seen.has(key)) {
          seen.add(key);
          questions.push(parsed);
        }
      }
    }

    return questions;
  }
  