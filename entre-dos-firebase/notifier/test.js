// Pruebas de los avisos con datos inventados. Correr con: npm test
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const {load} = require("./extract");
const {digest, plan, localNow, timedToday} = require("./logic");

const L = load();
const DAY = "2026-10-13";                      // martes
const wd = L.wdayOf(DAY);
const shared = () => ({
  people:{pA:{id:"pA", name:"Aldi", uid:"uA"}, pB:{id:"pB", name:"Lucas", uid:"uB"}},
  groups:{g1:{id:"g1", name:"Casa", members:["pA", "pB"]}},
  chores:{
    basura:{id:"basura", name:"Sacar la basura", unit:"weekdays", wdays:[wd], assign:"fixed", who:["pA"], start:"2026-10-01"},
    plantas:{id:"plantas", name:"Regar plantas", unit:"day", every:3, assign:"fixed", who:["pB"], start:"2026-10-13"},
    banio:{id:"banio", name:"Limpiar el baño", unit:"week", every:1, start:"2026-10-14"}
  },
  choreLog:{},
  events:{
    e1:{id:"e1", title:"Cena con amigos", date:DAY, start:"21:00", owner:"pA", who:["pB"], vis:"shared"},
    e2:{id:"e2", title:"Dentista", date:DAY, start:"10:00", owner:"pB", vis:"shared"},
    e3:{id:"e3", busy:true, date:DAY, start:"15:00", owner:"pB"},
    e4:{id:"e4", title:"Yoga", date:"2026-10-06", repeat:"weekly", start:"19:00", owner:"pA", vis:"shared"},
    e5:{id:"e5", title:"Borrado", date:DAY, owner:"pA", deletedAt:1}
  },
  dues:{
    d1:{id:"d1", title:"VTV", cat:"auto", due:"2026-10-14", unit:"year", n:1, lead:30, owner:"pA"},
    d2:{id:"d2", title:"Cumpleaños de mamá", cat:"familia", due:"2026-10-20", unit:"year", n:1, lead:7},
    d3:{id:"d3", title:"Patente", cat:"auto", due:"2026-10-13", unit:"month", n:2, owner:"pB"}
  },
  polls:{p1:{id:"p1", title:"¿Qué pedimos?", options:[{id:"o0", t:"Pizza"}], who:["pA", "pB"], votes:{pB:{o0:true}}}},
  thanks:{t1:{id:"t1", from:"pB", to:"pA", text:"por el café", createdAt:Date.parse(DAY + "T09:00:00Z")}},
  fixed:{f1:{id:"f1", group:"g1", desc:"Alquiler", amount:350000, cur:"ARS", day:13}},
  expenses:{}
});
// los borrados no llegan a la lógica (send.js los filtra al leer)
const clean = s => { delete s.events.e5; return s; };
const userA = () => ({uid:"uA", settings:{tz:"America/Argentina/Buenos_Aires"}, priv:{events:{
  x1:{id:"x1", title:"Psicóloga", date:DAY, start:"18:00", owner:"pA", vis:"private"}}, dues:{}, tpl:{t1:{id:"t1", type:"ingreso", desc:"Sueldo", amount:1000, cur:"ARS", day:13}}, tx:{}, gifts:{}}});
const userB = () => ({uid:"uB", settings:{notif:{partner:false}}, priv:{}});

test("resumen de la mañana de Aldi", () => {
  const m = digest(L, clean(shared()), userA(), DAY, "morning", Date.parse(DAY + "T12:00:00Z"));
  assert.ok(m.title.includes("Aldi"));
  const b = m.body;
  assert.match(b, /Sacar la basura/);
  assert.doesNotMatch(b, /Regar plantas/, "es de Lucas");
  assert.doesNotMatch(b, /Limpiar el baño/, "es mañana");
  assert.match(b, /21:00 Cena con amigos/);
  assert.match(b, /10:00 Lucas: Dentista/, "evento de la pareja (partner activado)");
  assert.doesNotMatch(b, /ocupado|15:00/, "los 'ocupado' no se avisan");
  assert.match(b, /18:00 Psicóloga/, "su evento privado");
  assert.match(b, /19:00 Yoga/, "evento semanal");
  assert.doesNotMatch(b, /Borrado/);
  assert.match(b, /Vence mañana: VTV/);
  assert.doesNotMatch(b, /Patente/, "la patente es de Lucas");
  assert.match(b, /En 7 días: Cumpleaños de mamá — ¿ya pensaron el regalo\?/);
  assert.match(b, /Alquiler/);
  assert.match(b, /Cobro: Sueldo/);
  assert.match(b, /Te falta votar:\n• ¿Qué pedimos\?/);
  assert.match(b, /Lucas te dejó un gracias: “por el café”/);
});

test("resumen de Lucas: no ve lo privado de Aldi ni lo de ella si apagó 'pareja'", () => {
  const m = digest(L, clean(shared()), userB(), DAY, "morning", Date.parse(DAY + "T12:00:00Z"));
  const b = m.body;
  assert.match(b, /Regar plantas/);
  assert.doesNotMatch(b, /Sacar la basura|Psicóloga|Yoga/);
  assert.match(b, /21:00 Aldi: Cena|21:00 Cena con amigos/, "la cena lo incluye");
  assert.match(b, /Vence hoy: Patente/);
  assert.doesNotMatch(b, /VTV/);
  assert.doesNotMatch(b, /Te falta votar/, "ya votó");
  assert.doesNotMatch(b, /Sueldo/);
});

test("tarea hecha hoy ya no se avisa; la que quedó atrasada dice de cuándo", () => {
  const s = clean(shared());
  s.choreLog = {l1:{id:"l1", chore:"basura", by:"pA", date:DAY, occ:DAY, createdAt:1}};
  assert.doesNotMatch(digest(L, s, userA(), DAY, "morning").body, /Sacar la basura/);
  const late = L.ymdShift(DAY, 1);
  const s2 = clean(shared()); s2.chores.basura.wdays = [wd];
  const m = digest(L, s2, userA(), L.ymdShift(DAY, 2), "morning");
  assert.match(m.body, /Sacar la basura — quedó del martes/);
  assert.ok(late);
});

test("resumen de la noche: lo de mañana", () => {
  const s = clean(shared());
  s.events.e6 = {id:"e6", title:"Turno médico", date:"2026-10-14", start:"09:30", owner:"pA"};
  const m = digest(L, s, userA(), DAY, "evening");
  assert.match(m.body, /Quedó pendiente hoy:\n• Sacar la basura/);
  assert.match(m.body, /Mañana te toca:\n• Limpiar el baño \(cualquiera de los dos\)/);
  assert.match(m.body, /09:30 Turno médico/);
  assert.match(m.body, /Vence mañana: VTV/);
});

test("persona sin perfil vinculado no recibe nada", () => {
  assert.equal(digest(L, clean(shared()), {uid:"uX", settings:{}}, DAY, "morning"), null);
});

test("hora local por zona horaria", () => {
  const n = new Date("2026-10-13T11:40:00Z");
  assert.deepStrictEqual(localNow(n, "America/Argentina/Buenos_Aires"), {day:"2026-10-13", hm:"08:40", min:520});
  assert.equal(localNow(n, "Asia/Tokyo").day, "2026-10-13");
  assert.equal(localNow(new Date("2026-10-13T02:00:00Z"), "America/Argentina/Buenos_Aires").day, "2026-10-12");
  assert.equal(localNow(n, "Zona/Inventada").hm, "08:40", "zona inválida → Buenos Aires");
});

test("plan: resumen una sola vez por día, avisos antes de eventos y prueba", async () => {
  const s = clean(shared()); let loads = 0;
  const load = async () => { loads++; return s; };
  const u = userA(); u.settings.notif = {time:"08:30", before:true};
  // 8:40 en Buenos Aires
  let r = await plan({L, user:u, now:new Date("2026-10-13T11:40:00Z"), st:{}, load});
  assert.equal(r.msgs.length, 1); assert.equal(r.msgs[0].tag, "morning"); assert.equal(r.st.morning, DAY);
  r = await plan({L, user:u, now:new Date("2026-10-13T11:55:00Z"), st:r.st, load});
  assert.equal(r.msgs.length, 0, "no repite");
  // 17:00 → la psicóloga es a las 18:00
  r = await plan({L, user:u, now:new Date("2026-10-13T20:00:00Z"), st:r.st, load});
  assert.deepStrictEqual(r.msgs.map(m => m.title), ["En 1 hora: Psicóloga"]);
  r = await plan({L, user:u, now:new Date("2026-10-13T20:15:00Z"), st:r.st, load});
  assert.equal(r.msgs.length, 0, "no repite el aviso");
  // 18:10 → Yoga 19:00 (50 min)
  r = await plan({L, user:u, now:new Date("2026-10-13T21:10:00Z"), st:r.st, load});
  assert.deepStrictEqual(r.msgs.map(m => m.title), ["En 50 min: Yoga"]);
  // la lista de eventos de hoy no se relee en cada corrida
  const before = loads;
  await plan({L, user:u, now:new Date("2026-10-13T21:20:00Z"), st:r.st, load});
  assert.equal(loads, before);
  // prueba
  u.settings.testAt = 5;
  r = await plan({L, user:u, now:new Date("2026-10-13T21:30:00Z"), st:r.st, load});
  assert.ok(r.msgs.some(m => m.tag === "test")); assert.equal(r.st.testDone, 5);
  r = await plan({L, user:u, now:new Date("2026-10-13T21:45:00Z"), st:r.st, load});
  assert.ok(!r.msgs.some(m => m.tag === "test"));
});

test("plan: si la corrida se atrasa más de 3 horas, ese resumen se saltea; respeta apagados", async () => {
  const s = clean(shared()); const load = async () => s;
  const u = userA(); u.settings.notif = {time:"08:30", before:false};
  let r = await plan({L, user:u, now:new Date("2026-10-13T15:00:00Z"), st:{}, load});
  assert.equal(r.msgs.length, 0);
  u.settings.notif = {morning:false, before:false};
  r = await plan({L, user:u, now:new Date("2026-10-13T11:40:00Z"), st:{}, load});
  assert.equal(r.msgs.length, 0);
});

test("eventos con horario de hoy para avisar antes", () => {
  const list = timedToday(L, clean(shared()), userA(), DAY);
  assert.deepStrictEqual(list.map(x => x.start + " " + x.title), ["18:00 Psicóloga", "19:00 Yoga", "21:00 Cena con amigos"]);
});

// ---------- Google Calendar ----------
const gcal = require("./gcal");
test("calendario: eventos compartidos, ocupados y fechas; nunca lo privado", () => {
  const s = clean(shared());
  s.events.e7 = {id:"e7", title:"Feria", date:"2026-10-20", endDate:"2026-10-22", allDay:true, owner:"pA"};
  s.events.e8 = {id:"e8", title:"Gimnasio", date:"2026-10-05", start:"07:00", end:"08:30", repeat:"weekly", until:"2026-12-31", skip:["2026-10-12"], owner:"pB"};
  const it = gcal.items(L, s, "America/Argentina/Buenos_Aires");
  assert.ok(!Object.values(it).some(b => /Psicóloga/.test(b.summary)), "lo 'Solo yo' no está en shared");
  assert.equal(it["e:e3"].summary, "Lucas: ocupado");
  assert.equal(it["e:e3"].description, "Entre Dos");
  assert.deepStrictEqual(it["e:e1"].start, {dateTime:"2026-10-13T21:00:00", timeZone:"America/Argentina/Buenos_Aires"});
  assert.equal(it["e:e1"].end.dateTime, "2026-10-13T22:00:00", "sin hora de fin → 1 hora");
  assert.match(it["e:e1"].description, /Con: Aldi, Lucas/);
  assert.deepStrictEqual([it["e:e7"].start, it["e:e7"].end], [{date:"2026-10-20"}, {date:"2026-10-23"}], "todo el día: fin exclusivo");
  assert.deepStrictEqual(it["e:e8"].recurrence, ["RRULE:FREQ=WEEKLY;UNTIL=20270101T025959Z", "EXDATE;TZID=America/Argentina/Buenos_Aires:20261012T070000"]);
  assert.equal(it["e:e8"].end.dateTime, "2026-10-05T08:30:00");
  assert.deepStrictEqual(it["e:e4"].recurrence, ["RRULE:FREQ=WEEKLY"]);
  assert.equal(it["d:d2"].summary, "🎉 Cumpleaños de mamá");
  assert.deepStrictEqual(it["d:d2"].recurrence, ["RRULE:FREQ=YEARLY;INTERVAL=1"]);
  assert.deepStrictEqual(it["d:d3"].recurrence, ["RRULE:FREQ=MONTHLY;INTERVAL=2"]);
  assert.equal(it["d:d1"].summary, "⏰ VTV");
});
test("calendario: solo cambia lo que cambió", () => {
  const want = {a:{summary:"A"}, b:{summary:"B"}};
  let ops = gcal.diff(want, {});
  assert.deepStrictEqual(ops.map(o => o.op + o.k), ["inserta", "insertb"]);
  const map = {a:{id:"1", h:gcal.hash(want.a)}, b:{id:"2", h:"viejo"}, c:{id:"3", h:"x"}};
  ops = gcal.diff(want, map);
  assert.deepStrictEqual(ops.map(o => o.op + o.k), ["updateb", "deletec"]);
});
test("calendario: firma el acceso y aplica altas, cambios y bajas", async () => {
  const crypto = require("node:crypto");
  const {privateKey, publicKey} = crypto.generateKeyPairSync("rsa", {modulusLength:2048, privateKeyEncoding:{type:"pkcs8", format:"pem"}, publicKeyEncoding:{type:"spki", format:"pem"}});
  const calls = []; const real = global.fetch;
  global.fetch = async (url, opt) => {
    calls.push(opt.method + " " + url.replace(/^https:\/\/[^/]+/, ""));
    if (url.includes("oauth2")) {
      const [h, p, sig] = new URLSearchParams(opt.body).get("assertion").split(".");
      assert.ok(crypto.verify("RSA-SHA256", Buffer.from(h + "." + p), publicKey, Buffer.from(sig, "base64url")), "firma válida");
      assert.equal(JSON.parse(Buffer.from(p, "base64url")).iss, "sa@x.iam.gserviceaccount.com");
      return {ok:true, status:200, json:async () => ({access_token:"T"})};
    }
    if (opt.method === "PUT") return {ok:false, status:404, json:async () => ({error:{message:"gone"}})};
    if (opt.method === "DELETE") return {ok:true, status:204};
    return {ok:true, status:200, json:async () => ({id:"g" + calls.length})};
  };
  try {
    const map = {b:{id:"old", h:"x"}, c:{id:"3", h:"y"}};
    const ops = gcal.diff({a:{summary:"A"}, b:{summary:"B"}}, map);
    const r = await gcal.apply({client_email:"sa@x.iam.gserviceaccount.com", private_key:privateKey}, "cal@group.calendar.google.com", ops, map);
    assert.deepStrictEqual(r, {done:3, complete:true});
    assert.deepStrictEqual(Object.keys(map).sort(), ["a", "b"]);
    assert.notEqual(map.b.id, "old", "si el evento ya no existe en Google, lo vuelve a crear");
    assert.ok(calls.some(c => c.startsWith("DELETE /calendar/v3/calendars/cal%40group.calendar.google.com/events/3")));
  } finally { global.fetch = real; }
});

test("calendario: fin de mes, pasada la medianoche y eventos viejos", () => {
  const s2 = clean(shared());
  s2.events = {
    m31:{id:"m31", title:"Alquiler", date:"2026-01-31", allDay:true, repeat:"monthly", owner:"pA"},
    noche:{id:"noche", title:"Fiesta", date:"2026-10-20", start:"23:30", end:"01:00", owner:"pA"},
    viejo:{id:"viejo", title:"Viejo", date:"2025-01-01", owner:"pA"},
    rep:{id:"rep", title:"Clase", date:"2024-01-01", start:"10:00", repeat:"weekly", owner:"pA"}
  };
  s2.dues = {b:{id:"b", title:"Cumple", cat:"familia", due:"2028-02-29", unit:"year", n:1}};
  const it = gcal.items(L, s2, "America/Argentina/Buenos_Aires", DAY);
  assert.deepStrictEqual(it["e:m31"].recurrence, ["RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1"]);
  assert.equal(it["e:noche"].end.dateTime, "2026-10-21T01:00:00");
  assert.ok(!it["e:viejo"], "no copia eventos de hace más de un mes");
  assert.ok(it["e:rep"], "los que se siguen repitiendo sí");
  assert.equal(it["e:rep"].extendedProperties.private.entreDos, "e:rep");
  assert.deepStrictEqual(it["d:b"].recurrence, ["RRULE:FREQ=YEARLY;INTERVAL=1;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1"]);
  assert.equal(gcal.items(L, s2, "Zona/Mala", DAY)["e:noche"].start.timeZone, "America/Argentina/Buenos_Aires");
});
test("calendario: si Google pide esperar, corta y deja el resto para la próxima", async () => {
  const crypto = require("node:crypto");
  const {privateKey} = crypto.generateKeyPairSync("rsa", {modulusLength:2048, privateKeyEncoding:{type:"pkcs8", format:"pem"}, publicKeyEncoding:{type:"spki", format:"pem"}});
  const real = global.fetch; let n = 0;
  global.fetch = async (url) => {
    if (url.includes("oauth2")) return {ok:true, status:200, json:async () => ({access_token:"T"})};
    n++;
    if (n === 2) return {ok:false, status:403, json:async () => ({error:{errors:[{reason:"rateLimitExceeded"}]}})};
    return {ok:true, status:200, json:async () => ({id:"g" + n})};
  };
  try {
    const map = {};
    const r = await gcal.apply({client_email:"a@b", private_key:privateKey}, "c", gcal.diff({a:{}, b:{}, c:{}}, {}), map);
    assert.deepStrictEqual(r, {done:1, complete:false});
    assert.deepStrictEqual(Object.keys(map), ["a"]);
  } finally { global.fetch = real; }
});
