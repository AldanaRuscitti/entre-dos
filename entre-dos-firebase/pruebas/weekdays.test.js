// Tareas en días fijos de la semana ("los martes y domingos"): cálculo de la próxima, adelantar, ponerse al día, por día, pausa.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {load} = require("./lib.js");

function setup(today) {
  const A = load(); A.S.people = {a:{id:"a"}, b:{id:"b"}, c:{id:"c"}}; A.S.choreLog = {}; A.setToday(today);
  let n = 0;
  A.log = o => { const id = "l" + (++n); A.S.choreLog[id] = {id, chore:"k", createdAt:1000 + n, ...o}; };
  A.done = (c, by, skip) => { const st = A.choreState(c); A.log({by, skip, date:A.todayS(), occ:A.choreOccCover(c, st.due, A.todayS())}); };
  return A;
}
const MT = {id:"k", unit:"weekdays", wdays:[2, 4], assign:"rotate", who:["a", "b"], start:"2026-10-13"}; // martes y jueves

test("nunca hecha: arranca en el primer día elegido desde el inicio", () => {
  const A = setup("2026-10-12");
  assert.equal(A.choreState(MT).due, "2026-10-13"); assert.equal(A.choreState(MT).days, 1);
  assert.equal(A.choreState({...MT, start:"2026-10-14"}).due, "2026-10-15");
});
test("a tiempo, adelantada, atrasada (se pone al día) y salteada", () => {
  const A = setup("2026-10-13");
  A.done(MT, "a"); assert.equal(A.choreState(MT).due, "2026-10-15"); assert.equal(A.choreState(MT).who, "b");
  A.setToday("2026-10-14"); A.done(MT, "b");
  assert.equal(Object.values(A.S.choreLog).at(-1).occ, "2026-10-15"); assert.equal(A.choreState(MT).due, "2026-10-20");
  A.setToday("2026-10-23"); assert.equal(A.choreState(MT).days, -3); A.done(MT, "a");
  assert.equal(Object.values(A.S.choreLog).at(-1).occ, "2026-10-22"); assert.equal(A.choreState(MT).due, "2026-10-27");
  A.setToday("2026-10-24"); A.done(MT, null, true);
  assert.equal(A.choreState(MT).due, "2026-10-29"); assert.equal(A.choreState(MT).who, "b");
});
test("registros viejos sin 'occ' usan su fecha", () => {
  const A = setup("2026-10-16"); A.log({by:"a", date:"2026-10-14"});
  assert.equal(A.choreState(MT).due, "2026-10-15"); assert.equal(A.choreState(MT).days, -1);
});
test("según el día: martes a, jueves b; dueño inexistente = cualquiera", () => {
  const A = setup("2026-10-13"); const BD = {...MT, assign:"byDay", dayOwner:{"2":"a", "4":"b"}};
  assert.equal(A.choreState(BD).who, "a"); A.done(BD, "a"); assert.equal(A.choreState(BD).who, "b");
  assert.equal(A.choreState({...BD, dayOwner:{"2":"fantasma"}}).who, null);
});
test("cruce de semana y de año", () => {
  const A = setup("2026-12-28");
  assert.equal(A.choreState({...MT, wdays:[0], start:"2026-12-28"}).due, "2027-01-03");
});
test("cambio de horario en Santiago (inicio y fin)", () => {
  const A = setup("2026-09-05"); const SUN = {...MT, wdays:[0], start:"2026-09-01"};
  assert.equal(A.choreState(SUN).due, "2026-09-06"); assert.equal(A.choreState(SUN).days, 1);
  A.setToday("2026-09-07"); A.log({by:"a", date:"2026-09-07", occ:"2026-09-06"}); assert.equal(A.choreState(SUN).due, "2026-09-13");
  const B = setup("2027-04-03"); const WE = {...MT, wdays:[0, 6], start:"2027-04-03"};
  assert.equal(B.choreState(WE).due, "2027-04-03"); B.done(WE, "a"); assert.equal(B.choreState(WE).due, "2027-04-04");
});
test("cambiar los días después de haberla hecho", () => {
  const A = setup("2026-10-14"); A.log({by:"a", date:"2026-10-14", occ:"2026-10-15"});
  assert.equal(A.choreState({...MT, wdays:[1, 3]}).due, "2026-10-19");
});
test("pausa: no queda pendiente durante el viaje y sigue después", () => {
  const A = setup("2026-10-20"); const P = {...MT, pausedUntil:"2026-10-25"};
  A.log({by:"a", date:"2026-10-13", occ:"2026-10-13"});
  assert.equal(A.choreState(P).due, "2026-10-27"); assert.ok(A.choreState(P).paused);
  const I = {id:"k", unit:"week", every:1, assign:"rotate", who:["a"], pausedUntil:"2026-10-25"};
  assert.equal(A.choreState(I).due, "2026-10-26");
});
test("sin días elegidos no hay próxima; textos de frecuencia", () => {
  const A = setup("2026-10-13");
  assert.equal(A.chorePending({wdays:[]}, []), null);
  assert.equal(A.wdaysLabel([2, 0], 1), "los martes y domingos");
  assert.equal(A.wdaysLabel([2, 0], 0), "los domingos y martes");
  assert.equal(A.wdaysLabel([1, 2, 3, 4, 5], 1), "de lunes a viernes");
  assert.equal(A.wdaysLabel([6, 0], 1), "los fines de semana");
  assert.equal(A.wdaysLabel([0, 1, 2, 3, 4, 5, 6], 1), "todos los días");
  assert.equal(A.wdaysLabel([1, 3, 5], 1), "los lunes, miércoles y viernes");
  assert.equal(A.wdaysLabel([6], 1), "los sábados");
});

test("una semana sí y otra no", () => {
  const A = setup("2026-10-12"); const ALT = {id:"k", unit:"weekdays", wdays:[2], wevery:2, assign:"anyone", who:[], start:"2026-10-13"};
  assert.equal(A.choreState(ALT).due, "2026-10-13");
  A.setToday("2026-10-13"); A.done(ALT, "a"); assert.equal(A.choreState(ALT).due, "2026-10-27");
  const OFF = {...ALT, wanchor:"2026-10-19"}; const B = setup("2026-10-12");
  assert.equal(B.choreState(OFF).due, "2026-10-20");
});
test("mover una sola fecha", () => {
  const A = setup("2026-10-13"); const MV = {...MT, wdays:[2], moveFrom:"2026-10-13", moveTo:"2026-10-14"};
  const st = A.choreState(MV); assert.equal(st.due, "2026-10-14"); assert.equal(st.pend, "2026-10-13"); assert.ok(st.moved);
  A.setToday("2026-10-14"); A.log({by:"a", date:"2026-10-14", occ:A.choreOccCover(MV, A.choreState(MV).pend, "2026-10-14")});
  assert.equal(Object.values(A.S.choreLog).at(-1).occ, "2026-10-13"); assert.equal(A.choreState(MV).due, "2026-10-20"); assert.ok(!A.choreState(MV).moved);
});
test("tarea de una sola vez", () => {
  const A = setup("2026-10-13"); const ON = {id:"k", unit:"once", start:"2026-10-20", assign:"fixed", who:["a"]};
  assert.equal(A.choreState(ON).due, "2026-10-20"); assert.ok(!A.choreState(ON).done);
  A.log({by:"a", date:"2026-10-13"}); assert.ok(A.choreState(ON).done);
});
