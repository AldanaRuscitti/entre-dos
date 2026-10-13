// Qué avisar y cuándo. No toca la red ni la base: recibe datos y devuelve mensajes.
"use strict";

const DEF_TZ = "America/Argentina/Buenos_Aires";
const NOTIF_DEF = {morning:true, time:"08:30", evening:false, eveTime:"21:00", before:true, partner:true};
const WINDOW = 180;      // minutos: si el resumen se atrasó más que esto, ese día se saltea
const PING_AHEAD = 70;   // minutos: aviso "antes de un evento" (el proceso corre cada 15 min)

const toMin = hm => { const m = /^(\d{1,2}):(\d{2})$/.exec(hm || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
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
  for (const k of ["people", "events", "chores", "choreLog", "dues", "polls", "thanks", "fixed", "groups", "expenses"]) S[k] = shared[k] || {};
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

function fixedLines(L, me, day) {
  const S = L.S, ym = day.slice(0, 7), out = [];
  const label = t => `${t.desc || t.title || t.name || "Gasto fijo"}${Number(t.amount) ? " (" + L.money(t.amount, t.cur) + ")" : ""}`;
  for (const t of Object.values(S.fixed)) if ((S.groups[t.group]?.members || []).includes(me) && L.monthDay(ym, t.day) === day && !L.fixedDone(t, ym)) out.push(label(t));
  for (const t of Object.values(S.priv.tpl || {})) if (L.monthDay(ym, t.day) === day && !L.tplDone(t, ym)) out.push((t.type === "ingreso" ? "Cobro: " : "") + label(t));
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
    blocks.push(bullets("💸 Fijos de hoy:", fixedLines(L, me, day)));
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
  return {title:mode === "morning" ? `Buen día, ${name} ☀️` : `Para mañana, ${name} 🌙`, body, tag:mode};
}

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

module.exports = {NOTIF_DEF, DEF_TZ, toMin, localNow, notifOf, digest, timedToday, plan};
