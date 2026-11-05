/**
 * Token estimation.
 *
 * Every agent tool injects the skill catalog (name + description) into *every*
 * request, so the description is a recurring cost, not a one-off. A real
 * tokenizer would mean shipping a 2 MB BPE table; a heuristic that is within
 * ~20% is enough to make "is this skill worth keeping on the shelf?" decidable.
 *
 * Weights come from measuring cl100k/GPT-style tokenizers on mixed text:
 *   - CJK ideographs and kana are roughly one token per character
 *   - Latin text averages ~3.6 characters per token
 */

const CJK = /[\u1100-\u11ff\u2e80-\u2fdf\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/u;

/**
 * @param {string} text
 * @returns {number} estimated tokens (never negative)
 */
export function estimateTokens(text) {
  const src = String(text ?? '');
  if (!src) return 0;

  let cjk = 0;
  let other = 0;
  for (const char of src) {
    if (CJK.test(char)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk * 0.9 + other / 3.6);
}

/**
 * Estimated cost of one catalog entry: what the model actually sees.
 *
 * @param {{ name: string, description: string }} skill
 * @returns {number}
 */
export function estimateCatalogTokens(skill) {
  return estimateTokens(`${skill.name}: ${skill.description ?? ''}`);
}

/**
 * @param {number} tokens
 * @returns {string} e.g. "1.2k"
 */
export function formatTokens(tokens) {
  if (!Number.isFinite(tokens)) return '0';
  if (tokens < 1000) return String(Math.round(tokens));
  return `${(tokens / 1000).toFixed(tokens < 10000 ? 1 : 0)}k`;
}
