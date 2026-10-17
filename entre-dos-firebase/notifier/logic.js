// Qué avisar y cuándo. No toca la red ni la base: recibe datos y devuelve mensajes.
"use strict";

const DEF_TZ = "America/Argentina/Buenos_Aires";
const NOTIF_DEF = {morning:true, time:"08:30", evening:false, eveTime:"21:00", before:true, partner:true, weekly:true, weeklyTime:"20:00", budget:false};
const WINDOW = 180;      // minutos: si el resumen se atrasó más que esto, ese día se saltea
const PING_AHEAD = 70;   // minutos: aviso "antes de un evento" (el proceso corre cada 15 min)

const toMin = hm => { const m = /^(\d{1,2}):(\d{2})$/.exec(hm || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const weekday = d => { const [y, m, dd] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, dd)).getUTCDay(); };
const notifOf = settings => ({...NOTIF_DEF, ...((settings && settings.notif) || {})});

function localNow(date, tz) {
  let parts;
  try { parts = new Intl.DateTimeFormat("en-CA", {timeZone:tz || DEF_TZ, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23"}).formatToParts(date); }
  catch { parts = new Intl.DateTimeFormat("en-CA", {timeZone:DEF_TZ, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23"}).formatToParts(date); }
  const g = t => parts.find(p => p.type === t).value;
  const hm = `${g("hour")}:${g("minute")}`;
  return {day:`${g("year")}-${g("month")}-${g("day")}`, hm, min:toMin(hm)};
}

// Pone los datos de una persona en la lógica de la app (L = extract.load()).
function useUser(L, shared, user, day) {
  const S = L.S;
  for (const k of ["people", "events", "chores", "choreLog", "dues", "polls", "thanks", "fixed", "groups", "expenses", "lists", "items"]) S[k] = shared[k] || {};
  S.config = shared.config || {};
  S.uid = user.uid;
  S.priv = {events:{}, tx:{}, tpl:{}, dues:{}, gifts:{}, ...(user.priv || {}), settings:user.settings || null};
  L.setToday(day);
  return L.meId();
}

// Lo mismo que allEvents() de la app, pero visto por esta persona.
function userEvents(L, notif) {
  const S = L.S, me = L.meId(), mine = S.priv.events, out = [];
  for (const e of Object.values(mine)) out.push({...e, _mine:true});
  const stubs = new Set(Object.values(mine).map(e => e.stubId).filter(Boolean));
  for (const e of Object.values(S.events)) {
    if (mine[e.id] || stubs.has(e.id) || e.busy) continue;
    const involved = e.owner === me || (e.who || []).includes(me);
    if (involved || notif.partner) out.push({...e, _other:!involved});
  }
  return out;
}

function eventsOn(L, notif, day) {
  const out = [];
  for (const e of userEvents(L, notif)) if (L.occurrences(e, day, day).length) out.push(e);
  return out.sort((a, b) => (a.allDay ? 0 : 1) - (b.allDay ? 0 : 1) || (a.start || "").localeCompare(b.start || ""));
}
function evLine(L, e, day) {
  const t = e.title || "(sin título)";
  const who = e._other ? `${L.pName(e.owner)}: ` : "";
  const multi = e.endDate && e.endDate > e.date && e.date !== day;
  return e.allDay || multi || !e.start ? `${who}${t}${e.allDay ? " (todo el día)" : ""}` : `${e.start} ${who}${t}`;
}

function choreLines(L, me, when) {
  const out = [];
  for (const c of Object.values(L.S.chores)) {
    const st = L.choreState(c);
    if (st.paused || st.done) continue;
    if (st.who && st.who !== me) continue;
    const anyone = !st.who ? " (cualquiera de los dos)" : "";
    if (when === "today" && st.days <= 0) out.push(st.days < 0 ? `${c.name}${anyone} — quedó del ${L.DOWL[L.wdayOf(st.due)]}` : `${c.name}${anyone}`);
    if (when === "pending" && st.days <= 0) out.push(`${c.name}${anyone}`);
    if (when === "tomorrow" && st.days === 1) out.push(`${c.name}${anyone}`);
  }
  return out;
}

function dueLines(L, me, day, onlyTomorrow) {
  const S = L.S, out = [];
  const all = [...Object.values(S.dues).filter(d => !d.owner || d.owner === me || !S.people[d.owner]), ...Object.values(S.priv.dues || {})];
  for (const d of all) {
    if (d.doneAt || !d.due) continue;
    const n = L.daysBetween(day, d.due), lead = d.lead ?? 7;
    if (onlyTomorrow ? n !== 1 : !(n === 0 || n === 1 || n === -1 || n === lead)) continue;
    const t = d.title || "Fecha";
    if (d.cat === "familia") {
      const gift = S.priv.gifts?.["gift_" + d.id]?.idea;
      const hint = n > 0 && !gift ? " — ¿ya pensaron el regalo?" : "";
      out.push(n === 0 ? `Hoy: ${t} 🎉` : n === -1 ? `Ayer fue: ${t}` : n === 1 ? `Mañana: ${t}${hint}` : `En ${n} días: ${t}${hint}`);
    } else out.push(n === 0 ? `Vence hoy: ${t}` : n === -1 ? `Venció ayer: ${t}` : n === 1 ? `Vence mañana: ${t}` : `Vence en ${n} días: ${t}`);
  }
  return out;
}

// Un fijo se avisa el día que vence; si no se cargó, también al día siguiente y después cada 7 días (dentro del mes).
function fixedWhen(L, t, day) {
  const due = L.monthDay(day.slice(0, 7), t.day), n = L.daysBetween(due, day);
  return n === 0 ? "today" : n === 1 || (n > 0 && n % 7 === 0) ? "late" : null;
}
// Un fijo compartido le toca a quien lo paga (si sigue en el grupo); si no tiene, a todos los del grupo.
function fixedForMe(S, t, me) {
  const mem = S.groups[t.group]?.members || [];
  if (!mem.includes(me)) return false;
  return t.paidBy && mem.includes(t.paidBy) && S.people[t.paidBy] ? t.paidBy === me : true;
}
function fixedLines(L, me, day) {
  const S = L.S, ym = day.slice(0, 7), out = [];
  const label = t => `${t.desc || t.title || t.name || "Gasto fijo"}${Number(t.amount) ? " (" + L.money(t.amount, t.cur) + ")" : ""}`;
  const line = (w, t, txt) => w === "today" ? txt : `Pendiente: ${txt} (vencía el ${Number(L.monthDay(ym, t.day).slice(8))})`;
  for (const t of Object.values(S.fixed)) { const w = fixedWhen(L, t, day); if (w && fixedForMe(S, t, me) && !L.fixedDone(t, ym)) out.push(line(w, t, label(t))); }
  for (const t of Object.values(S.priv.tpl || {})) { const w = fixedWhen(L, t, day); if (w && !L.tplDone(t, ym)) out.push(line(w, t, (t.type === "ingreso" ? "Cobro: " : "") + label(t))); }
  return out.sort((a, b) => (a.startsWith("Pendiente") ? 1 : 0) - (b.startsWith("Pendiente") ? 1 : 0));
}

// Tareas para tocar "hecha" desde Telegram: las de hoy (o atrasadas) que son tuyas o de cualquiera. Máximo 6.
function choreButtons(L, me) {
  const out = [];
  for (const c of Object.values(L.S.chores)) {
    const st = L.choreState(c);
    if (st.paused || st.done || st.days > 0 || (st.who && st.who !== me)) continue;
    const data = "d:" + c.id;
    if (Buffer.byteLength(data) > 64) continue;
    out.push({text:"✅ " + String(c.name || "Tarea").slice(0, 40), data});
    if (out.length === 6) break;
  }
  return out;
}

const bullets = (head, xs) => xs.length ? [head, ...xs.map(x => "• " + x)].join("\n") : "";

// Resumen del día ("morning") o de la noche ("evening"). Devuelve null si no hay nada.
function digest(L, shared, user, day, mode, nowMs = Date.now()) {
  const me = useUser(L, shared, user, day);
  if (!me) return null;
  const notif = notifOf(user.settings), name = L.pName(me);
  const blocks = [];
  if (mode === "morning") {
    blocks.push(bullets("🧹 Te toca hoy:", choreLines(L, me, "today")));
    blocks.push(bullets("📅 Agenda de hoy:", eventsOn(L, notif, day).map(e => evLine(L, e, day))));
    blocks.push(bullets("⏰ Fechas:", dueLines(L, me, day, false)));
    blocks.push(bullets("💸 Gastos fijos:", fixedLines(L, me, day)));
    const polls = Object.values(L.S.polls).filter(p => { const st = L.pollState(p); return st.iAmIn && !st.myDone; }).map(p => p.title || "Votación");
    blocks.push(bullets("🗳️ Te falta votar:", polls));
    const thanks = Object.values(L.S.thanks).filter(t => t.to === me && !t.seenAt && (t.createdAt || 0) > nowMs - 26 * 3600e3);
    if (thanks.length) blocks.push(thanks.map(t => `💛 ${L.pName(t.from)} te dejó un gracias${t.text ? ": “" + t.text + "”" : ""}`).join("\n"));
  } else {
    const tomorrow = L.ymdShift(day, 1);
    blocks.push(bullets("🧹 Quedó pendiente hoy:", choreLines(L, me, "pending")));
    blocks.push(bullets("🧹 Mañana te toca:", choreLines(L, me, "tomorrow")));
    blocks.push(bullets("📅 Mañana en la agenda:", eventsOn(L, notif, tomorrow).map(e => evLine(L, e, tomorrow))));
    blocks.push(bullets("⏰ Fechas:", dueLines(L, me, day, true)));
  }
  const body = blocks.filter(Boolean).join("\n\n");
  if (!body) return null;
  const buttons = choreButtons(L, me);
  return {title:mode === "morning" ? `Buen día, ${name} ☀️` : `Para mañana, ${name} 🌙`, body, tag:mode, ...(buttons.length ? {buttons} : {})};
}

// ---------- resumen semanal ----------
const DOW_S = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const dayShort = (L, d) => `${DOW_S[L.wdayOf(d)]} ${Number(d.slice(8))}`;
const norm = s => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const CUR_SYM = {ARS:"$", USD:"US$", EUR:"€", BRL:"R$", UYU:"$U", CLP:"CLP$"};
// "$5.000" o "$1.234,50": más corto que money() de la app, para respuestas del bot.
const moneyShort = (v, cur) => (CUR_SYM[cur] || "$") + new Intl.NumberFormat("es-AR", {minimumFractionDigits:Number.isInteger(+v) ? 0 : 2, maximumFractionDigits:2}).format(+v || 0);

// Lo que viene en los próximos 7 días, quién hizo qué, cuentas, listas y un gracias.
function weekly(L, shared, user, day, nowMs = Date.now(), rnd = Math.random) {
  const me = useUser(L, shared, user, day);
  if (!me) return null;
  const S = L.S, notif = notifOf(user.settings), name = L.pName(me), blocks = [];
  // agenda: de mañana a 7 días (los de varios días, una sola vez)
  const seen = new Set(), evs = [];
  for (let i = 1; i <= 7; i++) {
    const d = L.ymdShift(day, i);
    for (const e of eventsOn(L, notif, d)) { if (seen.has(e.id)) continue; seen.add(e.id); evs.push(`${dayShort(L, d)} · ${evLine(L, e, d)}`); }
  }
  blocks.push(bullets("📅 Lo que viene:", evs.length > 12 ? [...evs.slice(0, 12), `y ${evs.length - 12} más`] : evs));
  // fechas que vencen en la semana
  const dues = [...Object.values(S.dues).filter(d => !d.owner || d.owner === me || !S.people[d.owner]), ...Object.values(S.priv.dues || {})]
    .filter(d => !d.doneAt && d.due && L.daysBetween(day, d.due) >= 0 && L.daysBetween(day, d.due) <= 7).sort((a, b) => a.due.localeCompare(b.due))
    .map(d => d.cat === "familia" ? `${d.title || "Fecha"} — ${dayShort(L, d.due)} 🎉` : `${d.title || "Fecha"} — vence el ${dayShort(L, d.due)}`);
  blocks.push(bullets("⏰ Fechas:", dues));
  // tareas hechas en los últimos 7 días, por persona
  const from = L.ymdShift(day, -6), count = {};
  for (const l of Object.values(S.choreLog)) if (l.chore && !l.skip && l.by && l.date >= from && l.date <= day) count[l.by] = (count[l.by] || 0) + 1;
  const who = Object.keys(count).filter(id => S.people[id]).sort((a, b) => (a === me ? -1 : b === me ? 1 : L.pName(a).localeCompare(L.pName(b))));
  if (who.length) blocks.push("🧹 Tareas de la semana: " + who.map(id => `${id === me ? "vos" : L.pName(id)} ${count[id]}`).join(", ") + ". ¡Bien ahí!");
  // cuentas en cada grupo
  const groups = Object.values(S.groups).filter(g => (g.members || []).includes(me)).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const bal = [];
  for (const g of groups) {
    const pre = groups.length > 1 ? `${g.name || "Grupo"}: ` : "";
    const lines = [];
    for (const [cur, net] of Object.entries(L.balances(g.id))) for (const t of L.settle(net)) {
      if (t.to === me) lines.push(`${pre}${L.pName(t.from)} te debe ${L.money(t.amount, cur)}`);
      else if (t.from === me) lines.push(`${pre}Le debés ${L.money(t.amount, cur)} a ${L.pName(t.to)}`);
    }
    if (!lines.length && L.groupExpenses(g.id).length) lines.push(`${pre}Están a mano ✨`);
    bal.push(...lines);
  }
  blocks.push(bullets("💸 Cuentas:", bal));
  // listas
  const open = Object.values(S.items).filter(i => !i.done && S.lists[i.list]).length;
  if (open) blocks.push(`🛒 Quedan ${open} ${open === 1 ? "cosa" : "cosas"} sin tachar en las listas.`);
  // un gracias de la semana
  const ty = Object.values(S.thanks).filter(t => t.to === me && (t.createdAt || 0) > nowMs - 7 * 864e5);
  const pool = ty.filter(t => !t.seenAt).length ? ty.filter(t => !t.seenAt) : ty;
  if (pool.length) { const t = pool[Math.floor(rnd() * pool.length) % pool.length]; blocks.push(`💛 ${L.pName(t.from)} te dejó un gracias${t.text ? ": “" + t.text + "”" : ""}`); }
  const body = blocks.filter(Boolean).join("\n\n");
  if (!body) return null;
  return {title:`Tu semana, ${name} 🗓️`, body, tag:"weekly"};
}

// ---------- presupuestos ----------
// Avisa una vez por categoría, umbral (80% y 100%) y mes. `sent` es lo ya avisado; devuelve el nuevo.
function budgetAlerts(L, shared, user, day, sent = {}) {
  const ym = day.slice(0, 7), keep = Object.fromEntries(Object.entries(sent || {}).filter(([k]) => k.startsWith(ym + "|")));
  const me = useUser(L, shared, user, day);
  if (!me) return {msgs:[], sent:keep};
  const S = L.S, budgets = (user.settings && user.settings.budgets) || {}, cats = expCats(L), spent = {}, msgs = [];
  const add = (cur, cat, v) => { const k = cur + ":" + cat; spent[k] = (spent[k] || 0) + v; };
  // igual que la app (Finanzas → Por categoría): tus gastos personales + tu parte de los compartidos
  for (const t of Object.values(S.priv.tx || {})) if (t.type === "gasto" && (t.date || "").startsWith(ym)) add(t.cur, t.cat, Number(t.amount) || 0);
  for (const e of Object.values(S.expenses)) if (L.isExp(e) && (e.date || "").startsWith(ym)) { const s = L.shares(e)[me]; if (s > 0) add(e.cur, e.cat, s); }
  for (const [k, b0] of Object.entries(budgets)) {
    const b = Number(b0), v = L.r2(spent[k] || 0);
    if (!(b > 0) || !k.includes(":")) continue;
    const th = [100, 80].find(x => v >= b * x / 100);
    if (!th || keep[`${ym}|${k}|${th}`]) continue;
    for (const x of [80, 100]) if (x <= th) keep[`${ym}|${k}|${x}`] = 1;
    const [cur, cat] = [k.slice(0, k.indexOf(":")), k.slice(k.indexOf(":") + 1)];
    const name = cats.find(c => c.id === cat)?.name || cat;
    const over = v > b ? ` Te pasaste por ${L.money(L.r2(v - b), cur)}.` : "";
    msgs.push({title:`${name}: ya usaste el ${th}% de tu presupuesto (día ${Number(day.slice(8))})`, body:`Llevás ${L.money(v, cur)} de ${L.money(b, cur)} este mes.${over}`, tag:`budget-${k}-${th}`});
  }
  return {msgs, sent:keep};
}

// ---------- bot de Telegram: comandos ----------
const newId = (nowMs = Date.now()) => nowMs.toString(36) + Math.random().toString(36).slice(2, 7);
function parseCommand(text) {
  const m = /^\/([a-zñáéíóú]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(String(text || "").trim());
  return m ? {cmd:norm(m[1]), args:(m[2] || "").trim()} : null;
}
const MULT = /^(k|lucas?|luquitas?|mil)$/i;
const CUR_WORDS = {usd:"USD", "u$s":"USD", "us$":"USD", dolar:"USD", dolares:"USD", verdes:"USD", euro:"EUR", euros:"EUR", reales:"BRL"};
// "5000", "$5.000", "12k", "12 lucas", "1,5 mil" → número (o null)
function takeAmount(L, toks) {
  let i = 0;
  if (toks[0] === "$") i = 1;
  const m = /^\$?([\d.,]+)(k|lucas?|luquitas?|mil)?$/i.exec(toks[i] || "");
  if (!m) return null;
  let used = i + 1, mult = m[2] ? 1000 : 1;
  if (!m[2] && toks[used] && MULT.test(toks[used])) { mult = 1000; used++; }
  const n = L.parseAmt(m[1]);
  if (!(n > 0)) return null;
  return {amount:L.r2(n * mult), rest:toks.slice(used)};
}
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const myGroups = (S, me) => Object.values(S.groups).filter(g => (g.members || []).includes(me))
  .sort((a, b) => (a.id === "nosotros" ? -1 : b.id === "nosotros" ? 1 : (a.createdAt || 0) - (b.createdAt || 0) || (a.name || "").localeCompare(b.name || "")));
const BAD = msg => ({error:msg});
// Como clean() de la app: sin undefined y con objetos "normales" (lo que sale del sandbox no lo acepta Firestore).
const plain = o => JSON.parse(JSON.stringify(o));
// Igual que la app (guessCat), probando también sin tildes ("súper" → super).
const guess = (L, desc, cats) => L.guessCat(desc, cats) || L.guessCat(norm(desc), cats) || (cats.some(c => c.id === "otros") ? "otros" : cats[0].id);
const expCats = L => { const c = L.cfg().expCats; const ok = Array.isArray(c) ? c.filter(k => k && typeof k.id === "string") : []; return ok.length ? ok : L.DEF_CFG.expCats; };

// /gasto <monto> <descripción> [mitad|yo|vos|todo de X|X pagó|en <grupo>] → gasto compartido igual al que guarda la app.
function parseGasto(L, args, {me, day, nowMs = Date.now(), id = newId(nowMs), settings = {}}) {
  const S = L.S;
  const a = takeAmount(L, args.replace(/,(?=\s|$)/g, " ").split(/\s+/).filter(Boolean));
  if (!a) return BAD("Escribilo así: /gasto 5000 súper (o /gasto 12 lucas nafta mitad)");
  let toks = a.rest, cur = null, only = null, paidBy = me, equal = false, group = null;
  if (toks.length && CUR_WORDS[norm(toks[0])]) { cur = CUR_WORDS[norm(toks[0])]; toks = toks.slice(1); }
  const gs = myGroups(S, me);
  if (!gs.length) return BAD("Primero armá un grupo en la app (Cuentas) para cargar gastos compartidos.");
  // "en <grupo>" (puede tener varias palabras)
  for (let i = 0; i < toks.length && !group; i++) if (norm(toks[i]) === "en") for (const g of gs) {
    const n = norm(g.name).split(/\s+/).length;
    if (norm(toks.slice(i + 1, i + 1 + n).join(" ")) === norm(g.name)) { group = g; toks = [...toks.slice(0, i), ...toks.slice(i + 1 + n)]; break; }
  }
  const g = group || gs[0];
  const members = (g.members || []).filter(x => S.people[x]);
  const others = members.filter(x => x !== me);
  const byName = t => members.find(x => norm(L.pName(x)) === norm(t)) || members.find(x => norm(L.pName(x)).split(/\s+/)[0] === norm(t));
  // modificadores al final
  for (let guard = 0; toks.length && guard < 10; guard++) {
    const n = toks.map(norm), k = n.length, last = n[k - 1], prev = n[k - 2];
    if (CUR_WORDS[last]) { cur = CUR_WORDS[last]; toks = toks.slice(0, -1); }
    else if (last === "mitad" || last === "medias" && prev === "a" || last === "dos" && prev === "los" && n[k - 3] === "entre") { equal = true; toks = toks.slice(0, last === "mitad" ? (prev === "y" && n[k - 3] === "mitad" ? -3 : -1) : last === "medias" ? -2 : -3); }
    else if (["yo", "mio", "mia"].includes(last) && !(prev === "pague")) { only = me; toks = toks.slice(0, prev === "todo" || prev === "para" ? -2 : -1); }
    else if (last === "mi" && prev === "para") { only = me; toks = toks.slice(0, -2); }
    else if (["vos", "tuyo", "tuya"].includes(last)) {
      if (others.length !== 1) return BAD(`En "${g.name}" hay más de dos personas: decí de quién es, por ejemplo "todo de ${others[0] ? L.pName(others[0]) : "Lucas"}".`);
      only = others[0]; toks = toks.slice(0, prev === "todo" || prev === "para" ? -2 : -1);
    }
    else if ((last === "pago" || last === "pagaste") && k >= 2 && byName(toks[k - 2])) { paidBy = byName(toks[k - 2]); toks = toks.slice(0, -2); }
    else if (prev === "pago" && byName(toks[k - 1])) { paidBy = byName(toks[k - 1]); toks = toks.slice(0, -2); }
    else if (last === "pague" || last === "yo" && prev === "pague") { paidBy = me; toks = toks.slice(0, last === "yo" ? -2 : -1); }
    else if (k >= 3 && n[k - 3] === "todo" && prev === "de" && byName(toks[k - 1])) { only = byName(toks[k - 1]); toks = toks.slice(0, -3); }
    else if (prev === "para" && byName(toks[k - 1])) { only = byName(toks[k - 1]); toks = toks.slice(0, -2); }
    else break;
  }
  const desc = cap(toks.join(" ").replace(/[,;.\s]+$/, "").trim()).slice(0, 80);
  if (!desc) return BAD("Poné una descripción, por ejemplo: /gasto 5000 súper");
  if (!members.includes(me)) return BAD("No estás en ese grupo.");
  const sp = only ? {splitMode:"exact", split:{[only]:a.amount}} : equal ? {splitMode:"equal", split:Object.fromEntries(members.map(x => [x, true]))} : L.groupDefaultSplit(g, members);
  const cats = expCats(L);
  const cat = guess(L, desc, cats);
  const doc = plain({id, group:g.id, cur:cur || (L.CURS.includes(g.cur) ? g.cur : null) || settings.cur || "ARS", date:day, amount:a.amount, createdBy:me, createdAt:nowMs, updatedAt:nowMs,
    kind:"expense", desc, paidBy, cat, splitMode:sp.splitMode, split:sp.split, note:"", updatedBy:me, source:"telegram"});
  const ids = Object.keys(doc.split);
  const how = only ? (only === me ? "todo tuyo" : `todo de ${L.pName(only)}`)
    : doc.splitMode === "equal" ? (ids.length === 2 && ids.includes(me) ? `mitad con ${L.pName(ids.find(x => x !== me))}` : `entre ${ids.length}`) : "según el grupo";
  const extra = [how, paidBy !== me ? `pagó ${L.pName(paidBy)}` : "", gs.length > 1 ? `en ${g.name}` : ""].filter(Boolean).join(", ");
  return {doc, path:"expenses/" + id, reply:`✅ Cargado: ${moneyShort(doc.amount, doc.cur)} ${desc} (${extra})`};
}

// /yo <monto> <descripción> → movimiento personal (solo lo ve quien lo carga).
function parseYo(L, args, {uid, day, nowMs = Date.now(), id = newId(nowMs), settings = {}}) {
  const a = takeAmount(L, args.split(/\s+/).filter(Boolean));
  if (!a) return BAD("Escribilo así: /yo 3500 farmacia");
  let toks = a.rest, cur = null;
  if (toks.length && CUR_WORDS[norm(toks[toks.length - 1])]) { cur = CUR_WORDS[norm(toks[toks.length - 1])]; toks = toks.slice(0, -1); }
  if (toks.length && CUR_WORDS[norm(toks[0])]) { cur = CUR_WORDS[norm(toks[0])]; toks = toks.slice(1); }
  const desc = cap(toks.join(" ").trim()).slice(0, 80), cats = expCats(L);
  const cat = guess(L, desc, cats);
  const doc = plain({id, kind:"tx", type:"gasto", desc, amount:a.amount, cur:cur || (L.CURS.includes(settings.cur) ? settings.cur : "ARS"), date:day, cat, createdAt:nowMs, source:"telegram"});
  const cn = L.catOf(cats, cat).name;
  return {doc, path:`data/users/${uid}/${id}`, reply:`✅ Anotado en tus gastos: ${moneyShort(doc.amount, doc.cur)}${desc ? " " + desc : ""} · ${cn} (solo lo ves vos)`};
}

// La lista de compras: la primera que se llame "Compras" o "Súper"; si no, la creada más recientemente.
function shopList(lists) {
  const all = Object.values(lists || {}).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return all.find(l => /compra|super/.test(norm(l.name))) || all[all.length - 1] || null;
}
// /compra leche, pan → ítems de lista (y la lista "Compras" si no hay ninguna).
function parseCompra(L, args, {me, nowMs = Date.now(), mkId = () => newId(nowMs)}) {
  const S = L.S, texts = args.split(/[,;\n]+/).map(t => t.trim().slice(0, 120)).filter(Boolean).slice(0, 30);
  if (!texts.length) return BAD("Escribilo así: /compra leche, pan, huevos");
  const writes = [];
  let list = shopList(S.lists);
  if (!list) { const lid = mkId(); list = {id:lid, name:"Compras", createdAt:nowMs}; writes.push({path:"lists/" + lid, doc:list}); }
  const have = new Set(Object.values(S.items).filter(i => i.list === list.id && !i.done).map(i => norm(i.text)));
  const added = [], dup = [];
  texts.forEach(t => {
    if (have.has(norm(t))) { dup.push(t); return; }
    have.add(norm(t));
    const id = mkId();
    writes.push({path:"items/" + id, doc:{id, list:list.id, text:t, done:false, by:me, createdAt:nowMs + added.length}});
    added.push(t);
  });
  const reply = [added.length ? `🛒 Agregué a ${list.name}: ${added.join(", ")}` : "", dup.length ? `Ya estaban: ${dup.join(", ")}` : ""].filter(Boolean).join("\n");
  return {writes:plain(writes), reply, list};
}
// /falta [lista|todo] → lo que queda sin tachar.
function faltaText(L, args) {
  const S = L.S, lists = Object.values(S.lists).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  if (!lists.length) return "Todavía no hay listas. Probá /compra leche, pan";
  const open = l => Object.values(S.items).filter(i => i.list === l.id && !i.done).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).map(i => i.text);
  const q = norm(args);
  const one = q && q !== "todo" && q !== "todas" ? lists.find(l => norm(l.name) === q) || lists.find(l => norm(l.name).includes(q)) : !q ? lists.find(l => /compra|super/.test(norm(l.name))) : null;
  if (one) { const xs = open(one); return xs.length ? bullets(`🛒 Falta en ${one.name}:`, xs) : `En ${one.name} no falta nada 🙌`; }
  const parts = lists.map(l => bullets(`🛒 ${l.name}:`, open(l))).filter(Boolean);
  return parts.length ? parts.join("\n\n") : "No falta nada en las listas 🙌";
}

// ---------- botones "hecha" ----------
// Registra una tarea como hecha igual que el botón "Hecha ✓" de la app; si ya estaba hecha, no escribe nada.
function choreTap(L, shared, user, choreId, day, nowMs = Date.now(), id = newId(nowMs)) {
  const me = useUser(L, shared, user, day);
  if (!me) return {reply:"No encontré tu perfil en Entre Dos."};
  const c = L.S.chores[choreId];
  if (!c) return {reply:"Esa tarea ya no está."};
  const st = L.choreState(c), wk = L.isWeekdayChore(c);
  const occ = wk ? L.choreOccCover(c, st.pend, day) : undefined;
  const logs = Object.values(L.S.choreLog).filter(l => l.chore === c.id);
  if (st.done || st.days > 0 || logs.some(l => !l.skip && l.date === day) || (occ && logs.some(l => l.occ === occ)))
    return {already:true, reply:"Ya estaba hecha 👌"};
  const log = {id, chore:c.id, by:me, date:day, points:c.points || 1, createdAt:nowMs, ...(occ ? {occ} : {})};
  return {log:plain(log), path:"choreLog/" + id, reply:`¡Bien! "${c.name}" hecha`};
}
// Teclado de Telegram: botones de tareas (de a 2 por fila) + el link a la app.
function tgMarkup(buttons, appUrl) {
  const rows = [];
  for (let i = 0; i < (buttons || []).length; i += 2) rows.push(buttons.slice(i, i + 2).map(b => ({text:b.text, callback_data:b.data})));
  if (appUrl) rows.push([{text:"Abrir Entre Dos", url:appUrl}]);
  return rows.length ? {reply_markup:{inline_keyboard:rows}} : {};
}
// Marca con ✔️ el botón tocado (y lo desactiva).
function markDone(markup, data) {
  const rows = (markup && markup.inline_keyboard) || [];
  return {inline_keyboard:rows.map(r => r.map(b => b.callback_data === data ? {text:"✔️ " + String(b.text).replace(/^✅\s*/, ""), callback_data:"x"} : b))};
}

const HELP = `Soy el bot de avisos de Entre Dos.

/hoy — lo que tenés hoy
/manana — lo que viene mañana
/semana — tu semana: agenda, tareas, cuentas y listas
/gasto 5000 súper — gasto compartido (sumá "mitad", "yo", "vos", "Lucas pagó" o "en <grupo>")
/yo 3500 farmacia — gasto personal (solo lo ves vos)
/compra leche, pan — suma a la lista de compras
/falta — lo que queda en la lista (/falta todo: todas)
/precio yerba 4500 — anota cuánto salió algo (inflación del súper)
/deshacer — borra lo último que cargaste acá (hasta 24 h)

🎙️ También podés mandarme un audio o la foto de un ticket.

Para conectarme, entrá a la app → Ajustes → Avisos → Telegram → Conectar.`;

// Eventos con horario de hoy (propios o compartidos con vos), para avisar un rato antes.
function timedToday(L, shared, user, day) {
  const me = useUser(L, shared, user, day);
  if (!me) return [];
  const notif = {...notifOf(user.settings), partner:false};
  return eventsOn(L, notif, day).filter(e => !e.allDay && toMin(e.start) != null && !(e.endDate && e.endDate > e.date && e.date !== day))
    .map(e => ({key:`${e.id}|${day}`, start:e.start, title:e.title || "(sin título)", place:e.place || ""}));
}

// Decide qué mandar en esta corrida. `st` es el estado guardado de esta persona.
// `load(kind)` trae datos solo si hacen falta: kind = "full" o "events".
async function plan({L, user, now, st, load}) {
  const settings = user.settings || {}, notif = notifOf(settings);
  const loc = localNow(now, settings.tz), msgs = [], next = {...st, pings:{...(st.pings || {})}};
  const due = (on, hm, last) => on && toMin(hm) != null && loc.min >= toMin(hm) && loc.min < toMin(hm) + WINDOW && last !== loc.day;
  if (due(notif.morning, notif.time, st.morning)) { const m = digest(L, await load("full"), user, loc.day, "morning", now.getTime()); if (m) msgs.push(m); next.morning = loc.day; }
  if (due(notif.evening, notif.eveTime, st.evening)) { const m = digest(L, await load("full"), user, loc.day, "evening", now.getTime()); if (m) msgs.push(m); next.evening = loc.day; }
  // semanal: los domingos (hora local), una vez
  if (due(notif.weekly && weekday(loc.day) === 0, notif.weeklyTime, st.weekly)) { const m = weekly(L, await load("weekly"), user, loc.day, now.getTime()); if (m) msgs.push(m); next.weekly = loc.day; }
  // presupuestos: como mucho cada 3 horas, de 9 a 22
  if (notif.budget && Object.keys(settings.budgets || {}).length && loc.min >= 9 * 60 && loc.min < 22 * 60 && now.getTime() - (st.budgetAt || 0) >= 3 * 3600e3) {
    const r = budgetAlerts(L, await load("budget"), user, loc.day, st.budget);
    msgs.push(...r.msgs); next.budget = r.sent; next.budgetAt = now.getTime();
  }
  if (notif.before) {
    const stale = !st.today || st.today.day !== loc.day || now.getTime() - (st.today.at || 0) > 55 * 60e3;
    if (stale && loc.min >= 5 * 60) next.today = {day:loc.day, at:now.getTime(), list:timedToday(L, await load("events"), user, loc.day)};
    for (const ev of (next.today && next.today.day === loc.day ? next.today.list : [])) {
      const left = toMin(ev.start) - loc.min;
      if (left > 0 && left <= PING_AHEAD && !next.pings[ev.key]) {
        msgs.push({title:`En ${left >= 55 ? "1 hora" : left + " min"}: ${ev.title}`, body:`A las ${ev.start}${ev.place ? " · " + ev.place : ""}`, tag:"ev-" + ev.key});
        next.pings[ev.key] = now.getTime();
      }
    }
  }
  for (const [k, at] of Object.entries(next.pings)) if (now.getTime() - at > 2 * 864e5) delete next.pings[k];
  if (settings.testAt && settings.testAt > (st.testDone || 0)) {
    msgs.push({title:"Aviso de prueba ✅", body:"Si ves esto, los avisos de Entre Dos funcionan.", tag:"test"});
    next.testDone = settings.testAt;
  }
  return {msgs, st:next};
}

// ---------- Inversiones: resumen mensual cuando el INDEC publica la inflación ----------
// summary = data/users/{uid}/inv_summary (lo arma la app), ipcSeries = [{fecha:"2026-09-30", valor:1.9}]
const pctTxt = x => (x >= 0 ? "+" : "−") + Math.abs(x * 100).toLocaleString("es-AR", {maximumFractionDigits:1, minimumFractionDigits:1}) + "%";
const arsTxt = v => "$" + Math.round(Math.abs(v)).toLocaleString("es-AR");
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
function invRecapMsg(summary, ipcSeries) {
  if (!summary || !summary.months || !Array.isArray(ipcSeries) || !ipcSeries.length) return null;
  const ipc = Object.fromEntries(ipcSeries.map(x => [String(x.fecha).slice(0, 7), Number(x.valor) / 100]));
  const ym = Object.keys(ipc).sort().pop();
  const m = summary.months[ym];
  if (!m || m.partial || !m.ars || m.ars.r == null) return null;
  const r = m.ars.r, inf = ipc[ym], pp = (r - inf) * 100, mes = MESES[Number(ym.slice(5)) - 1];
  const verdict = pp > 0.5 ? `le ganaste por ${Math.abs(pp).toFixed(1).replace(".", ",")} puntos 🟢` : pp < -0.5 ? `te ganó por ${Math.abs(pp).toFixed(1).replace(".", ",")} puntos 🔴` : "quedaste prácticamente igual 🟡";
  const lines = [`${m.ars.g >= 0 ? "Ganaste" : "Perdiste"} ${arsTxt(m.ars.g)} (${pctTxt(r)}). La inflación fue ${pctTxt(inf).replace("+", "")}, así que ${verdict}.`];
  if (m.usd && m.usd.r != null) lines.push(`En dólares: ${m.usd.g >= 0 ? "+" : "−"}US$ ${Math.abs(Math.round(m.usd.g)).toLocaleString("es-AR")} (${pctTxt(m.usd.r)}).`);
  // en lo que va del año
  const y = ym.slice(0, 4); let R = 1, I = 1, n = 0;
  for (const [k, v] of Object.entries(summary.months)) if (k.startsWith(y) && k <= ym && !v.partial && v.ars && v.ars.r != null && ipc[k] != null) { R *= 1 + v.ars.r; I *= 1 + ipc[k]; n++; }
  if (n > 1) lines.push(`En el año vas ${pctTxt(R - 1)} contra ${pctTxt(I - 1).replace("+", "")} de inflación${R > I ? " 🟢" : ""}.`);
  if (pp < -0.5 && n > 1 && R > I) lines.push("Un mes flojo pasa: lo importante es cómo va en varios meses.");
  return {ym, msg:{title:`📈 Tus inversiones en ${mes}`, body:lines.join("\n"), tag:"inv-" + ym}};
}

// /precio yerba 1kg 4500  (el monto puede ir al final o al principio) → documento de "prices" igual al de la app
const priceKey = t => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\b\d+\s*(kg|g|gr|l|lt|ml|u|un|x)\b/g, "").replace(/[^a-z0-9ñ ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
function parsePrecio(L, args, {me, day, nowMs}) {
  const toks = String(args || "").trim().split(/\s+/).filter(Boolean);
  if (toks.length < 2) return BAD("Escribí el producto y el precio, por ejemplo: /precio yerba 4500");
  let a = takeAmount(L, toks.slice(-2).join(" ").match(/lucas?|mil|k$/i) ? toks.slice(-2) : toks.slice(-1)), text;
  if (a) text = toks.slice(0, toks.length - (toks.slice(-2).join(" ").match(/lucas?|mil|k$/i) && !/^\$?[\d.,]+(k|lucas?|mil)$/i.test(toks[toks.length - 1]) ? 2 : 1)).join(" ");
  else { a = takeAmount(L, toks); if (!a) return BAD("No encontré el precio. Ejemplo: /precio yerba 4500"); text = a.rest.join(" "); }
  text = cap(text.trim()); if (!text) return BAD("¿De qué producto? Ejemplo: /precio yerba 4500");
  const id = "p" + nowMs.toString(36) + Math.random().toString(36).slice(2, 6);
  return {path:"prices/" + id, doc:plain({id, key:priceKey(text), text:text.slice(0, 120), price:a.amount, date:day, by:me, createdAt:nowMs, source:"telegram"}), reply:`🏷️ Anotado: ${text} ${"$" + Math.round(a.amount).toLocaleString("es-AR")}`};
}

module.exports = {parsePrecio, priceKey, invRecapMsg, NOTIF_DEF, DEF_TZ, HELP, toMin, localNow, notifOf, useUser, digest, weekly, budgetAlerts, timedToday, plan, fixedWhen, fixedForMe, choreButtons,
  parseCommand, takeAmount, parseGasto, parseYo, parseCompra, shopList, faltaText, choreTap, tgMarkup, markDone, newId, moneyShort};
