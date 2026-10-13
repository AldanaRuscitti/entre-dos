// Loads the pure logic functions from index.html into a node:vm sandbox.
// The app file is NOT modified. Functions are extracted by source-line matching
// (each top-level declaration either fits on one line or ends with a line that is exactly "}" / "};").
"use strict";
const fs = require("node:fs");
const vm = require("node:vm");

const APP = process.env.APP_FILE || require("node:path").join(__dirname, "..", "index.html");

const NAMES = ["CURS", "pad", "ymd", "pd", "addDays", "MONTHS", "MON_S", "fmtC", "money", "r2", "parseAmt", "amtStr", "shortDate",
  "DEF_CFG", "DEF_PREFS", "cfg", "prefs", "meP", "meId", "person", "pName", "pColor",
  "nth", "occurrences", "shares", "groupExpenses", "balances", "settle", "ymAdd", "monthDay", "summaryText",
  "addInterval", "daysBetween", "ymdShift", "wdayOf", "choreWdays", "isWeekdayChore", "nextWeekdayOnOrAfter", "prevWeekdayOnOrBefore", "dayNum", "weekAnchor", "choreWeekOn", "nextChoreDay", "prevChoreDay", "choreLastOcc", "chorePending", "choreOccCover", "WD_PLURAL", "wdaysLabel", "choreLogs", "choreState", "pctText", "BASE", "isExp", "fxRate", "combinedNet"];

function extract(src) {
  const lines = src.split("\n");
  const out = [];
  for (const name of NAMES) {
    const re = new RegExp(`^(function ${name}\\(|const ${name} = )`);
    const idx = lines.findIndex(l => re.test(l));
    if (idx < 0) throw new Error("not found in app: " + name);
    const first = lines[idx];
    const opens = (first.match(/[{[(]/g) || []).length, closes = (first.match(/[}\])]/g) || []).length;
    if (opens === closes) { out.push(first); continue; }       // one-liner
    let j = idx + 1;
    while (j < lines.length && !/^\}[;]?\s*$/.test(lines[j])) j++;
    out.push(lines.slice(idx, j + 1).join("\n"));
  }
  return out.join("\n");
}

const appSrc = fs.readFileSync(APP, "utf8");
const extracted = extract(appSrc);

function load() {
  const S = {uid: "u-me", people: {}, groups: {}, events: {}, expenses: {}, config: {}, chores: {}, choreLog: {},
    priv: {events: {}, tx: {}, tpl: {}, goals: {}, gcontribs: {}, settings: null}};
  const ctx = {S, Intl, Math, Number, String, Object, Date, isFinite, parseFloat, parseInt, console, __TODAY: null};
  vm.createContext(ctx);
  // todayS is replaced by an overridable clock; everything else is the app's own code.
  const code = `"use strict";
const todayS = () => globalThis.__TODAY || ymd(new Date());
const memo = (k, d, fn) => fn();
${extracted}
({${NAMES.join(",")}, todayS});`;
  const api = vm.runInContext(code, ctx, {filename: "entre-dos-logic.js"});
  api.S = S;
  api.setToday = d => { ctx.__TODAY = d; };
  return api;
}

// Mulberry32 seeded PRNG
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

module.exports = {load, rng, extracted};
