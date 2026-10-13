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
