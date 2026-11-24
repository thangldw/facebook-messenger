'use strict';

// Focus schedule: weekly time ranges during which notifications are paused.
// A rule is { days: [0..6] (0 = Sunday), start: 'HH:MM', end: 'HH:MM' }.
// If end <= start the range runs past midnight into the next day, and belongs
// to the day it starts on (Friday 22:00-07:00 covers Saturday 00:00-07:00).

const MAX_RULES = 10;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutes(hhmm) {
  const m = TIME.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function normalizeRule(rule) {
  if (!rule || typeof rule !== 'object') return null;
  const { days, start, end } = rule;
  if (!Array.isArray(days) || minutes(start) === null || minutes(end) === null || start === end) return null;
  const clean = [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  if (clean.length === 0) return null;
  return { days: clean, start, end };
}

function normalizeRules(rules) {
  if (!Array.isArray(rules)) return null;
  const out = rules.slice(0, MAX_RULES).map(normalizeRule);
  return out.every(Boolean) ? out : null;
}

// Returns the end (epoch ms) of the focus period containing `now`, or null.
function focusEnd(rules, now = new Date()) {
  const t = now.getHours() * 60 + now.getMinutes();
  const today = now.getDay();
  const yesterday = (today + 6) % 7;
  let latest = null;
  for (const r of rules) {
    const s = minutes(r.start);
    const e = minutes(r.end);
    let endDate = null;
    if (s < e) {
      if (r.days.includes(today) && t >= s && t < e) endDate = at(now, 0, e);
    } else {
      // Overnight range: evening part today, or morning part from yesterday's rule.
      if (r.days.includes(today) && t >= s) endDate = at(now, 1, e);
      else if (r.days.includes(yesterday) && t < e) endDate = at(now, 0, e);
    }
    if (endDate !== null && (latest === null || endDate > latest)) latest = endDate;
  }
  return latest;
}

function at(base, addDays, mins) {
  const d = new Date(base);
  d.setDate(d.getDate() + addDays);
  d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
  return d.getTime();
}

module.exports = { focusEnd, normalizeRules, normalizeRule, minutes, MAX_RULES };
