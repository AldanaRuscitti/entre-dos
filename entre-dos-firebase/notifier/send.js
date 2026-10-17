// Proceso de avisos de Entre Dos. Lo corre GitHub Actions cada 15 minutos (ver .github/workflows/avisos.yml).
// Necesita: FIREBASE_SERVICE_ACCOUNT (JSON de la cuenta de servicio) y TELEGRAM_BOT_TOKEN (opcional). APP_URL es opcional.
"use strict";
const {initializeApp, cert} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");
const {getMessaging} = require("firebase-admin/messaging");
const {load} = require("./extract");
const logic = require("./logic");
const {plan, digest, weekly, localNow, DEF_TZ, HELP, invRecapMsg} = logic;
const gcal = require("./gcal");
const backup = require("./backup");
const BACKUP_PASS = process.env.BACKUP_PASS || "";

const SA = process.env.FIREBASE_SERVICE_ACCOUNT;
const TG = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const APP_URL = (process.env.APP_URL || "").trim();
const GCAL_ID = (process.env.GCAL_ID || "").trim();
if (!SA) { console.log("::error::Falta el secreto FIREBASE_SERVICE_ACCOUNT (Settings → Secrets and variables → Actions)"); process.exit(1); }
let creds;
try { creds = JSON.parse(SA); } catch { console.log("::error::El secreto FIREBASE_SERVICE_ACCOUNT no es un JSON válido: pegá el contenido completo del archivo .json"); process.exit(1); }
initializeApp({credential:cert(creds)});
const db = getFirestore();
const L = load();

const alive = snap => Object.fromEntries(snap.docs.map(d => [d.id, {...d.data(), id:d.id}]).filter(([, v]) => !v.deletedAt));
const userCol = uid => db.collection("data").doc("users").collection(uid);

// ---------- lecturas (pocas: el plan gratis de Firestore da 50.000 por día) ----------
const cache = {}, colCache = {};
const readCol = c => (colCache[c] ||= db.collection(c).get().then(alive));
const once = (k, fn) => (cache[k] ||= fn());
// Para saber el estado de las tareas alcanza con lo hecho en los últimos ~13 meses.
const choreLogSince = day => once("choreLog", () => db.collection("choreLog").where("date", ">=", L.ymdShift(day, -400)).get().then(alive));
const expensesOfFixed = id => once("fx:" + id, () => db.collection("expenses").where("fixedId", "==", id).get().then(alive));
const expensesSince = ym => once("exp:" + ym, () => db.collection("expenses").where("date", ">=", ym + "-01").get().then(alive));
async function sharedData(kind, day) {
  return once("shared:" + kind, async () => {
    const out = {};
    const cols = {events:["people", "events"], budget:["people", "groups", "config"],
      full:["people", "events", "chores", "dues", "polls", "thanks", "fixed", "groups"],
      weekly:["people", "events", "chores", "dues", "polls", "thanks", "fixed", "groups", "lists", "items", "expenses"]}[kind];
    await Promise.all(cols.map(async c => { out[c] = await readCol(c); }));
    if (kind === "full" || kind === "weekly") out.choreLog = await choreLogSince(day);
    if (kind === "full") {
      // Para los gastos fijos solo hace falta saber si ya se cargaron este mes (el día que vencen y los días de recordatorio).
      out.expenses = {};
      for (const t of Object.values(out.fixed)) if (logic.fixedWhen(L, t, day)) Object.assign(out.expenses, await expensesOfFixed(t.id));
    }
    if (kind === "budget") out.expenses = await expensesSince(day.slice(0, 7));
    return out;
  });
}
const KIND = {event:"events", tx:"tx", tpl:"tpl", due:"dues", gift:"gifts"};
async function privData(user, kind, day) {
  return once(user.uid + ":" + kind, async () => {
    const priv = {events:{}, tx:{}, tpl:{}, dues:{}, gifts:{}};
    // presupuestos: solo los movimientos de este mes
    const q = kind === "budget" ? userCol(user.uid).where("date", ">=", day.slice(0, 7) + "-01")
      : userCol(user.uid).where("kind", "in", kind === "events" ? ["event"] : ["event", "tpl", "due", "gift"]);
    for (const d of (await q.get()).docs) { const v = {...d.data(), id:d.id}; if (!v.deletedAt && KIND[v.kind] && (kind !== "budget" || v.kind === "tx")) priv[KIND[v.kind]][d.id] = v; }
    if (kind === "full" || kind === "weekly") for (const t of Object.values(priv.tpl)) if (logic.fixedWhen(L, t, day))
      for (const d of (await userCol(user.uid).where("tplId", "==", t.id).get()).docs) priv.tx[d.id] = {...d.data(), id:d.id};
    return priv;
  });
}
async function withData(user, kind, now) {
  const day = localNow(now, user.settings?.tz).day;
  const [shared, priv] = await Promise.all([sharedData(kind, day), privData(user, kind, day)]);
  user.priv = priv;
  return shared;
}
// Después de escribir algo, que lo leído en esta corrida lo incluya.
async function remember(col, doc) { if (colCache[col]) { const m = await colCache[col]; m[doc.id] = doc; } }
async function forget(path) { const [col, id] = path.split("/"); if (colCache[col] && id) delete (await colCache[col])[id]; }

// ---------- envíos ----------
async function tgCall(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${TG}/${method}`, {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(body)});
  const j = await r.json().catch(() => ({}));
  if (!j.ok) { const e = new Error(`Telegram ${method}: ${j.description || r.status}`); e.code = j.error_code || r.status; throw e; }
  return j.result;
}
const OPEN_URL = /^https:\/\//.test(APP_URL) ? APP_URL : "";
// m.buttons (opcional, solo Telegram): [{text, data}] → botones que vuelven como callback_query
const tgSend = (chat, m) => tgCall("sendMessage", {chat_id:chat, text:`${m.title}\n\n${m.body}`.trim(), disable_web_page_preview:true, ...logic.tgMarkup(m.buttons, OPEN_URL)});
const tgText = (chat, text) => tgCall("sendMessage", {chat_id:chat, text, disable_web_page_preview:true});

async function deliver(user, msgs) {
  let sent = 0;
  if (TG && user.settings?.tgChat) {
    for (const m of msgs) {
      try { await tgSend(user.settings.tgChat, m); sent++; }
      catch (e) { console.log(`::warning::Telegram: no se pudo mandar un aviso (${e.code || "error"})`); if (e.code === 403) await userCol(user.uid).doc("settings").update({tgChat:null}).catch(() => {}); }
    }
  }
  const tokens = (await userCol(user.uid).where("kind", "==", "push").get()).docs;
  for (const d of tokens) {
    for (const m of msgs) {
      try {
        await getMessaging().send({token:d.get("token"), data:{title:m.title, body:m.body, tag:m.tag || "", url:APP_URL || "./"}, webpush:{headers:{Urgency:"high", TTL:"3600"}}});
        sent++;
      } catch (e) {
        if (["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument"].includes(e.code)) { await d.ref.delete().catch(() => {}); break; }
        console.warn("Push:", e.code || e.message);
      }
    }
  }
  return sent;
}

// ---------- Telegram: vincular cuentas, comandos y botones ----------
const UNDO_MS = 24 * 3600e3;
const stateRef = uid => db.collection("notifState").doc(uid);
const saveLast = (user, items, now) => stateRef(user.uid).set({lastBot:{items, at:now.getTime()}}, {merge:true});

// Una actualización de Telegram de una cuenta vinculada. Devuelve el texto de respuesta.
async function command(user, chat, cmd, args, now) {
  const day = localNow(now, user.settings?.tz).day, nowMs = now.getTime(), settings = user.settings || {};
  if (cmd === "hoy" || cmd === "manana") {
    const shared = await withData(user, "full", now);
    const m = digest(L, shared, user, day, cmd === "hoy" ? "morning" : "evening", nowMs);
    await tgSend(chat, m || {title:cmd === "hoy" ? "Hoy no tenés nada pendiente 🙌" : "Mañana viene tranqui 🙌", body:""});
    return null;
  }
  if (cmd === "semana") {
    const m = weekly(L, await withData(user, "weekly", now), user, day, nowMs);
    await tgSend(chat, m || {title:"Semana tranqui 🙌", body:"No hay nada anotado para los próximos días."});
    return null;
  }
  if (cmd === "gasto" || cmd === "yo" || cmd === "compra" || cmd === "falta") {
    const [people, groups, config, lists, items] = await Promise.all(["people", "groups", "config", "lists", "items"].map(readCol));
    const me = logic.useUser(L, {people, groups, config, lists, items}, {...user, priv:{}}, day);
    if (!me) return "No encontré tu perfil en Entre Dos. Entrá a la app y elegí tu perfil.";
    if (cmd === "falta") return logic.faltaText(L, args);
    if (cmd === "gasto" || cmd === "yo") {
      const r = cmd === "gasto" ? logic.parseGasto(L, args, {me, day, nowMs, settings}) : logic.parseYo(L, args, {uid:user.uid, day, nowMs, settings});
      if (r.error) return r.error;
      await db.doc(r.path).set(r.doc);
      if (cmd === "gasto") await remember("expenses", r.doc);
      await saveLast(user, [{path:r.path}], now);
      return r.reply;
    }
    const r = logic.parseCompra(L, args, {me, nowMs});
    if (r.error) return r.error;
    for (const w of r.writes) { await db.doc(w.path).set(w.doc); await remember(w.path.split("/")[0], w.doc); }
    if (r.writes.length) await saveLast(user, r.writes.map(w => ({path:w.path})), now);
    return r.reply;
  }
  if (cmd === "deshacer") {
    const last = (await stateRef(user.uid).get()).get("lastBot");
    if (!last || !Array.isArray(last.items) || !last.items.length || nowMs - (last.at || 0) > UNDO_MS) return "No hay nada para deshacer (solo lo que cargaste acá en las últimas 24 horas).";
    const me = Object.values(await readCol("people")).find(p => p.uid === user.uid)?.id || null;
    let n = 0;
    for (const it of last.items) {
      const ref = db.doc(it.path), snap = await ref.get();
      if (!snap.exists || snap.get("deletedAt")) continue;
      // Igual que la app: lo que tiene papelera se manda ahí; una tarea hecha se borra.
      if (it.hard) await ref.delete(); else await ref.update({deletedAt:nowMs, deletedBy:me});
      await forget(it.path);
      n++;
    }
    await stateRef(user.uid).set({lastBot:null}, {merge:true});
    return n ? "↩️ Listo, lo deshice." + (last.items.some(x => !x.hard) ? " Si te arrepentís, está en la papelera de la app." : "") : "Eso ya estaba borrado.";
  }
  return HELP;
}

// Botón "✅ tarea" de los resúmenes.
async function callback(users, cq, now) {
  const chat = String(cq.message?.chat?.id || ""), data = String(cq.data || "");
  const answer = text => tgCall("answerCallbackQuery", {callback_query_id:cq.id, ...(text ? {text} : {})}).catch(() => {});
  const user = users.find(x => x.settings?.tgChat && x.settings.tgChat === chat);
  if (!user || !data.startsWith("d:")) return answer(data === "x" ? "Ya está 👌" : "");
  const id = data.slice(2), day = localNow(now, user.settings?.tz).day;
  const [people, cDoc, logs] = await Promise.all([readCol("people"), db.collection("chores").doc(id).get(),
    db.collection("choreLog").where("chore", "==", id).get().then(alive)]);   // siempre fresco: así no se duplica
  const chores = cDoc.exists && !cDoc.get("deletedAt") ? {[id]:{...cDoc.data(), id}} : {};
  const r = logic.choreTap(L, {people, chores, choreLog:logs}, {...user, priv:{}}, id, day, now.getTime());
  if (r.log) { await db.doc(r.path).set(r.log); await saveLast(user, [{path:r.path, hard:true}], now); }
  await answer(r.reply);
  if (r.log || r.already) await tgCall("editMessageReplyMarkup", {chat_id:chat, message_id:cq.message.message_id, reply_markup:logic.markDone(cq.message.reply_markup, data)}).catch(() => {});
}

async function telegram(users, now) {
  if (!TG) return;
  const stRef = db.collection("notifState").doc("_telegram");
  const offset = (await stRef.get()).get("offset") || 0;
  let updates;
  try { updates = await tgCall("getUpdates", {offset, timeout:0, allowed_updates:["message", "callback_query"]}); }
  catch (e) { console.log(`::warning::Telegram: no se pudieron leer los mensajes (${e.code || "error"})`); return; }
  if (!updates.length) return;
  for (const u of updates) {
    try {
      if (u.callback_query) { await callback(users, u.callback_query, now); continue; }
      const msg = u.message; if (!msg || !msg.text || !msg.chat) continue;
      const chat = String(msg.chat.id), text = msg.text.trim();
      const pc = logic.parseCommand(text);
      if (pc && pc.cmd === "start" && pc.args) {
        const arg = pc.args.split(/\s+/)[0];
        const user = users.find(x => x.settings?.tgCode && x.settings.tgCode === arg);
        if (!user) { await tgText(chat, "Ese código ya no sirve. Generá uno nuevo en la app: Ajustes → Avisos → Telegram → Conectar."); continue; }
        await userCol(user.uid).doc("settings").update({tgChat:chat, tgCode:null});
        user.settings = {...user.settings, tgChat:chat, tgCode:null};
        await tgText(chat, "¡Listo! Desde ahora te llegan los avisos de Entre Dos acá. 🙌\n\n" + HELP.split("\n\n").slice(1, 2).join(""));
        continue;
      }
      const user = users.find(x => x.settings?.tgChat && x.settings.tgChat === chat);
      if (!pc || !user) { await tgText(chat, HELP); continue; }
      const reply = await command(user, chat, pc.cmd === "mañana" ? "manana" : pc.cmd, pc.args, now);
      if (reply) await tgText(chat, reply);
    } catch (e) { console.log(`::warning::Telegram: falló un comando (${e.code || "error"})`); }
  }
  await stRef.set({offset:updates[updates.length - 1].update_id + 1}, {merge:true});
}

// ---------- Google Calendar (para verlo en el iPhone) ----------
// Solo si está prendido en la app (Ajustes → Avisos, lo ven los dos) y existe el secreto GCAL_ID.
// Se actualiza cuando la app marca un cambio en la agenda (config/sync), con un aviso de prueba, o una vez por día.
async function calendar(users, now) {
  const ref = db.collection("notifState").doc("_gcal");
  const [stDoc, mainDoc, syncDoc] = await Promise.all([ref.get(), db.collection("config").doc("main").get(), db.collection("config").doc("sync").get()]);
  const st = stDoc.data() || {};
  const on = !!GCAL_ID && mainDoc.get("gcal") === true;
  const map = {...(st.map || {})};
  const save = extra => ref.set({id:st.id || null, at:st.at || 0, testSeen:st.testSeen || 0, ...extra, map});
  // Cambió el calendario o se apagó: borrar las copias del calendario anterior.
  if (st.id && Object.keys(map).length && (!on || st.id !== GCAL_ID)) {
    try { await gcal.apply(creds, st.id, gcal.diff({}, map), map); } catch (e) { console.log(`::warning::Calendario de Google: no se pudieron borrar las copias viejas (${e.status || "error"})`); }
    await save({});
  }
  if (!on) return;
  const testMax = Math.max(0, ...users.map(u => u.settings?.testAt || 0));
  const asked = testMax > (st.testSeen || 0);
  const changed = (syncDoc.get("at") || 0) > (st.at || 0);
  if (st.id === GCAL_ID && !asked && !changed && !st.pending && now.getTime() - (st.at || 0) < 24 * 3600e3) return;
  const startedAt = now.getTime();
  const [people, events, dues] = await Promise.all(["people", "events", "dues"].map(readCol));
  let tz = users.find(u => u.settings?.tz)?.settings.tz || DEF_TZ;
  if (!gcal.validTz(tz)) tz = DEF_TZ;
  const ops = gcal.diff(gcal.items(L, {people, events, dues}, tz, localNow(now, tz).day), map);
  const keep = {id:GCAL_ID, at:st.at || 0, testSeen:Math.max(testMax, st.testSeen || 0)};
  let r = {complete:true};
  try { if (ops.length) r = await gcal.apply(creds, GCAL_ID, ops, map, {onProgress:() => ref.set({...keep, pending:true, map})}); }
  catch (e) { r = {complete:false}; console.log(`::warning::Calendario de Google: ${e.status ? "error " + e.status : e.message}`); }
  finally { await ref.set({...keep, at:r.complete ? startedAt : keep.at, pending:!r.complete, map}); }
}

// ---------- respaldo semanal cifrado (domingos a la noche, por Telegram) ----------
async function weeklyBackup(users, now) {
  if (!BACKUP_PASS || !TG) return;
  const tz = users.find(u => u.settings?.tz)?.settings.tz || DEF_TZ, loc = localNow(now, tz);
  const [y, m, d] = loc.day.split("-").map(Number);
  if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== 0 || loc.min < 21 * 60) return;
  const ref = db.collection("notifState").doc("_backup"); const st = (await ref.get()).data() || {};
  if (st.day === loc.day) return;
  const shared = {}; for (const c of Object.keys(backup.SHARED)) shared[c] = await readCol(c);
  for (const u of users) {
    if (!u.settings?.tgChat) continue;
    try {
      const priv = (await userCol(u.uid).get()).docs.map(x => ({...x.data(), id:x.id}));
      const file = JSON.stringify(backup.encrypt(backup.build(shared, priv, loc.day), BACKUP_PASS));
      const fd = new FormData();
      fd.append("chat_id", String(u.settings.tgChat));
      fd.append("caption", "🔒 Respaldo semanal de Entre Dos. Para usarlo: Ajustes → Bajar una copia → Importar una copia, y tu clave de respaldo.");
      fd.append("document", new Blob([file], {type:"application/json"}), `entre-dos-respaldo-${loc.day}.json`);
      const r = await fetch(`https://api.telegram.org/bot${TG}/sendDocument`, {method:"POST", body:fd});
      if (!r.ok) console.log(`::warning::Respaldo: Telegram respondió ${r.status}`);
    } catch { console.log("::warning::Respaldo: no se pudo mandar"); }
  }
  await ref.set({day:loc.day});
}

// ---------- principal ----------
async function main() {
  const now = new Date();
  const cols = await db.collection("data").doc("users").listCollections();
  const users = [];
  for (const c of cols) {
    const s = await c.doc("settings").get();
    users.push({uid:c.id, settings:s.exists ? s.data() : {}});
  }
  await telegram(users, now);
  await calendar(users, now).catch(e => console.log(`::warning::Calendario de Google: ${e.message}`));
  await weeklyBackup(users, now).catch(() => console.log("::warning::Respaldo: falló"));
  let total = 0, ipcSeries = null;
  for (const user of users) {
    const ref = db.collection("notifState").doc(user.uid);
    const st = (await ref.get()).data() || {};
    const r = await plan({L, user, now, st, load:kind => withData(user, kind, now)});
    // Inversiones: una revisión por día (entre las 10 y las 21) para mandar el resumen del mes cuando sale la inflación
    const loc = localNow(now, user.settings?.tz);
    if (r.st.invDay !== loc.day && loc.min >= 600 && loc.min <= 1260) {
      r.st = {...r.st, invDay:loc.day};
      try {
        const sum = await userCol(user.uid).doc("inv_summary").get();
        if (sum.exists) {
          if (!ipcSeries) ipcSeries = await fetch("https://api.argentinadatos.com/v1/finanzas/indices/inflacion").then(x => x.ok ? x.json() : []).catch(() => []);
          const rec = invRecapMsg(sum.data(), ipcSeries);
          if (rec && st.invSent !== rec.ym) { r.msgs.push(rec.msg); r.st.invSent = rec.ym; }
        }
      } catch (e) { console.log("::warning::Inversiones: no se pudo armar el resumen"); }
    }
    if (r.msgs.length) total += await deliver(user, r.msgs);
    if (JSON.stringify(r.st) !== JSON.stringify(st)) await ref.set(r.st);
  }
  console.log("Listo.");
}
main().catch(e => { console.log(`::error::${String(e && e.message || e).split("\n")[0].slice(0, 300)}`); process.exit(1); });
