// Respaldo semanal cifrado. Cada persona recibe por Telegram: todo lo compartido + SOLO lo suyo privado.
// El archivo usa el mismo formato que "Bajar una copia" de la app, cifrado con BACKUP_PASS (AES-256-GCM, PBKDF2-SHA256).
"use strict";
const crypto = require("node:crypto");

const SHARED = {people:"personas", groups:"grupos", events:"eventos", expenses:"gastos", fixed:"gastosFijos", lists:"listas", items:"itemsDeListas", chores:"tareas", choreLog:"tareasHechas", dues:"fechas", polls:"votaciones", thanks:"gracias", pets:"mascotas", meals:"menu", ideas:"planes", checkins:"chequeos", prices:"precios", goals:"metas", contribs:"aportes", config:"config"};
const PRIV = {event:"eventos", tx:"movimientos", tpl:"fijos", goal:"metas", gcontrib:"aportes", due:"fechas", gift:"regalos"};

// shared: {colName: {id: doc}}, priv: [{id, ...doc}] de una persona
function build(shared, priv, today) {
  const compartido = {};
  for (const [col, key] of Object.entries(SHARED)) compartido[key] = shared[col] || {};
  // no viaja el vínculo con la cuenta de Google
  compartido.personas = Object.fromEntries(Object.entries(compartido.personas).map(([k, v]) => { const {uid, ...rest} = v; return [k, {...rest, conCuenta:!!uid}]; }));
  const soloMio = {};
  for (const d of priv) {
    if (d.kind === "settings") { const {tgChat, tgCode, ...pref} = d; soloMio.preferencias = pref; continue; }
    const key = PRIV[d.kind]; if (!key) continue;   // no se respaldan permisos de avisos ni datos de inversiones
    (soloMio[key] ||= {})[d.id] = d;
  }
  return {app:"Entre Dos", version:1, exportadoEl:today, compartido, soloMio};
}
function encrypt(obj, pass) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), iter = 200000;
  const key = crypto.pbkdf2Sync(pass, salt, iter, 32, "sha256");
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final(), c.getAuthTag()]);
  return {app:"Entre Dos", enc:"aes-gcm", iter, salt:salt.toString("base64"), iv:iv.toString("base64"), data:data.toString("base64")};
}
function decrypt(j, pass) {
  const key = crypto.pbkdf2Sync(pass, Buffer.from(j.salt, "base64"), j.iter, 32, "sha256");
  const buf = Buffer.from(j.data, "base64"), tag = buf.subarray(buf.length - 16), body = buf.subarray(0, buf.length - 16);
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(j.iv, "base64")); d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(body), d.final()]).toString("utf8"));
}
module.exports = {build, encrypt, decrypt, SHARED, PRIV};
