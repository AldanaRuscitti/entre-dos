// Proceso de avisos de Entre Dos. Lo corre GitHub Actions cada 15 minutos (ver .github/workflows/avisos.yml).
// Necesita: FIREBASE_SERVICE_ACCOUNT (JSON de la cuenta de servicio) y TELEGRAM_BOT_TOKEN (opcional). APP_URL es opcional.
"use strict";
const {initializeApp, cert} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");
const {getMessaging} = require("firebase-admin/messaging");
const {load} = require("./extract");
const {plan, digest, localNow} = require("./logic");

const SA = process.env.FIREBASE_SERVICE_ACCOUNT;
const TG = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const APP_URL = (process.env.APP_URL || "").trim();
if (!SA) { console.error("Falta el secreto FIREBASE_SERVICE_ACCOUNT"); process.exit(1); }
let creds;
try { creds = JSON.parse(SA); } catch { console.error("El secreto FIREBASE_SERVICE_ACCOUNT no es un JSON válido: pegá el contenido completo del archivo .json"); process.exit(1); }
initializeApp({credential:cert(creds)});
const db = getFirestore();
const L = load();

const alive = snap => Object.fromEntries(snap.docs.map(d => [d.id, {...d.data(), id:d.id}]).filter(([, v]) => !v.deletedAt));
const userCol = uid => db.collection("data").doc("users").collection(uid);

// ---------- lecturas (pocas: el plan gratis de Firestore da 50.000 por día) ----------
const cache = {};
async function sharedData(kind, day) {
  if (cache[kind]) return cache[kind];
  const out = {};
  const cols = kind === "events" ? ["people", "events"] : ["people", "events", "chores", "dues", "polls", "thanks", "fixed", "groups"];
  await Promise.all(cols.map(async c => { out[c] = alive(await db.collection(c).get()); }));
  if (kind === "full") {
    // Para saber el estado de las tareas alcanza con lo hecho en los últimos ~13 meses.
    out.choreLog = alive(await db.collection("choreLog").where("date", ">=", L.ymdShift(day, -400)).get());
    // Para los gastos fijos de hoy solo hace falta saber si ya se cargaron este mes.
    out.expenses = {};
    for (const t of Object.values(out.fixed)) if (L.monthDay(day.slice(0, 7), t.day) === day) Object.assign(out.expenses, alive(await db.collection("expenses").where("fixedId", "==", t.id).get()));
  }
  return (cache[kind] = out);
}
const KIND = {event:"events", tpl:"tpl", due:"dues", gift:"gifts"};
async function privData(user, kind, day) {
  const key = user.uid + kind;
  if (cache[key]) return cache[key];
  const snap = await userCol(user.uid).where("kind", "in", kind === "events" ? ["event"] : ["event", "tpl", "due", "gift"]).get();
  const priv = {events:{}, tx:{}, tpl:{}, dues:{}, gifts:{}};
  for (const d of snap.docs) { const v = {...d.data(), id:d.id}; if (!v.deletedAt && KIND[v.kind]) priv[KIND[v.kind]][d.id] = v; }
  if (kind === "full") for (const t of Object.values(priv.tpl)) if (L.monthDay(day.slice(0, 7), t.day) === day)
    for (const d of (await userCol(user.uid).where("tplId", "==", t.id).get()).docs) priv.tx[d.id] = {...d.data(), id:d.id};
  return (cache[key] = priv);
}
async function withData(user, kind, now) {
  const day = localNow(now, user.settings?.tz).day;
  const [shared, priv] = await Promise.all([sharedData(kind, day), privData(user, kind, day)]);
  user.priv = priv;
  return shared;
}

// ---------- envíos ----------
async function tgCall(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${TG}/${method}`, {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(body)});
  const j = await r.json().catch(() => ({}));
  if (!j.ok) { const e = new Error(`Telegram ${method}: ${j.description || r.status}`); e.code = j.error_code || r.status; throw e; }
  return j.result;
}
const button = /^https:\/\//.test(APP_URL) ? {reply_markup:{inline_keyboard:[[{text:"Abrir Entre Dos", url:APP_URL}]]}} : {};
const tgSend = (chat, m) => tgCall("sendMessage", {chat_id:chat, text:`${m.title}\n\n${m.body}`.trim(), disable_web_page_preview:true, ...button});

async function deliver(user, msgs) {
  let sent = 0;
  if (TG && user.settings?.tgChat) {
    for (const m of msgs) {
      try { await tgSend(user.settings.tgChat, m); sent++; }
      catch (e) { console.warn("Telegram:", e.message); if (e.code === 403) await userCol(user.uid).doc("settings").update({tgChat:null}).catch(() => {}); }
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

// ---------- Telegram: vincular cuentas y responder /hoy ----------
const HELP = "Soy el bot de avisos de Entre Dos.\n\n/hoy — lo que tenés hoy\n/manana — lo que viene mañana\n\nPara conectarme, entrá a la app → Ajustes → Avisos → Telegram → Conectar.";
async function telegram(users, now) {
  if (!TG) return;
  const stRef = db.collection("notifState").doc("_telegram");
  const offset = (await stRef.get()).get("offset") || 0;
  let updates;
  try { updates = await tgCall("getUpdates", {offset, timeout:0, allowed_updates:["message"]}); }
  catch (e) { console.warn(e.message); return; }
  if (!updates.length) return;
  for (const u of updates) {
    const msg = u.message; if (!msg || !msg.text || !msg.chat) continue;
    const chat = String(msg.chat.id), text = msg.text.trim();
    const [cmd, arg] = text.split(/\s+/);
    try {
      if (cmd === "/start" && arg) {
        const user = users.find(x => x.settings?.tgCode && x.settings.tgCode === arg);
        if (!user) { await tgCall("sendMessage", {chat_id:chat, text:"Ese código ya no sirve. Generá uno nuevo en la app: Ajustes → Avisos → Telegram → Conectar."}); continue; }
        await userCol(user.uid).doc("settings").update({tgChat:chat, tgCode:null});
        user.settings = {...user.settings, tgChat:chat, tgCode:null};
        await tgCall("sendMessage", {chat_id:chat, text:"¡Listo! Desde ahora te llegan los avisos de Entre Dos acá. 🙌\n\nPodés escribirme /hoy cuando quieras."});
      } else if (cmd === "/hoy" || cmd === "/manana" || cmd === "/mañana") {
        const user = users.find(x => x.settings?.tgChat === chat);
        if (!user) { await tgCall("sendMessage", {chat_id:chat, text:HELP}); continue; }
        const shared = await withData(user, "full", now);
        const m = digest(L, shared, user, localNow(now, user.settings?.tz).day, cmd === "/hoy" ? "morning" : "evening", now.getTime());
        await tgSend(chat, m || {title:cmd === "/hoy" ? "Hoy no tenés nada pendiente 🙌" : "Mañana viene tranqui 🙌", body:""});
      } else await tgCall("sendMessage", {chat_id:chat, text:HELP});
    } catch (e) { console.warn("Telegram:", e.message); }
  }
  await stRef.set({offset:updates[updates.length - 1].update_id + 1}, {merge:true});
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
  let total = 0;
  for (const user of users) {
    const ref = db.collection("notifState").doc(user.uid);
    const st = (await ref.get()).data() || {};
    const r = await plan({L, user, now, st, load:kind => withData(user, kind, now)});
    if (r.msgs.length) total += await deliver(user, r.msgs);
    if (JSON.stringify(r.st) !== JSON.stringify(st)) await ref.set(r.st);
  }
  console.log(`Listo: ${users.length} personas, ${total} avisos enviados.`);
}
main().catch(e => { console.error(e); process.exit(1); });
