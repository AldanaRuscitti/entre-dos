// Copia la agenda compartida y las fechas a un calendario de Google (que después se ve en el iPhone).
// Es en un solo sentido: lo que cambies en Google Calendar no vuelve a la app.
// Nunca copia lo "Solo yo": eso vive en el espacio privado de cada persona y acá no se lee.
"use strict";
const crypto = require("node:crypto");

const REP = {daily:"FREQ=DAILY", weekly:"FREQ=WEEKLY", biweekly:"FREQ=WEEKLY;INTERVAL=2", monthly:"FREQ=MONTHLY", yearly:"FREQ=YEARLY"};
const compact = s => s.replace(/-/g, "");
const nextDay = (L, s) => L.ymdShift(s, 1);
const addMin = (hm, m) => { const t = Math.min(23 * 60 + 59, Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3)) + m); return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
const hmOk = s => /^\d{2}:\d{2}$/.test(s || "");
const validTz = tz => { try { new Intl.DateTimeFormat("en", {timeZone:tz}); return true; } catch { return false; } };
// Fin del día local (23:59:59 en tz) expresado en UTC, como pide UNTIL en eventos con horario.
function untilUtc(ymdS, tz) {
  const [y, m, d] = ymdS.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 23, 59, 59);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {timeZone:tz, hourCycle:"h23", year:"numeric", month:"numeric", day:"numeric", hour:"numeric", minute:"numeric", second:"numeric"}).formatToParts(new Date(guess)).map(x => [x.type, x.value]));
  const asLocal = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return new Date(guess - (asLocal - guess)).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
// La app pasa el 31 al último día del mes (y el 29/2 al 28/2); en Google hay que pedirlo explícito.
function monthClamp(startYmd, freq) {
  const [, m, d] = startYmd.split("-").map(Number);
  if (freq === "MONTHLY" && d > 28) return `;BYMONTHDAY=${Array.from({length:d - 27}, (_, i) => 28 + i).join(",")};BYSETPOS=-1`;
  if (freq === "YEARLY" && m === 2 && d === 29) return ";BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1";
  return "";
}

function eventItem(L, e, tz) {
  if (!e.date) return null;
  const timed = !e.allDay && hmOk(e.start);
  const title = e.busy ? `${L.pName(e.owner)}: ocupado` : (e.title || "(sin título)");
  const who = [e.owner, ...(e.who || [])].filter((p, i, a) => p && L.S.people[p] && a.indexOf(p) === i).map(p => L.pName(p));
  const body = {summary:title, description:e.busy ? "Entre Dos" : [who.length ? "Con: " + who.join(", ") : "", e.note || "", "Entre Dos"].filter(Boolean).join("\n"), location:e.busy ? undefined : e.place || undefined};
  const last = e.endDate && e.endDate > e.date ? e.endDate : e.date;
  if (timed) {
    let endDay = last, end = hmOk(e.end) ? e.end : addMin(e.start, 60);
    if (last === e.date && end <= e.start) endDay = nextDay(L, e.date);   // termina pasada la medianoche
    body.start = {dateTime:`${e.date}T${e.start}:00`, timeZone:tz};
    body.end = {dateTime:`${endDay}T${end}:00`, timeZone:tz};
  } else {
    body.start = {date:e.date};
    body.end = {date:nextDay(L, last)};
  }
  if (e.repeat && REP[e.repeat]) {
    const freq = REP[e.repeat].match(/FREQ=(\w+)/)[1];
    const r = ["RRULE:" + REP[e.repeat] + monthClamp(e.date, freq) + (e.until ? `;UNTIL=${timed ? untilUtc(e.until, tz) : compact(e.until)}` : "")];
    const skip = (e.skip || []).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x));
    if (skip.length) r.push(timed ? `EXDATE;TZID=${tz}:${skip.map(x => compact(x) + "T" + e.start.replace(":", "") + "00").join(",")}` : `EXDATE;VALUE=DATE:${skip.map(compact).join(",")}`);
    body.recurrence = r;
  }
  return body;
}

function dueItem(L, d) {
  if (!d.due || d.doneAt) return null;
  const body = {summary:`${d.cat === "familia" ? "🎉" : d.cat === "mascota" ? "🐾" : "⏰"} ${d.title || "Fecha"}`, description:"Entre Dos · Fechas", start:{date:d.due}, end:{date:nextDay(L, d.due)}, transparency:"transparent"};
  if (d.unit === "month" || d.unit === "year") { const f = d.unit === "month" ? "MONTHLY" : "YEARLY"; body.recurrence = [`RRULE:FREQ=${f};INTERVAL=${Math.max(1, Number(d.n) || 1)}${monthClamp(d.due, f)}`]; }
  return body;
}

// Lo que tiene que haber en el calendario: {clave: evento de Google}
function tag(body, key) { body.extendedProperties = {private:{entreDos:key}}; return body; }
function items(L, shared, tz, today) {
  L.S.people = shared.people || {};
  if (!validTz(tz)) tz = "America/Argentina/Buenos_Aires";
  const from = today ? L.ymdShift(today, -30) : "0000";
  const out = {};
  for (const e of Object.values(shared.events || {})) {
    const lastDay = e.repeat && REP[e.repeat] ? (e.until || "9999") : (e.endDate && e.endDate > e.date ? e.endDate : e.date);
    if (!e.date || lastDay < from) continue; const b = eventItem(L, e, tz); if (b) out["e:" + e.id] = tag(b, "e:" + e.id); }
  for (const d of Object.values(shared.dues || {})) { const b = dueItem(L, d); if (b) out["d:" + d.id] = tag(b, "d:" + d.id); }
  return out;
}
const hash = o => crypto.createHash("sha1").update(JSON.stringify(o)).digest("hex").slice(0, 16);

// Qué crear, cambiar y borrar comparando con lo que ya se copió (map: {clave: {id, h}}).
function diff(want, map) {
  const ops = [];
  for (const [k, body] of Object.entries(want)) {
    const h = hash(body), cur = map[k];
    if (!cur) ops.push({op:"insert", k, body, h});
    else if (cur.h !== h) ops.push({op:"update", k, body, h, id:cur.id});
  }
  for (const [k, cur] of Object.entries(map)) if (!want[k]) ops.push({op:"delete", k, id:cur.id});
  return ops;
}

// ---------- acceso a la API de Google (sin librerías extra) ----------
async function token(creds) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({alg:"RS256", typ:"JWT"})}.${b64({iss:creds.client_email, scope:"https://www.googleapis.com/auth/calendar.events", aud:"https://oauth2.googleapis.com/token", iat:now, exp:now + 3600})}`;
  const sig = crypto.sign("RSA-SHA256", Buffer.from(unsigned), creds.private_key).toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", {method:"POST", headers:{"content-type":"application/x-www-form-urlencoded"}, body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer", assertion:`${unsigned}.${sig}`})});
  const j = await r.json();
  if (!j.access_token) { const e = new Error(`Google no dio acceso (${j.error || r.status}). ¿Está habilitada la API de Google Calendar?`); e.status = r.status; throw e; }
  return j.access_token;
}

// Aplica los cambios. Corta si Google pide esperar o si llega al tope por corrida (lo que falta sigue en la próxima).
// Devuelve {done, complete}. onProgress se llama cada tanto para guardar el avance.
async function apply(creds, calId, ops, map, {max = 150, onProgress} = {}) {
  const tk = await token(creds);
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`;
  const call = async (method, url, body) => {
    const r = await fetch(url, {method, headers:{authorization:"Bearer " + tk, "content-type":"application/json"}, body:body ? JSON.stringify(body) : undefined});
    if (r.status === 204) return {};
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(`Google Calendar ${r.status}`); e.status = r.status; e.reason = j.error?.errors?.[0]?.reason || ""; throw e; }
    return j;
  };
  const slowDown = e => e.status === 429 || (e.status === 403 && /rateLimit/i.test(e.reason)) || e.status >= 500;
  let done = 0, failed = 0, lastErr = null;
  for (const o of ops) {
    if (done + failed >= max) return {done, complete:false};
    try {
      if (o.op === "delete") { await call("DELETE", `${base}/${o.id}`).catch(e => { if (e.status !== 404 && e.status !== 410) throw e; }); delete map[o.k]; }
      else if (o.op === "update") {
        try { await call("PUT", `${base}/${o.id}`, o.body); map[o.k] = {id:o.id, h:o.h}; }
        catch (e) { if (e.status !== 404 && e.status !== 410) throw e; const j = await call("POST", base, o.body); map[o.k] = {id:j.id, h:o.h}; }
      } else { const j = await call("POST", base, o.body); map[o.k] = {id:j.id, h:o.h}; }
      done++;
      if (onProgress && done % 25 === 0) await onProgress();
    } catch (e) {
      if (slowDown(e)) return {done, complete:false};
      if (e.status === 401 || e.status === 403) throw e;   // sin permiso: no tiene sentido seguir
      if (e.status === 404 && o.op === "insert") throw new Error("No encuentro el calendario: revisá el secreto GCAL_ID y que esté compartido con la cuenta de servicio.");
      failed++; lastErr = e;
    }
  }
  if (failed) console.log(`::warning::Calendario de Google: algunos eventos no se pudieron copiar (${lastErr && (lastErr.status || "error")})`);
  return {done, complete:true};
}

module.exports = {eventItem, dueItem, items, diff, hash, apply, untilUtc, validTz};
