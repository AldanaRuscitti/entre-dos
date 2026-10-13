"use strict";
// Tests for occurrences/nth, addInterval, daysBetween, choreState. Run under several TZs (see run.sh).
const test = require("node:test");
const assert0 = require("node:assert/strict");
const plain = o => JSON.parse(JSON.stringify(o));
const assert = Object.assign((...a) => assert0(...a), assert0, {deepEqual: (a, b, m) => assert0.deepEqual(plain(a), plain(b), m)});
const {load, rng} = require("./lib.js");
const TZ = process.env.TZ || "(system)";

// independent oracle: walk day by day using UTC calendar math
const U = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const S_ = t => new Date(t).toISOString().slice(0, 10);
const dim = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
function oracle(e, from, to) {
  const res = []; const st = U(e.date); const len = e.endDate && e.endDate > e.date ? (U(e.endDate) - st) / 864e5 : 0;
  const F = U(from), T = U(to), until = e.until ? U(e.until) : Infinity;
  const sd = new Date(st);
  for (let i = 0; i < 100000; i++) {
    let d;
    const r = e.repeat || "none";
    if (r === "none") { if (i) break; d = st; }
    else if (r === "daily") d = st + i * 864e5;
    else if (r === "weekly") d = st + 7 * i * 864e5;
    else if (r === "biweekly") d = st + 14 * i * 864e5;
    else if (r === "monthly") { const y = sd.getUTCFullYear(), m = sd.getUTCMonth() + i; const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12; d = Date.UTC(yy, mm, Math.min(sd.getUTCDate(), dim(yy, mm))); }
    else if (r === "yearly") { const yy = sd.getUTCFullYear() + i; d = Date.UTC(yy, sd.getUTCMonth(), Math.min(sd.getUTCDate(), dim(yy, sd.getUTCMonth()))); }
    if (d > T || d > until) break;
    if (d + len * 864e5 >= F && !(e.skip || []).includes(S_(d))) res.push(S_(d));
  }
  return res;
}

test(`occurrences basics [TZ=${TZ}]`, () => {
  const A = load();
  assert.deepEqual(A.occurrences({}, "2026-01-01", "2026-12-31"), []);
  assert.deepEqual(A.occurrences({date: "2026-03-05"}, "2026-03-01", "2026-03-31"), ["2026-03-05"]);
  assert.deepEqual(A.occurrences({date: "2026-02-27", endDate: "2026-03-02"}, "2026-03-01", "2026-03-31"), ["2026-02-27"]);
  assert.deepEqual(A.occurrences({date: "2026-03-05", endDate: "2026-03-01"}, "2026-03-01", "2026-03-04"), []);
  assert.deepEqual(A.occurrences({date: "2026-01-31", repeat: "monthly"}, "2026-01-01", "2026-05-31"), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  assert.deepEqual(A.occurrences({date: "2026-03-02", repeat: "weekly", skip: ["2026-03-09"], until: "2026-03-23"}, "2026-03-01", "2026-04-30"), ["2026-03-02", "2026-03-16", "2026-03-23"]);
  assert.deepEqual(A.occurrences({date: "2026-01-01", repeat: "biweekly"}, "2026-01-10", "2026-02-01"), ["2026-01-15", "2026-01-29"]);
  // multi-day weekly event started before the window but still running
  assert.deepEqual(A.occurrences({date: "2026-03-06", endDate: "2026-03-08", repeat: "weekly"}, "2026-03-15", "2026-03-16"), ["2026-03-13"]);
  assert.deepEqual(A.occurrences({date: "2026-01-30", endDate: "2026-02-02", repeat: "monthly"}, "2026-03-01", "2026-03-01"), ["2026-02-28"]);
});
test(`[Q] occurrences yearly on Feb 29 lands on Feb 28 (not Mar 1) in common years [TZ=${TZ}]`, () => {
  const A = load();
  assert.deepEqual(A.occurrences({date: "2024-02-29", repeat: "yearly"}, "2025-01-01", "2025-12-31"), ["2025-02-28"]);
});
test(`occurrences matches oracle (randomized, seed 11) [TZ=${TZ}]`, () => {
  const A = load(); const R = rng(11); const reps = ["none", "daily", "weekly", "biweekly", "monthly", "yearly"];
  const rd = (lo, span) => S_(U(lo) + Math.floor(R() * span) * 864e5);
  for (let t = 0; t < 2500; t++) {
    const e = {date: rd("2000-01-01", 12000), repeat: reps[Math.floor(R() * reps.length)]};
    if (R() < .3) e.endDate = S_(U(e.date) + Math.floor(R() * 4) * 864e5);
    if (R() < .3) e.until = S_(U(e.date) + Math.floor(R() * 900) * 864e5);
    const from = R() < .5 ? S_(U(e.date) + Math.floor((R() - .2) * 800) * 864e5) : rd("2000-01-01", 12000), to = S_(U(from) + Math.floor(R() * 60) * 864e5);
    const exp = oracle(e, from, to).filter(d => !(e.repeat === "yearly" && e.date.endsWith("-02-29")));
    let got = A.occurrences(e, from, to);
    if (e.repeat === "yearly" && e.date.endsWith("-02-29")) continue;
    assert.deepEqual(got, exp, JSON.stringify({e, from, to}));
  }
});
test(`occurrences guard: far-future window & huge window [TZ=${TZ}]`, () => {
  const A = load();
  let t0 = Date.now();
  assert.deepEqual(A.occurrences({date: "2020-01-01", repeat: "daily"}, "2099-06-01", "2099-06-03"), ["2099-06-01", "2099-06-02", "2099-06-03"]);
  assert.deepEqual(A.occurrences({date: "1990-01-31", repeat: "monthly"}, "2099-02-01", "2099-02-28"), ["2099-02-28"]);
  assert.deepEqual(A.occurrences({date: "1990-03-01", repeat: "yearly"}, "2099-01-01", "2099-12-31"), ["2099-03-01"]);
  assert.ok(Date.now() - t0 < 200, "slow");
  const r = A.occurrences({date: "2020-01-01", repeat: "daily"}, "2020-01-01", "2030-01-01");
  assert.equal(r.length, 1000, "guard caps at 1000 iterations"); // documents current behavior
});

test(`addInterval / daysBetween across DST [TZ=${TZ}]`, () => {
  const A = load();
  assert.equal(A.addInterval("2026-01-31", 1, "month"), "2026-02-28");
  assert.equal(A.addInterval("2028-01-31", 1, "month"), "2028-02-29");
  assert.equal(A.addInterval("2026-12-31", 2, "month"), "2027-02-28");
  assert.equal(A.addInterval("2026-03-07", 1, "week"), "2026-03-14");
  assert.equal(A.addInterval("2026-03-08", 1, "day"), "2026-03-09");
  assert.equal(A.addInterval("2026-11-01", 1, "day"), "2026-11-02");
  assert.equal(A.daysBetween("2026-03-07", "2026-03-09"), 2);
  assert.equal(A.daysBetween("2026-10-31", "2026-11-02"), 2);
  assert.equal(A.daysBetween("2026-12-31", "2026-01-01"), -364);
  const R = rng(5);
  for (let t = 0; t < 3000; t++) {
    const a = S_(U("1970-01-01") + Math.floor(R() * 40000) * 864e5), n = Math.floor(R() * 800) - 400;
    const b = A.addInterval(a, n, "day");
    assert.equal(b, S_(U(a) + n * 864e5), `${a}+${n}`);
    assert.equal(A.daysBetween(a, b), n);
  }
});

function setupChores(A, ppl) { ppl.forEach(id => A.S.people[id] = {id, name: id.toUpperCase()}); }
let ln = 0; const log = (A, chore, by, date, extra = {}) => { const id = "l" + (++ln); A.S.choreLog[id] = {id, chore, by, date, createdAt: 1000 + ln, ...extra}; return 1000 + ln; };

test(`choreState: rotation, skips, due [TZ=${TZ}]`, () => {
  const A = load(); A.setToday("2026-10-09"); setupChores(A, ["a", "b", "c"]);
  const c = {id: "c1", assign: "rotate", who: ["a", "b", "c"], every: 2, unit: "day"};
  A.S.chores.c1 = c;
  let s = A.choreState(c);
  assert.equal(s.who, "a"); assert.equal(s.due, "2026-10-09"); assert.equal(s.days, 0);
  log(A, "c1", "a", "2026-10-05");
  s = A.choreState(c); assert.equal(s.who, "b"); assert.equal(s.due, "2026-10-07"); assert.equal(s.days, -2);
  log(A, "c1", null, "2026-10-08", {skip: true});
  s = A.choreState(c); assert.equal(s.who, "b", "skip must not advance rotation"); assert.equal(s.due, "2026-10-10"); assert.equal(s.last.by, "a");
  log(A, "c1", "b", "2026-10-09"); log(A, "c1", "c", "2026-10-09");
  s = A.choreState(c); assert.equal(s.who, "a", "wraps around after c (same-day ordering by createdAt)");
  // person removed from S.people is ignored
  delete A.S.people.a; s = A.choreState(c); assert.equal(s.who, "b");
});
test(`choreState: next override (take/assign) expires after a done log, not after a skip [TZ=${TZ}]`, () => {
  const A = load(); A.setToday("2026-10-09"); setupChores(A, ["a", "b"]);
  const c = {id: "c2", assign: "rotate", who: ["a", "b"], every: 1, unit: "week"}; A.S.chores.c2 = c;
  log(A, "c2", "a", "2026-10-01");
  assert.equal(A.choreState(c).who, "b");
  c.next = "a"; c.nextAt = 5000;
  let s = A.choreState(c); assert.equal(s.who, "a"); assert.equal(s.taken, true);
  log(A, "c2", null, "2026-10-08", {skip: true, createdAt: 6000});
  s = A.choreState(c); assert.equal(s.taken, true, "skip does not consume the override");
  log(A, "c2", "a", "2026-10-09", {createdAt: 7000});
  s = A.choreState(c); assert.equal(s.taken, false); assert.equal(s.who, "b");
  c.next = "ghost"; c.nextAt = 9e9; assert.equal(A.choreState(c).taken, false, "unknown person ignored");
});
test(`choreState: fixed / anyone / monthly due [TZ=${TZ}]`, () => {
  const A = load(); A.setToday("2026-03-01"); setupChores(A, ["a", "b"]);
  const f = {id: "f", assign: "fixed", who: ["b", "a"], every: 1, unit: "month"};
  assert.equal(A.choreState(f).who, "b");
  log(A, "f", "a", "2026-01-31");
  assert.equal(A.choreState(f).due, "2026-02-28"); assert.equal(A.choreState(f).days, -1); assert.equal(A.choreState(f).who, "b");
  const any = {id: "x", assign: "anyone", who: ["a"], start: "2026-03-05"};
  assert.equal(A.choreState(any).who, null); assert.equal(A.choreState(any).days, 4);
  assert.equal(A.choreState({id: "y", assign: "fixed", who: []}).who, null);
});

// Chile (America/Santiago, every year, 1st Sunday of September) and historic Brazil start DST at 00:00, so pd() of that
// day returns 01:00. occurrences() compares Date objects, so an occurrence carrying 01:00 is > pd(to) (00:00).
test(`occurrences: series anchored on a DST-at-midnight day keeps its last in-range occurrence [TZ=${TZ}]`, () => {
  const A = load();
  assert.deepEqual(A.occurrences({date: "2026-09-06", repeat: "weekly"}, "2026-09-07", "2026-09-13"), ["2026-09-13"], "Santiago 2026 weekly");
  assert.deepEqual(A.occurrences({date: "2026-09-06", repeat: "monthly"}, "2026-10-01", "2026-10-06"), ["2026-10-06"], "Santiago 2026 monthly");
  assert.deepEqual(A.occurrences({date: "2026-09-06", repeat: "daily", until: "2026-09-08"}, "2026-09-01", "2026-09-30"), ["2026-09-06", "2026-09-07", "2026-09-08"], "until day kept");
  assert.deepEqual(A.occurrences({date: "2018-11-04", repeat: "weekly"}, "2018-11-05", "2018-11-11"), ["2018-11-11"], "Sao Paulo 2018");
});
