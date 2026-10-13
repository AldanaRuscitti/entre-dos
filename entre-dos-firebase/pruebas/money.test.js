"use strict";
// Tests for parseAmt, shares, balances, settle, combinedNet, cuotas split, summaryText, pctText.
// Test names prefixed "[Q]" encode a debatable expectation (UX/spec question), not a hard bug.
const test = require("node:test");
const assert0 = require("node:assert/strict");
// vm-realm objects have a foreign Object.prototype; compare as plain JSON
const plain = o => JSON.parse(JSON.stringify(o));
const assert = Object.assign((...a) => assert0(...a), assert0, {deepEqual: (a, b, m) => assert0.deepEqual(plain(a), plain(b), m)});
const {load, rng} = require("./lib.js");

const cents = v => Math.round(v * 100);
const sumC = o => Object.values(o).reduce((s, v) => s + cents(v), 0);

test("parseAmt: Argentine formats", () => {
  const A = load();
  const cases = [["1.500", 1500], ["1.500,50", 1500.5], ["1,5", 1.5], ["1500", 1500], ["  $ 2.000 ", 2000], ["-5", -5],
    ["1.5", 1.5], ["12.50", 12.5], ["1.234.567", 1234567], ["$1.500,5", 1500.5], [",5", 0.5], [".5", 0.5], ["1 500", 1500],
    ["1.234.567,89", 1234567.89], ["0,01", 0.01], ["1.2345", 1.23]];
  for (const [s, v] of cases) assert.equal(A.parseAmt(s), v, `parseAmt(${JSON.stringify(s)})`);
  for (const s of ["abc", "", "   ", null, undefined, "--5", "$"]) assert.ok(Number.isNaN(A.parseAmt(s)), `parseAmt(${JSON.stringify(s)}) should be NaN`);
});
test("parseAmt: '0.500' is a decimal, not 500 (leading-zero group is not a thousands group)", () => {
  const A = load();
  assert.equal(A.parseAmt("0.500"), 0.5);
  assert.equal(A.parseAmt("0.250"), 0.25);
});
test("[Q] parseAmt: malformed input should be rejected instead of silently truncated", () => {
  const A = load();
  assert.ok(Number.isNaN(A.parseAmt("1.000.5")), "1.000.5 -> " + A.parseAmt("1.000.5"));
  assert.ok(Number.isNaN(A.parseAmt("1e5")), "1e5 -> " + A.parseAmt("1e5"));
  assert.ok(Number.isNaN(A.parseAmt("1,234.56")) || A.parseAmt("1,234.56") === 1234.56, "1,234.56 -> " + A.parseAmt("1,234.56"));
});

test("shares: equal, cent-exact distribution", () => {
  const A = load();
  assert.deepEqual(A.shares({amount: 100, split: {a: true, b: true, c: true}}), {a: 33.34, b: 33.33, c: 33.33});
  assert.deepEqual(A.shares({amount: 0.01, split: {a: true, b: true, c: true}}), {a: 0.01, b: 0, c: 0});
  assert.deepEqual(A.shares({amount: 10, split: {a: true, b: false, c: 0, d: true}}), {a: 5, d: 5});
  assert.deepEqual(A.shares({amount: 10, split: {a: false}}), {});
  assert.deepEqual(A.shares({amount: 10}), {});
  const big = A.shares({amount: 987654321.07, split: {a: true, b: true, c: true, d: true, e: true, f: true, g: true}});
  assert.equal(sumC(big), 98765432107);
});
test("shares: exact & percent & shares modes", () => {
  const A = load();
  assert.deepEqual(A.shares({amount: 100, splitMode: "exact", split: {a: 70.004, b: 29.996}}), {a: 70, b: 30});
  assert.deepEqual(A.shares({amount: 100, splitMode: "percent", split: {a: 60, b: 40}}), {a: 60, b: 40});
  assert.deepEqual(A.shares({amount: 100, splitMode: "percent", split: {a: 33.33, b: 33.33, c: 33.34}}), {a: 33.33, b: 33.33, c: 33.34});
  assert.deepEqual(A.shares({amount: 90, splitMode: "shares", split: {a: 2, b: 1}}), {a: 60, b: 30});
  assert.deepEqual(A.shares({amount: 90, splitMode: "shares", split: {a: 2, b: 0, c: -1}}), {a: 90});
});
test("shares: proportional modes sum exactly to amount (randomized, seed 42)", () => {
  const A = load(); const R = rng(42);
  for (let t = 0; t < 3000; t++) {
    const n = 1 + Math.floor(R() * 6), amt = Math.round(R() * (R() < .3 ? 1e7 : 500)) / 100;
    const sp = {}; for (let k = 0; k < n; k++) sp["p" + k] = R() < .1 ? 0 : Math.round(R() * 100) || 1;
    const out = A.shares({amount: amt, splitMode: R() < .5 ? "percent" : "shares", split: sp});
    if (!Object.keys(out).length) continue;
    assert.equal(sumC(out), cents(amt), JSON.stringify({amt, sp, out}));
    const eq = A.shares({amount: amt, split: Object.fromEntries(Object.keys(sp).map(k => [k, true]))});
    assert.equal(sumC(eq), cents(amt));
    const vals = Object.values(eq).map(cents); assert.ok(Math.max(...vals) - Math.min(...vals) <= 1);
  }
});
test("shares: proportional split never gives a negative share and is within 1 cent of fair", () => {
  const A = load();
  // 0.05 among 7 equal weights: Math.round(5/7)=1 for the first 6, last gets 5-6 = -1 cent
  const o1 = A.shares({amount: 0.05, splitMode: "shares", split: {a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1}});
  assert.ok(Object.values(o1).every(v => v >= 0), "negative share: " + JSON.stringify(o1));
  // 0.10 among 4 equal weights -> 3,3,3,1 instead of 3,3,2,2
  const o2 = A.shares({amount: 0.10, splitMode: "percent", split: {a: 25, b: 25, c: 25, d: 25}});
  const v = Object.values(o2).map(cents); assert.ok(Math.max(...v) - Math.min(...v) <= 1, JSON.stringify(o2));
});

function group(A, people) { people.forEach(id => A.S.people[id] = {id, name: id.toUpperCase()}); A.S.groups.g = {id: "g", name: "Casa", members: people}; }
let seq = 0; const add = (A, e) => { const id = "e" + (++seq); A.S.expenses[id] = {id, group: "g", cur: "ARS", createdAt: seq, ...e}; return id; };

test("balances: expenses + payments, per currency, nets sum to 0", () => {
  const A = load(); A.setToday("2026-10-09"); group(A, ["a", "b", "c"]);
  add(A, {date: "2026-10-01", amount: 300, paidBy: "a", split: {a: true, b: true, c: true}});
  add(A, {date: "2026-10-02", amount: 100, paidBy: "b", split: {a: true, b: true, c: true}});
  add(A, {date: "2026-10-03", kind: "payment", amount: 50, from: "c", to: "a"});
  add(A, {date: "2026-10-03", cur: "USD", amount: 10, paidBy: "c", split: {a: true, b: true}});
  const bal = A.balances("g");
  assert.deepEqual(bal.ARS, {a: 116.66, b: -33.33, c: -83.33});
  assert.deepEqual(bal.USD, {c: 10, a: -5, b: -5});
});
test("balances: future-dated cuotas excluded, today's included; non-cuota future expenses included", () => {
  const A = load(); A.setToday("2026-10-09"); group(A, ["a", "b"]);
  add(A, {date: "2026-10-09", amount: 100, paidBy: "a", split: {a: true, b: true}, cuota: {n: 1, total: 2}});
  add(A, {date: "2026-11-09", amount: 100, paidBy: "a", split: {a: true, b: true}, cuota: {n: 2, total: 2}});
  add(A, {date: "2026-12-01", amount: 10, paidBy: "b", split: {a: true, b: true}});
  assert.deepEqual(A.balances("g").ARS, {a: 50 - 5, b: -50 + 5});
});
test("balances: kind=convert moves foreign nets into ARS and zeroes the foreign currency", () => {
  const A = load(); A.setToday("2026-10-09"); group(A, ["a", "b", "c"]);
  A.S.config.main = {fx: {USD: {rate: 1234.5}}};
  add(A, {date: "2026-10-01", cur: "USD", amount: 100, paidBy: "a", split: {a: true, b: true, c: true}});
  add(A, {date: "2026-10-01", amount: 900, paidBy: "b", split: {a: true, b: true, c: true}});
  const before = A.balances("g");
  const comb = A.combinedNet(before);
  add(A, {date: "2026-10-09", kind: "convert", from: "USD", to: "ARS", cur: "USD", amount: 0, rate: 1234.5, nets: {...before.USD}});
  const after = A.balances("g");
  assert.ok(Object.values(after.USD).every(v => v === 0), JSON.stringify(after.USD));
  for (const k of Object.keys(comb)) assert.ok(Math.abs(after.ARS[k] - comb[k]) <= 0.01, k);
  // the ARS settle plan should clear everything
  const tr = A.settle(after.ARS); const left = {...after.ARS};
  tr.forEach(t => { left[t.from] += t.amount; left[t.to] -= t.amount; });
  Object.values(left).forEach(v => assert.ok(Math.abs(v) <= 0.011, JSON.stringify(left)));
});

function checkSettle(A, net) {
  const tr = A.settle(net), left = {...net};
  for (const t of tr) { assert.ok(t.amount >= 0.01, "tiny transfer " + JSON.stringify(t)); assert.notEqual(t.from, t.to); left[t.from] += t.amount; left[t.to] -= t.amount; }
  for (const [k, v] of Object.entries(left)) assert.ok(Math.abs(v) < 0.005 * Object.keys(net).length + 1e-9, `residual ${k}=${v} net=${JSON.stringify(net)} tr=${JSON.stringify(tr)}`);
  const nz = Object.values(net).filter(v => Math.abs(v) > 0.004).length;
  assert.ok(tr.length <= Math.max(0, nz - 1), "too many transfers");
  return tr;
}
test("settle: basic & degenerate", () => {
  const A = load();
  assert.deepEqual(A.settle({}), []);
  assert.deepEqual(A.settle({a: 0, b: 0}), []);
  assert.deepEqual(A.settle({a: 10, b: -10}), [{from: "b", to: "a", amount: 10}]);
  assert.deepEqual(A.settle({a: 0.003, b: -0.003}), []);
  checkSettle(A, {a: 33.34, b: -16.67, c: -16.67});
});
test("settle: randomized 3-5 people built from real expenses (seed 7)", () => {
  const R = rng(7);
  for (let t = 0; t < 1500; t++) {
    const A = load(); A.setToday("2026-10-09"); const n = 3 + Math.floor(R() * 3);
    const ppl = Array.from({length: n}, (_, i) => "p" + i); group(A, ppl);
    for (let k = 0, m = 1 + Math.floor(R() * 8); k < m; k++) {
      const sp = {}; ppl.forEach(p => { if (R() < .75) sp[p] = R() < .5 ? true : 1 + Math.floor(R() * 5); });
      if (!Object.keys(sp).length) sp.p0 = true;
      const mode = Object.values(sp).some(v => v !== true) ? "shares" : "equal";
      add(A, {date: "2026-10-01", amount: Math.round(R() * 1e6) / 100, paidBy: ppl[Math.floor(R() * n)], splitMode: mode, split: sp});
    }
    const net = A.balances("g").ARS;
    assert.ok(Math.abs(Object.values(net).reduce((s, v) => s + v, 0)) < 0.005 * n, "nets don't sum to 0: " + JSON.stringify(net));
    checkSettle(A, net);
  }
});
test("combinedNet: null with <2 non-zero currencies or a missing rate; converts otherwise", () => {
  const A = load();
  assert.equal(A.combinedNet({ARS: {a: 1, b: -1}}), null);
  assert.equal(A.combinedNet({ARS: {a: 1, b: -1}, USD: {a: 0, b: 0}}), null);
  assert.equal(A.combinedNet({ARS: {a: 1, b: -1}, USD: {a: 2, b: -2}}), null);
  A.S.config.main = {fx: {USD: {rate: "1000"}, EUR: {rate: 1100}}};
  assert.deepEqual(A.combinedNet({ARS: {a: 100, b: -100}, USD: {a: -1, b: 1}}), {a: -900, b: 900});
  assert.deepEqual(A.combinedNet({USD: {a: 1, b: -1}, EUR: {b: 1, c: -1}}), {a: 1000, b: 100, c: -1100});
});

// Replica of expenseSheet submit cuota logic (after engineering fix): remainder spread 1 cent on the first cuotas; per < 1 cent is rejected ([]).
function cuotas(A, amount, nC, date) {
  const c = Math.round(amount * 100), per = Math.floor(c / nC), extra = c - per * nC, ym0 = date.slice(0, 7), day = Number(date.slice(8));
  if (per < 1) return [];
  return Array.from({length: nC}, (_, k) => ({amount: (per + (k < extra ? 1 : 0)) / 100, date: A.monthDay(A.ymAdd(ym0, k), day)}));
}
test("cuotas: amounts sum exactly, dates clamp to month end and keep the original day", () => {
  const A = load();
  const q = cuotas(A, 100, 3, "2026-01-31");
  assert.deepEqual(q.map(x => x.amount), [33.34, 33.33, 33.33]);
  assert.deepEqual(q.map(x => x.date), ["2026-01-31", "2026-02-28", "2026-03-31"]);
  assert.deepEqual(cuotas(A, 10, 12, "2027-12-29").map(x => x.date).slice(0, 3), ["2027-12-29", "2028-01-29", "2028-02-29"]);
  const R = rng(3);
  for (let t = 0; t < 2000; t++) {
    const amt = Math.round(R() * 1e8) / 100 || 0.01, n = 1 + Math.floor(R() * 48);
    const q = cuotas(A, amt, n, "2026-05-15"); if (!q.length) continue;
    assert.equal(q.reduce((s, x) => s + cents(x.amount), 0), cents(amt));
  }
});
test("[Q] cuotas: no zero-amount installments when amount < n cents", () => {
  const A = load();
  const q = cuotas(A, 0.02, 3, "2026-10-09");
  assert.ok(q.every(x => x.amount > 0), JSON.stringify(q.map(x => x.amount)));
});
test("[Q] cuotas: last cuota absorbs up to n-1 cents (could be spread one cent each)", () => {
  const A = load();
  const q = cuotas(A, 1.47, 48, "2026-10-09").map(x => cents(x.amount));
  assert.ok(Math.max(...q) - Math.min(...q) <= 1, `per=${q[0]} last=${q[47]}`);
});

test("monthDay / ymAdd", () => {
  const A = load();
  assert.equal(A.monthDay("2026-02", 31), "2026-02-28");
  assert.equal(A.monthDay("2028-02", 30), "2028-02-29");
  assert.equal(A.monthDay("2026-04", 31), "2026-04-30");
  assert.equal(A.monthDay("2026-04", 0), "2026-04-01");
  assert.equal(A.monthDay("2026-04", undefined), "2026-04-01");
  assert.equal(A.ymAdd("2026-12", 1), "2027-01");
  assert.equal(A.ymAdd("2026-01", -1), "2025-12");
  assert.equal(A.ymAdd("2026-01", -13), "2024-12");
  assert.equal(A.ymAdd("2026-10", 48), "2030-10");
  assert.equal(A.ymAdd("0099-01", 0).length, 7);
});

test("summaryText & pctText", () => {
  const A = load(); A.setToday("2026-10-09"); group(A, ["a", "b"]);
  assert.match(A.summaryText({id: "g", name: "Casa"}), /Sin gastos cargados/);
  A.S.config.main = {fx: {USD: {rate: 1000}}};
  add(A, {date: "2026-10-01", amount: 100, paidBy: "a", split: {a: true, b: true}});
  add(A, {date: "2026-10-01", cur: "USD", amount: 4, paidBy: "b", split: {a: true, b: true}});
  const txt = A.summaryText({id: "g", name: "Casa"});
  assert.match(txt, /^Casa · saldos al 9 oct/);
  assert.match(txt, /B le pasa \$\s50,00 a A/);
  assert.match(txt, /A le pasa US\$\s2,00 a B/);
  assert.match(txt, /Todo junto en pesos \(1 USD = \$\s1\.000,00\)/);
  assert.match(txt, /A le pasa \$\s1\.950,00 a B/);
  assert.ok(!/NaN|undefined/.test(txt), txt);
  assert.equal(A.pctText([1, 1]), "50/50");
  assert.equal(A.pctText([0, 0]), "");
  assert.equal(A.pctText([2, 1]), "67/33");
});
test("[Q] pctText: percentages should add to 100", () => {
  const A = load();
  assert.equal(A.pctText([1, 1, 1]).split("/").map(Number).reduce((a, b) => a + b, 0), 100, A.pctText([1, 1, 1]));
});
