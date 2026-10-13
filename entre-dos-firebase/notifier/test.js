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

// ---------- gastos fijos: a quién y cuándo ----------
const logic = require("./logic");
test("fijos: si tiene quién paga, solo le avisa a esa persona; si no, a todos", () => {
  const s = clean(shared()); s.fixed.f1.paidBy = "pB";
  assert.doesNotMatch(digest(L, s, userA(), DAY, "morning").body, /Alquiler/, "lo paga Lucas");
  assert.match(digest(L, s, userB(), DAY, "morning").body, /Alquiler/);
  s.fixed.f1.paidBy = "pZ";   // ya no está en el grupo → a todos
  assert.match(digest(L, s, userA(), DAY, "morning").body, /Alquiler/);
  delete s.fixed.f1.paidBy;
  assert.match(digest(L, s, userB(), DAY, "morning").body, /Alquiler/);
});
test("fijos atrasados: el día, el siguiente y cada 7 días, hasta que se cargan", () => {
  const s = clean(shared()); s.fixed.f1.day = 5;
  const u = () => { const x = userA(); x.priv.tpl = {}; return x; };
  const on = d => (digest(L, s, u(), d, "morning")?.body || "").replace(/\u00a0/g, " ").match(/.*Alquiler.*/)?.[0] || null;
  assert.match(on("2026-10-05"), /^• Alquiler/);
  assert.equal(on("2026-10-06"), "• Pendiente: Alquiler ($ 350.000,00) (vencía el 5)");
  for (const d of ["2026-10-07", "2026-10-11", "2026-10-13"]) assert.equal(on(d), null, d);
  assert.match(on("2026-10-12"), /Pendiente: Alquiler/);
  assert.match(on("2026-10-19"), /Pendiente: Alquiler/);
  s.expenses = {x:{id:"x", kind:"expense", fixedId:"f1", date:"2026-10-07", amount:1, cur:"ARS", group:"g1"}};
  assert.equal(on("2026-10-12"), null, "ya se cargó");
  assert.equal(on("2026-11-05") && "ok", "ok", "mes nuevo, avisa de nuevo");
  // fijos personales igual
  const v = userA(); v.priv.tpl.t1.day = 6;
  assert.match(digest(L, clean(shared()), v, DAY, "morning").body.replace(/\u00a0/g, " "), /Pendiente: Cobro: Sueldo \(\$ 1\.000,00\) \(vencía el 6\)/);
  v.priv.tx = {r:{id:"r", tplId:"t1", date:"2026-10-06", cur:"ARS", amount:1000, type:"ingreso"}};
  assert.doesNotMatch(digest(L, clean(shared()), v, DAY, "morning").body, /Sueldo/);
  assert.equal(logic.fixedWhen(L, {day:31}, "2026-02-28"), "today", "el 31 cae el último día del mes");
});

// ---------- botones de tareas ----------
test("resumen con botones de tareas de hoy (tuyas o de cualquiera), máx. 6", () => {
  const s = clean(shared());
  const m = digest(L, s, userA(), DAY, "morning");
  assert.deepStrictEqual(m.buttons, [{text:"✅ Sacar la basura", data:"d:basura"}]);
  for (let i = 0; i < 8; i++) s.chores["c" + i] = {id:"c" + i, name:"Tarea " + i, unit:"day", every:1, start:"2026-10-10"};
  assert.equal(digest(L, s, userA(), DAY, "morning").buttons.length, 6);
  assert.ok(digest(L, clean(shared()), userB(), DAY, "morning").buttons.every(b => b.data !== "d:basura"), "la basura es de Aldi");
  const mk = logic.tgMarkup(m.buttons, "https://x.app/");
  assert.deepStrictEqual(mk.reply_markup.inline_keyboard, [[{text:"✅ Sacar la basura", callback_data:"d:basura"}], [{text:"Abrir Entre Dos", url:"https://x.app/"}]]);
  assert.deepStrictEqual(logic.tgMarkup(undefined, ""), {});
  assert.deepStrictEqual(logic.markDone(mk.reply_markup, "d:basura").inline_keyboard[0][0], {text:"✔️ Sacar la basura", callback_data:"x"});
});
test("tocar 'hecha': escribe igual que la app y no duplica", () => {
  const s = clean(shared());
  const r = logic.choreTap(L, s, userA(), "basura", DAY, 1000, "LID");
  assert.deepStrictEqual(r.log, {id:"LID", chore:"basura", by:"pA", date:DAY, points:1, createdAt:1000, occ:DAY});
  assert.equal(r.path, "choreLog/LID");
  s.choreLog.LID = r.log;
  assert.ok(logic.choreTap(L, s, userA(), "basura", DAY, 2000).already, "segundo toque: ya estaba");
  // tarea por intervalo (sin occ)
  const s2 = clean(shared()); s2.chores.plantas.who = ["pA"];
  const r2 = logic.choreTap(L, s2, userA(), "plantas", DAY, 1000, "L2");
  assert.deepStrictEqual(r2.log, {id:"L2", chore:"plantas", by:"pA", date:DAY, points:1, createdAt:1000});
  s2.choreLog.L2 = r2.log;
  assert.ok(logic.choreTap(L, s2, userA(), "plantas", DAY).already);
  // atrasada del martes, se marca el jueves: cubre la del martes
  const s3 = clean(shared());
  assert.equal(logic.choreTap(L, s3, userA(), "basura", L.ymdShift(DAY, 2), 1, "L3").log.occ, DAY);
  assert.ok(logic.choreTap(L, clean(shared()), userA(), "banio", DAY).already, "es mañana");
  assert.ok(!logic.choreTap(L, clean(shared()), userA(), "nada", DAY).log);
});

// ---------- resumen semanal ----------
const SUN = "2026-10-18";
test("resumen semanal: agenda, fechas, tareas, cuentas, listas y un gracias", () => {
  const s = clean(shared());
  s.events.w1 = {id:"w1", title:"Cumple Juli", date:"2026-10-21", start:"20:00", owner:"pB", who:["pA"]};
  s.events.w2 = {id:"w2", title:"Muy lejos", date:"2026-10-30", owner:"pA"};
  s.dues.d4 = {id:"d4", title:"Seguro", due:"2026-10-22", unit:"year", n:1};
  s.choreLog = {
    a:{id:"a", chore:"basura", by:"pA", date:"2026-10-13"}, b:{id:"b", chore:"basura", by:"pA", date:"2026-10-17"},
    c:{id:"c", chore:"plantas", by:"pB", date:"2026-10-16"}, d:{id:"d", chore:"plantas", by:null, skip:true, date:"2026-10-16"},
    e:{id:"e", chore:"plantas", by:"pB", date:"2026-10-05"}};
  s.expenses = {x1:{id:"x1", kind:"expense", group:"g1", desc:"Súper", amount:10000, cur:"ARS", date:"2026-10-15", paidBy:"pB", splitMode:"equal", split:{pA:true, pB:true}}};
  s.lists = {l1:{id:"l1", name:"Compras"}};
  s.items = {i1:{id:"i1", list:"l1", text:"Leche", done:false}, i2:{id:"i2", list:"l1", text:"Pan", done:true}, i3:{id:"i3", list:"borrada", text:"X", done:false}};
  s.thanks = {t1:{id:"t1", from:"pB", to:"pA", text:"por la cena", createdAt:Date.parse("2026-10-16T12:00:00Z")}, t2:{id:"t2", from:"pB", to:"pA", text:"viejo", createdAt:Date.parse("2026-09-01T12:00:00Z")}};
  const m = logic.weekly(L, s, userA(), SUN, Date.parse(SUN + "T23:00:00Z"), () => 0.99);
  assert.equal(m.title, "Tu semana, Aldi 🗓️"); assert.equal(m.tag, "weekly");
  const b = m.body.replace(/\u00a0/g, " ");
  assert.match(b, /mié 21 · 20:00 Lucas: Cumple Juli|mié 21 · 20:00 Cumple Juli/);
  assert.match(b, /mar 20 · 19:00 Yoga/, "los martes");
  assert.doesNotMatch(b, /Muy lejos/);
  assert.match(b, /Seguro — vence el jue 22/);
  assert.match(b, /Cumpleaños de mamá — mar 20 🎉/);
  assert.match(b, /Tareas de la semana: vos 2, Lucas 1\./);
  assert.match(b, /Le debés \$ 5\.000,00 a Lucas/);
  assert.match(b, /Quedan 1 cosa sin tachar/);
  assert.match(b, /Lucas te dejó un gracias: “por la cena”/);
  assert.doesNotMatch(b, /viejo/);
  const mb = logic.weekly(L, s, userB(), SUN, Date.parse(SUN + "T23:00:00Z"));
  assert.match(mb.body.replace(/\u00a0/g, " "), /Aldi te debe \$ 5\.000,00/);
});
test("plan: el semanal sale los domingos a la hora elegida, una vez", async () => {
  const s = clean(shared()); const load = async () => s;
  const u = userA(); u.settings.notif = {morning:false, before:false, weeklyTime:"20:00"};
  let r = await plan({L, user:u, now:new Date("2026-10-13T23:10:00Z"), st:{}, load});      // martes 20:10
  assert.equal(r.msgs.length, 0);
  r = await plan({L, user:u, now:new Date("2026-10-18T22:59:00Z"), st:{}, load});          // domingo 19:59
  assert.equal(r.msgs.length, 0);
  r = await plan({L, user:u, now:new Date("2026-10-18T23:10:00Z"), st:{}, load});          // domingo 20:10
  assert.deepStrictEqual(r.msgs.map(m => m.tag), ["weekly"]); assert.equal(r.st.weekly, SUN);
  r = await plan({L, user:u, now:new Date("2026-10-18T23:40:00Z"), st:r.st, load});
  assert.equal(r.msgs.length, 0, "no repite");
  u.settings.notif.weekly = false;
  r = await plan({L, user:u, now:new Date("2026-10-25T23:10:00Z"), st:{}, load});
  assert.equal(r.msgs.length, 0, "apagado");
  assert.deepStrictEqual([logic.NOTIF_DEF.weekly, logic.NOTIF_DEF.weeklyTime, logic.NOTIF_DEF.budget], [true, "20:00", false]);
});

// ---------- presupuestos ----------
test("presupuestos: avisa al 80% y al 100% una vez por categoría y mes", async () => {
  const s = clean(shared()); s.config = {main:{expCats:[{id:"super", name:"Súper"}, {id:"comida", name:"Comida afuera"}]}};
  const u = userA(); u.settings.budgets = {"ARS:super":100000, "ARS:comida":0, "USD:viajes":50};
  u.settings.notif = {morning:false, before:false, budget:true};
  u.priv.tx = {a:{id:"a", kind:"tx", type:"gasto", cat:"super", cur:"ARS", amount:50000, date:"2026-10-02"},
    b:{id:"b", kind:"tx", type:"ingreso", cat:"super", cur:"ARS", amount:999999, date:"2026-10-02"},
    c:{id:"c", kind:"tx", type:"gasto", cat:"super", cur:"ARS", amount:999999, date:"2026-09-30"}};
  s.expenses = {x:{id:"x", kind:"expense", group:"g1", cat:"super", cur:"ARS", amount:60000, date:"2026-10-10", paidBy:"pB", splitMode:"equal", split:{pA:true, pB:true}}};
  let r = logic.budgetAlerts(L, s, u, "2026-10-12", {});
  assert.deepStrictEqual(r.msgs.map(m => m.title), ["Súper: ya usaste el 80% de tu presupuesto (día 12)"]);
  assert.match(r.msgs[0].body.replace(/\u00a0/g, " "), /Llevás \$ 80\.000,00 de \$ 100\.000,00/);
  assert.equal(logic.budgetAlerts(L, s, u, "2026-10-13", r.sent).msgs.length, 0, "no repite");
  u.priv.tx.d = {id:"d", kind:"tx", type:"gasto", cat:"super", cur:"ARS", amount:30000, date:"2026-10-13"};
  const r2 = logic.budgetAlerts(L, s, u, "2026-10-13", r.sent);
  assert.deepStrictEqual(r2.msgs.map(m => m.title), ["Súper: ya usaste el 100% de tu presupuesto (día 13)"]);
  assert.match(r2.msgs[0].body.replace(/\u00a0/g, " "), /Te pasaste por \$ 10\.000,00/);
  assert.equal(logic.budgetAlerts(L, s, u, "2026-10-20", r2.sent).msgs.length, 0);
  assert.deepStrictEqual(Object.keys(logic.budgetAlerts(L, s, u, "2026-11-01", r2.sent).sent), [], "mes nuevo: limpia");
  // salta del 0 al 100%: un solo aviso
  const r3 = logic.budgetAlerts(L, s, u, "2026-10-13", {});
  assert.equal(r3.msgs.length, 1); assert.ok(r3.sent["2026-10|ARS:super|80"]);
  // categoría desconocida: usa el id
  u.settings.budgets = {"ARS:mascotas":10}; u.priv.tx.e = {id:"e", type:"gasto", cat:"mascotas", cur:"ARS", amount:9, date:"2026-10-01"};
  assert.match(logic.budgetAlerts(L, s, u, "2026-10-13", {}).msgs[0].title, /^mascotas: ya usaste el 80%/);
  // en plan: apagado por defecto, y como mucho cada 3 horas
  u.settings.budgets = {"ARS:super":100000};
  const load = async () => s;
  let p = await plan({L, user:u, now:new Date("2026-10-13T15:00:00Z"), st:{}, load});
  assert.equal(p.msgs.length, 1);
  p = await plan({L, user:u, now:new Date("2026-10-13T16:00:00Z"), st:{...p.st, budget:{}}, load});
  assert.equal(p.msgs.length, 0, "todavía no pasaron 3 horas");
  u.settings.notif.budget = undefined;
  p = await plan({L, user:u, now:new Date("2026-10-13T15:00:00Z"), st:{}, load});
  assert.equal(p.msgs.length, 0, "por defecto apagado");
});

// ---------- comandos del bot ----------
const botCtx = s => { logic.useUser(L, s, {uid:"uA", settings:{}, priv:{}}, DAY); return {me:"pA", day:DAY, nowMs:1000, id:"E1"}; };
test("bot: comandos", () => {
  assert.deepStrictEqual(logic.parseCommand("/gasto@EntreDosBot 5000 súper"), {cmd:"gasto", args:"5000 súper"});
  assert.deepStrictEqual(logic.parseCommand("/Mañana"), {cmd:"manana", args:""});
  assert.equal(logic.parseCommand("hola"), null);
  const amt = t => logic.takeAmount(L, t.split(" "))?.amount;
  assert.deepStrictEqual(["5000", "$5.000", "12k", "12 lucas", "1,5 mil", "$ 2500,50", "12luca", "abc", "0"].map(amt), [5000, 5000, 12000, 12000, 1500, 2500.5, 12000, undefined, undefined]);
});
test("bot: /gasto arma el mismo gasto que la app", () => {
  const s = clean(shared());
  let r = logic.parseGasto(L, "5000 súper", botCtx(s));
  assert.deepStrictEqual(r.doc, {id:"E1", group:"g1", cur:"ARS", date:DAY, amount:5000, createdBy:"pA", createdAt:1000, updatedAt:1000, kind:"expense", desc:"Súper", paidBy:"pA", cat:"super",
    splitMode:"equal", split:{pA:true, pB:true}, note:"", updatedBy:"pA", source:"telegram"});
  assert.equal(r.path, "expenses/E1");
  assert.equal(r.reply, "✅ Cargado: $5.000 Súper (mitad con Lucas)");
  r = logic.parseGasto(L, "12 lucas nafta, mitad", botCtx(s));
  assert.equal(r.doc.amount, 12000); assert.equal(r.doc.desc, "Nafta"); assert.equal(r.doc.cat, "transporte"); assert.equal(r.doc.splitMode, "equal");
  r = logic.parseGasto(L, "8000 cena Lucas pagó", botCtx(s));
  assert.equal(r.doc.paidBy, "pB"); assert.equal(r.doc.desc, "Cena"); assert.equal(r.reply, "✅ Cargado: $8.000 Cena (mitad con Lucas, pagó Lucas)");
  r = logic.parseGasto(L, "3000 remedios vos", botCtx(s));
  assert.deepStrictEqual([r.doc.splitMode, r.doc.split, r.doc.paidBy], ["exact", {pB:3000}, "pA"]); assert.match(r.reply, /todo de Lucas/);
  r = logic.parseGasto(L, "3000 libro yo", botCtx(s));
  assert.deepStrictEqual(r.doc.split, {pA:3000}); assert.match(r.reply, /todo tuyo/);
  r = logic.parseGasto(L, "20 usd regalo", botCtx(s));
  assert.equal(r.doc.cur, "USD"); assert.equal(r.doc.desc, "Regalo"); assert.equal(r.doc.cat, "otros", "sin categoría adivinada → Otros");
  // otro grupo con "en <grupo>" y reparto del grupo
  s.groups.g2 = {id:"g2", name:"Viaje a Bariloche", cur:"USD", members:["pA", "pB"], splitMode:"shares", weights:{pA:2, pB:1}, createdAt:5};
  r = logic.parseGasto(L, "100 hotel en viaje a bariloche", botCtx(s));
  assert.deepStrictEqual([r.doc.group, r.doc.cur, r.doc.desc, r.doc.cat, r.doc.splitMode, r.doc.split], ["g2", "USD", "Hotel", "viajes", "shares", {pA:2, pB:1}]);
  assert.match(r.reply, /según el grupo, en Viaje a Bariloche/);
  assert.match(logic.parseGasto(L, "súper", botCtx(s)).error, /\/gasto 5000/);
  assert.match(logic.parseGasto(L, "5000", botCtx(s)).error, /descripción/);
  const s2 = clean(shared()); s2.groups = {};
  assert.match(logic.parseGasto(L, "5000 súper", botCtx(s2)).error, /grupo/);
  // la app lo acepta: los saldos lo cuentan
  const s3 = clean(shared()); const d = logic.parseGasto(L, "5000 súper", botCtx(s3)).doc; s3.expenses = {[d.id]:d};
  logic.useUser(L, s3, userA(), DAY);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(L.balances("g1"))), {ARS:{pA:2500, pB:-2500}});
});
test("bot: /yo arma un movimiento personal", () => {
  const s = clean(shared()); botCtx(s);
  const r = logic.parseYo(L, "3500 farmacia", {uid:"uA", day:DAY, nowMs:1000, id:"T1", settings:{cur:"USD"}});
  assert.deepStrictEqual(r.doc, {id:"T1", kind:"tx", type:"gasto", desc:"Farmacia", amount:3500, cur:"USD", date:DAY, cat:"salud", createdAt:1000, source:"telegram"});
  assert.equal(r.path, "data/users/uA/T1");
  assert.equal(r.reply, "✅ Anotado en tus gastos: US$3.500 Farmacia · Salud (solo lo ves vos)");
  assert.equal(logic.parseYo(L, "2 lucas nafta", {uid:"uA", day:DAY, settings:{}}).doc.cur, "ARS");
  assert.ok(logic.parseYo(L, "nafta", {uid:"uA", day:DAY}).error);
});
test("bot: /compra y /falta", () => {
  const s = clean(shared()); let n = 0; const mkId = () => "I" + (++n);
  // sin listas: crea "Compras"
  let r = logic.parseCompra(L, "leche, pan , ", {...botCtx(s), mkId});
  assert.deepStrictEqual(r.writes, [
    {path:"lists/I1", doc:{id:"I1", name:"Compras", createdAt:1000}},
    {path:"items/I2", doc:{id:"I2", list:"I1", text:"leche", done:false, by:"pA", createdAt:1000}},
    {path:"items/I3", doc:{id:"I3", list:"I1", text:"pan", done:false, by:"pA", createdAt:1001}}]);
  assert.equal(r.reply, "🛒 Agregué a Compras: leche, pan");
  // elige la del súper aunque no sea la más nueva; no repite lo que ya está
  s.lists = {a:{id:"a", name:"Pendientes", createdAt:1}, b:{id:"b", name:"Lista del Súper", createdAt:2}, c:{id:"c", name:"Regalos", createdAt:3}};
  s.items = {x:{id:"x", list:"b", text:"Leche", done:false, createdAt:1}, y:{id:"y", list:"a", text:"Arreglar canilla", done:false, createdAt:1}, z:{id:"z", list:"b", text:"Yerba", done:true}};
  r = logic.parseCompra(L, "leche, yerba", {...botCtx(s), mkId});
  assert.deepStrictEqual(r.writes.map(w => [w.path.split("/")[0], w.doc.list, w.doc.text]), [["items", "b", "yerba"]]);
  assert.equal(r.reply, "🛒 Agregué a Lista del Súper: yerba\nYa estaban: leche");
  delete s.lists.b;
  assert.equal(logic.shopList(s.lists).id, "c", "si no hay de compras: la más nueva");
  assert.ok(logic.parseCompra(L, "  ", botCtx(s)).error);
  // falta
  s.lists.b = {id:"b", name:"Lista del Súper", createdAt:2}; botCtx(s);
  assert.equal(logic.faltaText(L, ""), "🛒 Falta en Lista del Súper:\n• Leche");
  assert.equal(logic.faltaText(L, "todo"), "🛒 Pendientes:\n• Arreglar canilla\n\n🛒 Lista del Súper:\n• Leche");
  assert.equal(logic.faltaText(L, "regalos"), "En Regalos no falta nada 🙌");
  assert.match(logic.HELP, /\/gasto/); assert.match(logic.HELP, /\/deshacer/);
});
