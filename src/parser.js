/**
   * Quiz Parser — supports two formats:
   *
   * FORMAT 1 (6311 style):
   *   Q1.Question text
   *   😂
   *   Option A ✅
   *   Option B
   *   Ex: Explanation
   *
   * FORMAT 2 (6312 style):
   *   Q.1) Question text
   *   Option A
   *   Option B ✅
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
    // Question number markers
    if (/^Q\.?\d+[.)]/i.test(t)) return false;
    // Numbered list items like "1. Statement" (with space after period)
    if (/^\d+\.\s/.test(t)) return false;
    // Emoji number bullets like 1️⃣
    if (/^[1-9]️⃣/.test(t)) return false;
    return true;
  }

  function parseBlock(rawBlock) {
    const rawLines = rawBlock.split('\n');
    const lines = rawLines.map(l => l.trim()).filter((l, i) => i > 0 || l); // keep all, trim

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

    // Collect options (up to 10 to pick best 4, handling edge cases)
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

    // Build question text from lines before options
    const questionLines = mainLines
      .slice(0, optionStartIdx)
      .filter(l => l && l !== '😂');

    let question = questionLines
      .join(' ')
      .replace(/^Q\.?\d+[.):]?\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!question) return null;

    return { question, options: options.slice(0, 4), correctIndex: Math.min(correctIndex, 3), explanation };
  }

  export function parseQuizText(text) {
    // Normalize line endings and remove junk
    text = text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[\u0000]/g, '')
      .replace(/DARK[\s]*HORSE[\s]*/gi, '');

    // Strategy 1: split on Q.N) or QN. style markers
    // Note: \s* (not \s) so we handle Q1.Text with no space
    let blocks = text.split(/(?=Q\.?\d+[.)][^\d])/i).filter(b => b.trim());

    // Strategy 2: if too few blocks found, try splitting on blank lines between questions
    if (blocks.length <= 1) {
      blocks = text.split(/\n{2,}/).filter(b => b.trim() && /Q\.?\d+/i.test(b));
    }

    const questions = [];
    const seen = new Set();

    for (const block of blocks) {
      const parsed = parseBlock(block);
      if (parsed && parsed.options.length >= 2 && parsed.correctIndex !== -1) {
        // Deduplicate by question text
        const key = parsed.question.slice(0, 50);
        if (!seen.has(key)) {
          seen.add(key);
          questions.push(parsed);
        }
      }
    }

    return questions;
  }
  