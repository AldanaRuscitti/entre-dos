// Carga la lógica de la app (index.html) en un sandbox de Node, para que los avisos
// calculen tareas, eventos y vencimientos exactamente igual que la app.
"use strict";
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const APP = process.env.APP_FILE || path.join(__dirname, "..", "index.html");
const NAMES = ["pad", "ymd", "pd", "addDays", "MONTHS", "MON_S", "DOWL", "CURS", "fmtC", "money", "shortDate", "DEF_PREFS", "prefs", "meP", "meId", "person", "pName",
  "nth", "occurrences", "monthDay", "addInterval", "daysBetween", "ymdShift", "wdayOf", "choreWdays", "isWeekdayChore", "nextWeekdayOnOrAfter", "prevWeekdayOnOrBefore",
  "dayNum", "weekAnchor", "choreWeekOn", "nextChoreDay", "prevChoreDay", "choreLastOcc", "chorePending", "choreLogs", "choreState", "pollWho", "pollState", "fixedDone", "tplDone",
  // finanzas compartidas, categorías y montos (para el resumen semanal, presupuestos y los comandos del bot)
  "r2", "isExp", "shares", "groupExpenses", "balances", "settle", "groupDefaultSplit", "DEF_CFG", "cfg", "catOf", "CAT_WORDS", "guessCat", "parseAmt", "choreOccCover"];

function extract(src, names) {
  const lines = src.split("\n"), out = [];
  for (const name of names) {
    const re = new RegExp(`^(function ${name}\\(|const ${name} = )`);
    const idx = lines.findIndex(l => re.test(l));
    if (idx < 0) throw new Error("No encontré en la app: " + name);
    const first = lines[idx];
    const opens = (first.match(/[{[(]/g) || []).length, closes = (first.match(/[}\])]/g) || []).length;
    if (opens === closes) { out.push(first); continue; }
    let j = idx + 1;
    while (j < lines.length && !/^\}[;]?\s*$/.test(lines[j])) j++;
    out.push(lines.slice(idx, j + 1).join("\n"));
  }
  return out.join("\n");
}

function load(file = APP) {
  const code = extract(fs.readFileSync(file, "utf8"), NAMES);
  const S = {uid:null, people:{}, events:{}, chores:{}, choreLog:{}, dues:{}, polls:{}, thanks:{}, fixed:{}, groups:{}, expenses:{}, config:{}, lists:{}, items:{},
    priv:{events:{}, tx:{}, tpl:{}, dues:{}, gifts:{}, settings:null}};
  const ctx = {S, Intl, Math, Number, String, Object, Array, Set, Date, isFinite, parseFloat, parseInt, console, __TODAY:null};
  vm.createContext(ctx);
  const api = vm.runInContext(`"use strict";
const todayS = () => globalThis.__TODAY || ymd(new Date());
const memo = (k, d, fn) => fn();
${code}
({${NAMES.join(",")}, todayS});`, ctx, {filename:"entre-dos-logic.js"});
  api.S = S;
  api.setToday = d => { ctx.__TODAY = d; };
  return api;
}
module.exports = {load};
