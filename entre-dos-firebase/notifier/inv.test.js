// Pruebas del motor de Inversiones (../inversiones-calc.js). Correr con: node --test inv.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const INV = require("../inversiones-calc.js");

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} esperado ${b}, dio ${a}`);
// Un FCI que crece 3% por mes (interés compuesto diario) a partir de 100 el 1/1/2026
const T0 = Date.UTC(2026, 0, 1), DAY = 864e5;
const fciPrice = d => 100 * Math.pow(1.03, (Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) - T0) / DAY / (365 / 12));
// MEP que sube parejo de 1000 a 1100 en el año
const mep = []; for (let i = 0; i <= 300; i++) { const d = new Date(T0 + i * DAY).toISOString().slice(0, 10); mep.push({fecha:d, venta:1000 + 100 * i / 300}); }
const ipc = ["01", "02", "03", "04", "05", "06", "07", "08"].map(m => ({fecha:`2026-${m}-28`, valor:2}));
const px = d => ({[d]:fciPrice(d)});

function scenario(extra = {}) {
  const today = "2026-05-20";
  const ops = [
    INV.normOp({numero:1, tipo:"suscripcionFCI", simbolo:"FCIPESOS", moneda:"peso_Argentino", fechaOperado:"2026-01-10", montoOperacion:100000, cantidad:100000 / fciPrice("2026-01-10")}),
    INV.normOp({numero:2, tipo:"suscripcionFCI", simbolo:"FCIPESOS", moneda:"peso_Argentino", fechaOperado:"2026-03-15", montoOperacion:50000, cantidad:50000 / fciPrice("2026-03-15")}),
  ];
  const qty = ops.reduce((a, o) => a + o.qty, 0);
  const positions = [INV.normPos({cantidad:qty, ultimoPrecio:fciPrice(today), valorizado:qty * fciPrice(today), titulo:{simbolo:"FCIPESOS", descripcion:"Fondo Pesos", tipo:"fONDOSDEINVERSION", moneda:"peso_Argentino"}})];
  // fotos de precios de fin de mes (como las guardaría la app al sincronizar)
  const pxs = {FCIPESOS:Object.assign({}, ...["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"].map(px))};
  return INV.compute({ops, positions, px:pxs, mep, ipc, today, ...extra});
}

test("varias suscripciones del mismo FCI: rendimiento mensual parejo, no se infla por los aportes", () => {
  const r = scenario();
  assert.deepStrictEqual(r.months.map(m => m.ym), ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]);
  const dim = {"2026-02":28, "2026-03":31, "2026-04":30};
  for (const m of r.months.slice(1, 4)) near(m.ARS.r, Math.pow(1.03, dim[m.ym] / (365 / 12)) - 1, 0.0015, m.ym);
  // marzo tuvo un aporte de 50.000 a mitad de mes: la ganancia NO incluye ese aporte
  const mar = r.months[2].ARS;
  near(mar.flows, 50000, 1);
  assert.ok(mar.gain > 0 && mar.gain < 6000, "ganancia de marzo razonable: " + mar.gain);
  // mayo es parcial (hasta el 20)
  assert.equal(r.months[4].partial, true);
});

test("le ganó a la inflación: 3% vs 2% por mes", () => {
  const r = scenario();
  const p = INV.period(r.months, "2026-02", "2026-04", "ARS");
  near(p.r, Math.pow(1.03, 89 / (365 / 12)) - 1, 0.004);
  near(p.ipc, Math.pow(1.02, 3) - 1, 1e-9);
  assert.equal(p.verdict, "win");
  near(p.pp, ((Math.pow(1.03, 3) - Math.pow(1.02, 3)) * 100), 0.6);
});

test("en dólares: el MEP subió ~0,8%/mes, así que gana menos que en pesos", () => {
  const r = scenario();
  const ars = INV.period(r.months, "2026-02", "2026-04", "ARS"), usd = INV.period(r.months, "2026-02", "2026-04", "USD");
  assert.ok(usd.r < ars.r && usd.r > 0, `usd ${usd.r} ars ${ars.r}`);
  assert.equal(usd.verdict, "up");
});

test("tarjeta por inversión: pusiste 150.000 en 2 veces, cuánto vale y cuánto ganó (también contra inflación y en USD)", () => {
  const r = scenario();
  const h = r.holdings[0];
  assert.equal(h.sym, "FCIPESOS"); assert.equal(h.buys.length, 2); assert.equal(h.fci, true);
  near(h.investedARS, 150000, 1);
  assert.ok(h.valueARS > 150000);
  near(h.gainARS, h.valueARS - 150000, 1);
  assert.ok(h.realGainARS < h.gainARS && h.realGainARS > 0, "ganancia real menor que nominal pero positiva");
  assert.ok(h.buys[0].ret > h.buys[1].ret, "la primera compra rindió más que la segunda");
  assert.ok(h.gainUSD > 0);
  near(r.total.valueARS, h.valueARS, 1e-6);
});

test("mes sin inflación publicada: usa la última y la marca como estimada", () => {
  const r = scenario({today:"2026-09-10"});
  const sep = r.months.find(m => m.ym === "2026-09");
  assert.equal(sep.ipcEst, true); near(sep.ipc, 0.02, 1e-9);
});

test("bonos cotizan cada 100: el precio por unidad sale de plata/cantidad", () => {
  const o = INV.normOp({numero:9, tipo:"compra", simbolo:"AL30", moneda:"peso_Argentino", fechaOperado:"2026-02-01", montoOperacion:65000, cantidad:100, operaciones:[{fecha:"2026-02-01", cantidad:100, precio:65000}]});
  near(o.price, 650, 1e-9);
});

test("historial incompleto: si hoy hay más cuotapartes que las operaciones, ajusta para cerrar con IOL", () => {
  const today = "2026-04-10";
  const ops = [INV.normOp({numero:1, tipo:"compra", simbolo:"GGAL", moneda:"peso_Argentino", fechaOperado:"2026-02-01", montoOperacion:10000, cantidad:10})];
  const positions = [INV.normPos({cantidad:15, ultimoPrecio:1200, valorizado:18000, titulo:{simbolo:"GGAL", tipo:"aCCIONES", moneda:"peso_Argentino"}})];
  const r = INV.compute({ops, positions, px:{}, mep, ipc, today});
  near(r.total.valueARS, 18000, 1e-6);
  assert.deepStrictEqual(r.notes, ["GGAL"]);
  assert.equal(r.holdings[0].partialHistory, true);
});

test("venta total: la posición cerrada sigue mostrando cuánto ganó", () => {
  const today = "2026-04-10";
  const ops = [
    INV.normOp({numero:1, tipo:"compra", simbolo:"AAPL", moneda:"peso_Argentino", fechaOperado:"2026-01-05", montoOperacion:20000, cantidad:2}),
    INV.normOp({numero:2, tipo:"venta", simbolo:"AAPL", moneda:"peso_Argentino", fechaOperado:"2026-03-05", montoOperacion:26000, cantidad:2}),
  ];
  const r = INV.compute({ops, positions:[], px:{}, mep, ipc, today});
  const h = r.holdings.find(x => x.sym === "AAPL");
  assert.equal(h.open, false); near(h.gainARS, 6000, 1e-6);
  near(r.total.valueARS, 0, 1e-9);
});

test("FCI en dólares: se valúa en USD y se pasa a pesos al MEP de cada día", () => {
  const today = "2026-04-10";
  const ops = [INV.normOp({numero:1, tipo:"suscripcionFCI", simbolo:"FCIUSD", moneda:"dolar_Estadounidense", fechaOperado:"2026-01-10", montoOperacion:1000, cantidad:1000})];
  const positions = [INV.normPos({cantidad:1000, ultimoPrecio:1.01, valorizado:1010, titulo:{simbolo:"FCIUSD", tipo:"fONDOSDEINVERSION", moneda:"dolar_Estadounidense"}})];
  const r = INV.compute({ops, positions, px:{}, mep, ipc, today});
  const h = r.holdings[0];
  near(h.gainUSD, 10, 1e-6);
  assert.ok(h.gainARS > 10 * 1000, "en pesos gana además por la suba del dólar");
});

const {invRecapMsg} = require("./logic");
test("resumen mensual por Telegram cuando sale la inflación", () => {
  const sum = {months:{"2026-08":{ars:{g:30000, r:0.025}, usd:{g:15, r:0.012}}, "2026-09":{ars:{g:40956, r:0.023}, usd:{g:12.67, r:0.011}}, "2026-10":{ars:{g:5000, r:0.006}, partial:true}}};
  const ipcS = [{fecha:"2026-08-31", valor:1.7}, {fecha:"2026-09-30", valor:1.9}];
  const r = invRecapMsg(sum, ipcS);
  assert.equal(r.ym, "2026-09");
  assert.match(r.msg.title, /septiembre/);
  assert.match(r.msg.body, /Ganaste \$40\.956 \(\+2,3%\)\. La inflación fue 1,9%, así que quedaste prácticamente igual/);
  assert.match(r.msg.body, /En dólares: \+US\$ 13/);
  assert.match(r.msg.body, /En el año vas \+4,9% contra 3,6% de inflación 🟢/);
  // si el mes publicado todavía no está calculado (la persona no abrió la app), no manda nada
  assert.equal(invRecapMsg(sum, [{fecha:"2026-10-31", valor:2}]), null);
  assert.equal(invRecapMsg(null, ipcS), null);
});

const backup = require("./backup");
test("respaldo: cifra, se descifra igual (también con WebCrypto como la app) y no lleva lo privado de otros", async () => {
  const shared = {people:{a:{id:"a", name:"Aldi", uid:"u1"}}, expenses:{e:{id:"e", amount:10}}};
  const priv = [{id:"t1", kind:"tx", amount:5}, {id:"settings", kind:"settings", cur:"ARS", tgChat:"123"}, {id:"push_x", kind:"push", token:"T"}, {id:"inv_ledger", kind:"inv"}];
  const b = backup.build(shared, priv, "2026-10-18");
  assert.equal(b.compartido.personas.a.uid, undefined); assert.equal(b.compartido.personas.a.conCuenta, true);
  assert.deepStrictEqual(Object.keys(b.soloMio).sort(), ["movimientos", "preferencias"]);
  assert.equal(b.soloMio.preferencias.tgChat, undefined);
  const enc = backup.encrypt(b, "clave-larga");
  assert.ok(!JSON.stringify(enc).includes("Aldi"));
  assert.deepStrictEqual(backup.decrypt(enc, "clave-larga"), b);
  assert.throws(() => backup.decrypt(enc, "otra"));
  // misma cuenta que hace el navegador (index.html decryptBackup)
  const {subtle} = globalThis.crypto; const b64 = x => Uint8Array.from(Buffer.from(x, "base64"));
  const base = await subtle.importKey("raw", new TextEncoder().encode("clave-larga"), "PBKDF2", false, ["deriveKey"]);
  const key = await subtle.deriveKey({name:"PBKDF2", salt:b64(enc.salt), iterations:enc.iter, hash:"SHA-256"}, base, {name:"AES-GCM", length:256}, false, ["decrypt"]);
  const plain = await subtle.decrypt({name:"AES-GCM", iv:b64(enc.iv)}, key, b64(enc.data));
  assert.deepStrictEqual(JSON.parse(new TextDecoder().decode(plain)), b);
});
