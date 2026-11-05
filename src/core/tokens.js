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

/**
 * Cost tiers, so a 300-token description looks different from a 12-token one at
 * a glance instead of requiring the reader to compare numbers.
 */
export const TIERS = [
  { id: 'light', label: '轻', max: 25, hint: '几乎不占预算' },
  { id: 'normal', label: '中', max: 60, hint: '正常水平' },
  { id: 'heavy', label: '重', max: 120, hint: '描述偏长，值得压缩' },
  { id: 'extreme', label: '极重', max: Number.POSITIVE_INFINITY, hint: '单条就吃掉可观预算' },
];

/**
 * @param {number} tokens
 * @returns {{ id: string, label: string, max: number, hint: string }}
 */
export function tierOf(tokens) {
  const value = Number(tokens) || 0;
  return TIERS.find((tier) => value <= tier.max) ?? TIERS[TIERS.length - 1];
}

/**
 * What the catalog costs over time, given an assumed number of requests per day.
 * A recurring cost is much easier to judge as "per month" than "per request".
 *
 * @param {{ visibleTokens: number, dailyRequests?: number, days?: number }} input
 * @returns {{ perRequest: number, perDay: number, perMonth: number }}
 */
export function projectUsage({ visibleTokens, dailyRequests = 100, days = 30 }) {
  const perRequest = Math.max(0, Math.round(visibleTokens));
  const requests = Number(dailyRequests) > 0 ? Number(dailyRequests) : 100;
  const perDay = perRequest * requests;
  return { perRequest, perDay, perMonth: perDay * Math.max(1, days) };
}

/**
 * @param {number} used
 * @param {number} budget
 * @returns {{ ratio: number, state: 'ok' | 'warn' | 'over' }}
 */
export function budgetState(used, budget) {
  if (!budget || budget <= 0) return { ratio: 0, state: 'ok' };
  const ratio = used / budget;
  if (ratio >= 1) return { ratio, state: 'over' };
  if (ratio >= 0.8) return { ratio, state: 'warn' };
  return { ratio, state: 'ok' };
}
