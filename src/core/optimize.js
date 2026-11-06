/**
 * Budget planner — the "make the catalog fit" half of the token story.
 *
 * The console can already tell you what the catalog costs. This module answers
 * the next question: *which* skills to take off the shelf so the cost fits a
 * budget, with the smallest possible loss.
 *
 * Objective: fewest drops. Repeatedly removing the most expensive visible skill
 * frees the most tokens per removal, so it needs the fewest removals to get under
 * the line — the catalog keeps as many skills as possible.
 *
 * Kept deliberately pure: no filesystem, no config, so the console can call it on
 * every keystroke of the budget slider.
 */

export const DEFAULT_TARGET = 2000;

/**
 * @typedef {{ name: string, catalogTokens: number, disableModelInvocation?: boolean }} SkillLike
 */

/**
 * @param {SkillLike[]} skills everything in the hub
 * @param {{ shelf?: string[] | null, budget?: number }} [options]
 * @returns {{
 *   budget: number,
 *   before: number,
 *   after: number,
 *   saved: number,
 *   changed: boolean,
 *   keep: string[],
 *   drop: string[],
 *   drops: { name: string, catalogTokens: number }[],
 *   count: number,
 *   remaining: number,
 *   total: number
 * }}
 */
export function planShelf(skills, options = {}) {
  const shelf = Array.isArray(options.shelf) ? options.shelf : null;
  const requested = Number(options.budget);
  const budget = Number.isFinite(requested) && requested > 0 ? Math.round(requested) : DEFAULT_TARGET;

  const visible = shelf === null ? [...skills] : skills.filter((skill) => shelf.includes(skill.name));
  const before = sumTokens(visible);

  const plan = {
    budget,
    before,
    after: before,
    saved: 0,
    changed: false,
    keep: visible.map((skill) => skill.name),
    drop: [],
    drops: [],
    count: visible.length,
    remaining: visible.length,
    total: skills.length,
  };
  if (before <= budget) return plan;

  // Most expensive first, name as the tie-breaker so the plan is reproducible.
  const order = [...visible].sort(
    (a, b) => (b.catalogTokens ?? 0) - (a.catalogTokens ?? 0) || a.name.localeCompare(b.name),
  );

  const drops = [];
  let after = before;
  for (const skill of order) {
    if (after <= budget) break;
    const cost = skill.catalogTokens ?? 0;
    // Slash-only skills cost nothing in the catalog, so dropping one saves nothing.
    if (cost <= 0) continue;
    drops.push({ name: skill.name, catalogTokens: cost });
    after -= cost;
  }

  const dropped = new Set(drops.map((item) => item.name));
  plan.drop = drops.map((item) => item.name);
  plan.drops = drops;
  plan.keep = visible.filter((skill) => !dropped.has(skill.name)).map((skill) => skill.name);
  plan.after = after;
  plan.saved = before - after;
  plan.changed = drops.length > 0;
  plan.remaining = plan.keep.length;
  return plan;
}

/**
 * @param {SkillLike[]} skills
 * @returns {number}
 */
function sumTokens(skills) {
  return skills.reduce((sum, skill) => sum + (skill.catalogTokens ?? 0), 0);
}
