/* Entre Dos · Inversiones: motor de cálculo (sin pantalla, sin red). Se prueba con notifier/inv.test.js.
   Idea: con cada compra y venta (con su fecha) y el precio de cada inversión en el tiempo,
   calculamos mes a mes cuánto creció la plata SIN contar lo que se agregó o sacó (método Modified Dietz),
   en pesos y en dólares MEP, y lo comparamos con la inflación del mes. */
const INV = (() => {
  "use strict";
  const DAY = 864e5;
  const pad = n => String(n).padStart(2, "0");
  const ymdOf = t => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
  const tOf = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const shift = (s, n) => ymdOf(tOf(s) + n * DAY);
  const ymAdd = (ym, n) => { const y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n; return `${y + Math.floor(m / 12)}-${pad(((m % 12) + 12) % 12 + 1)}`; };
  const monthEnd = ym => ymdOf(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0));
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

  // ---------- normalización de lo que devuelve IOL ----------
  const ccyOf = m => /dolar|usd/i.test(String(m || "")) ? "USD" : "ARS";
  const isFci = tipo => /fondo|fci/i.test(String(tipo || ""));
  const BUY = ["compra", "suscripcion", "suscripcionPrimaria", "suscripcionFCI"], SELL = ["venta", "rescate", "rescateFCI"];
  // Operación de IOL (detalle o lista) → {n, date, side, sym, ccy, qty, price, amount}
  function normOp(o, fallbackCcy) {
    const t = String(o.tipo || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f\s_]/g, "");
    const side = BUY.some(x => x.toLowerCase() === t) || /compra|suscrip/.test(t) ? "buy" : SELL.some(x => x.toLowerCase() === t) || /venta|rescate/.test(t) ? "sell" : null;
    if (!side) return null;
    const fills = Array.isArray(o.operaciones) ? o.operaciones.filter(f => num(f.cantidad) > 0) : [];
    let qty = fills.length ? fills.reduce((s, f) => s + num(f.cantidad), 0) : num(o.cantidadOperada) || num(o.cantidad);
    let amount = num(o.montoOperacion) || num(o.montoOperado) || num(o.monto);
    let price = fills.length ? fills.reduce((s, f) => s + num(f.cantidad) * num(f.precio), 0) / qty : num(o.precioOperado) || num(o.precio);
    if (!amount && qty && price) amount = qty * price;
    // precio por unidad = plata / cantidad (en bonos IOL cotiza cada 100 nominales; así queda igual que en la cartera)
    if (qty && amount) price = amount / qty;
    if (!qty && price && amount) qty = amount / price;
    const date = String(o.fechaOperado || o.fechaOperada || (fills[0] && fills[0].fecha) || o.fechaOrden || o.fechaAlta || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(amount > 0) || !o.simbolo) return null;
    return {n:String(o.numero || ""), date, side, sym:String(o.simbolo).toUpperCase(), ccy:o.moneda ? ccyOf(o.moneda) : (fallbackCcy || "ARS"), qty, price, amount, fci:/fci/.test(t)};
  }
  // Posición de la cartera actual → info del título + precio de hoy
  function normPos(a) {
    const t = a.titulo || {};
    const qty = num(a.cantidad), price = num(a.ultimoPrecio) || (qty ? num(a.valorizado) / qty : 0);
    // en FCI y bonos IOL a veces cotiza "cada 100" o similar: usamos valorizado/cantidad para no errarle
    const unit = qty && num(a.valorizado) ? num(a.valorizado) / qty : price;
    return {sym:String(t.simbolo || "").toUpperCase(), desc:t.descripcion || t.simbolo || "", tipo:t.tipo || "", mercado:t.mercado || "", ccy:ccyOf(t.moneda), fci:isFci(t.tipo), qty, price:unit, value:num(a.valorizado) || qty * unit};
  }

  // ---------- series: dólar MEP e inflación ----------
  function mepFn(series) {
    const s = (series || []).map(x => ({d:String(x.fecha).slice(0, 10), v:num(x.venta) || num(x.v) || num(x.compra)})).filter(x => x.v > 0).sort((a, b) => a.d < b.d ? -1 : 1);
    return d => { if (!s.length) return null; let lo = 0, hi = s.length - 1, r = null;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (s[mid].d <= d) { r = s[mid].v; lo = mid + 1; } else hi = mid - 1; }
      return r ?? s[0].v; };
  }
  // argentinadatos: [{fecha:"2026-09-30", valor:1.9}] → {"2026-09": 0.019}
  const ipcMap = series => Object.fromEntries((series || []).map(x => [String(x.fecha).slice(0, 7), num(x.valor) / 100]).filter(([k]) => /^\d{4}-\d{2}$/.test(k)));

  // ---------- precio de cada título en cualquier fecha ----------
  // puntos conocidos: px[sym][fecha] (cierres guardados, fotos de cada sincronización) + precios de las operaciones + hoy.
  // Entre dos puntos interpolamos geométricamente (para FCI, que crecen parejo, es muy preciso).
  function priceFn(sym, px, ops, today, priceToday, ccy, mep) {
    const pts = {};
    for (const [d, v] of Object.entries(px || {})) if (num(v) > 0) pts[d] = num(v);
    for (const o of ops) if (o.price > 0 && pts[o.date] == null) {
      let p = o.price; if (o.ccy !== ccy) { const r = mep(o.date); if (!r) continue; p = o.ccy === "USD" ? p * r : p / r; }
      pts[o.date] = p;
    }
    if (priceToday > 0) pts[today] = priceToday;
    const list = Object.entries(pts).sort((a, b) => a[0] < b[0] ? -1 : 1);
    return d => {
      if (!list.length) return 0;
      if (d <= list[0][0]) return list[0][1];
      if (d >= list[list.length - 1][0]) return list[list.length - 1][1];
      let i = 1; while (list[i][0] < d) i++;
      const [d0, p0] = list[i - 1], [d1, p1] = list[i];
      if (d1 === d) return p1;
      const f = (tOf(d) - tOf(d0)) / (tOf(d1) - tOf(d0));
      return p0 * Math.pow(p1 / p0, f);
    };
  }

  // ---------- cálculo principal ----------
  // input: {ops:[normOp], positions:[normPos], px:{sym:{date:price}}, info:{sym:{desc,tipo,ccy,fci}}, mep:[...], ipc:[...], today:"YYYY-MM-DD"}
  function compute(input) {
    const today = input.today, mep = mepFn(input.mep), ipc = ipcMap(input.ipc);
    const pos = Object.fromEntries((input.positions || []).filter(p => p.sym && p.qty > 0).map(p => [p.sym, p]));
    const info = {...(input.info || {})};
    for (const p of Object.values(pos)) info[p.sym] = {desc:p.desc, tipo:p.tipo, ccy:p.ccy, fci:p.fci, mercado:p.mercado};
    const bySym = {};
    for (const o of (input.ops || []).slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)) (bySym[o.sym] ||= []).push(o);
    const syms = [...new Set([...Object.keys(bySym), ...Object.keys(pos)])];
    // Si hoy tenés más (o menos) de lo que explican las operaciones (historial incompleto, transferencias),
    // agregamos un ajuste al inicio para que el valor de hoy cierre con IOL.
    const notes = [];
    for (const s of syms) {
      const ops = bySym[s] || [], now = pos[s]?.qty || 0;
      const rec = ops.reduce((q, o) => q + (o.side === "buy" ? o.qty : -o.qty), 0);
      const diff = now - rec;
      if (Math.abs(diff) > Math.max(1e-6, Math.abs(now) * 0.01)) {
        const ccy = info[s]?.ccy || pos[s]?.ccy || "ARS";
        const first = ops[0]?.date || shift(today, -1);
        const pf0 = priceFn(s, input.px?.[s], ops, today, pos[s]?.price || 0, ccy, mep);
        if (diff > 0) { (bySym[s] ||= []).unshift({n:"ajuste", date:first, side:"buy", sym:s, ccy, qty:diff, price:pf0(first), amount:diff * pf0(first), adj:true}); notes.push(s); }
        else if (ops.length) bySym[s].push({n:"ajuste", date:today, side:"sell", sym:s, ccy, qty:-diff, price:pf0(today), amount:-diff * pf0(today), adj:true});
      }
    }
    const pf = {}, ccyS = {};
    for (const s of syms) { ccyS[s] = info[s]?.ccy || pos[s]?.ccy || bySym[s]?.[0]?.ccy || "ARS"; pf[s] = priceFn(s, input.px?.[s], bySym[s] || [], today, pos[s]?.price || 0, ccyS[s], mep); }
    const qtyAt = (s, d) => (bySym[s] || []).reduce((q, o) => o.date <= d ? q + (o.side === "buy" ? o.qty : -o.qty) : q, 0);
    const conv = (v, from, to, d) => { if (from === to) return v; const r = mep(d); if (!r) return null; return from === "USD" ? v * r : v / r; };
    // valor de toda la cartera al cierre del día d, en ARS o USD
    const valueAt = (d, to) => { let t = 0; for (const s of syms) { const q = qtyAt(s, d); if (q > 1e-9) { const v = conv(q * pf[s](d), ccyS[s], to, d); if (v == null) return null; t += v; } } return t; };
    const flowsIn = (from, to, cur) => { const out = []; for (const s of syms) for (const o of bySym[s] || []) if (o.date > from && o.date <= to) { const v = conv(o.amount, o.ccy, cur, o.date); if (v != null) out.push({d:o.date, v:o.side === "buy" ? v : -v}); } return out; };
    const allOps = Object.values(bySym).flat();
    if (!allOps.length) return {months:[], holdings:[], total:null, notes, empty:true};
    const firstYm = allOps.reduce((m, o) => o.date < m ? o.date : m, today).slice(0, 7);
    const months = [];
    for (let ym = firstYm; ym <= today.slice(0, 7); ym = ymAdd(ym, 1)) {
      const start = shift(ym + "-01", -1), end = ym === today.slice(0, 7) ? today : monthEnd(ym);
      const days = Math.max(1, (tOf(end) - tOf(start)) / DAY);
      const row = {ym, partial:end === today && end !== monthEnd(ym), ipc:ipc[ym] ?? null};
      for (const cur of ["ARS", "USD"]) {
        const vs = valueAt(start, cur), ve = valueAt(end, cur), fl = flowsIn(start, end, cur);
        if (vs == null || ve == null) { row[cur] = null; continue; }
        const F = fl.reduce((a, f) => a + f.v, 0), W = fl.reduce((a, f) => a + f.v * (tOf(end) - tOf(f.d)) / DAY / days, 0);
        const gain = ve - vs - F, den = vs + W;
        row[cur] = {vs, ve, flows:F, gain, r:den > Math.max(1, 0.02 * Math.max(vs, Math.abs(F))) ? gain / den : null};
      }
      months.push(row);
    }
    // estimación de inflación para meses sin dato todavía (INDEC publica a mitad del mes siguiente)
    const known = Object.keys(ipc).sort(); const lastIpc = known.length ? ipc[known[known.length - 1]] : null;
    for (const m of months) if (m.ipc == null && lastIpc != null && m.ym > (known[known.length - 1] || "")) { m.ipc = lastIpc; m.ipcEst = true; }
    // inflación acumulada entre dos fechas (aprox. por meses, prorrateando el primero y el último)
    const infFactor = (from, to) => {
      let f = 1; let ym = from.slice(0, 7);
      while (ym <= to.slice(0, 7)) {
        const rate = ipc[ym] ?? (ym > (known[known.length - 1] || "") ? lastIpc : null) ?? 0;
        const ms = ym + "-01", me = monthEnd(ym), a = from > ms ? from : ms, b = to < me ? to : me;
        const frac = Math.max(0, (tOf(b) - tOf(a)) / DAY) / ((tOf(me) - tOf(ms)) / DAY + 1);
        f *= Math.pow(1 + rate, frac); ym = ymAdd(ym, 1);
      }
      return f;
    };
    const mepNow = mep(today);
    const holdings = syms.map(s => {
      const ops = bySym[s] || [], q = qtyAt(s, today), price = pf[s](today), ccy = ccyS[s];
      const valueOwn = q * price, valueARS = conv(valueOwn, ccy, "ARS", today) ?? 0, valueUSD = conv(valueOwn, ccy, "USD", today) ?? 0;
      let netARS = 0, netUSD = 0, realARS = 0;
      for (const o of ops) { const sg = o.side === "buy" ? 1 : -1, a = conv(o.amount, o.ccy, "ARS", o.date) ?? 0, u = conv(o.amount, o.ccy, "USD", o.date) ?? 0;
        netARS += sg * a; netUSD += sg * u; realARS += sg * a * infFactor(o.date, today); }
      const buys = ops.filter(o => o.side === "buy" && !o.adj).map(o => ({date:o.date, amount:o.amount, ccy:o.ccy, price:o.price, ret:o.price > 0 ? (conv(price, ccy, o.ccy, today) / o.price) - 1 : null,
        infl:infFactor(o.date, today) - 1, usdRet:(() => { const a0 = conv(o.amount, o.ccy, "USD", o.date), a1 = o.price > 0 ? conv(o.qty * price, ccy, "USD", today) : null; return a0 && a1 != null ? a1 / a0 - 1 : null; })()}));
      const sells = ops.filter(o => o.side === "sell" && !o.adj).map(o => ({date:o.date, amount:o.amount, ccy:o.ccy}));
      return {sym:s, desc:info[s]?.desc || s, tipo:info[s]?.tipo || "", fci:!!info[s]?.fci || ops.some(o => o.fci), ccy, qty:q, price, open:q > 1e-9,
        valueARS, valueUSD, gainARS:valueARS - netARS, gainUSD:valueUSD - netUSD, realGainARS:valueARS - realARS, investedARS:netARS, buys, sells, partialHistory:ops.some(o => o.adj && o.side === "buy")};
    }).filter(h => h.open || h.buys.length).sort((a, b) => b.valueARS - a.valueARS);
    const open = holdings.filter(h => h.open);
    const total = {valueARS:open.reduce((a, h) => a + h.valueARS, 0), valueUSD:open.reduce((a, h) => a + h.valueUSD, 0), mep:mepNow,
      realGainARS:holdings.reduce((a, h) => a + h.realGainARS, 0), gainARS:holdings.reduce((a, h) => a + h.gainARS, 0), gainUSD:holdings.reduce((a, h) => a + h.gainUSD, 0)};
    return {months, holdings, total, notes};
  }

  // ---------- resumen de un período (mes, 3 meses, año, todo) ----------
  function period(months, fromYm, toYm, cur) {
    const ms = months.filter(m => m.ym >= fromYm && m.ym <= toYm && m[cur]);
    if (!ms.length) return null;
    let ret = 1, inf = 1, hasR = false, infKnown = true, infEst = false;
    for (const m of ms) { if (m[cur].r != null) { ret *= 1 + m[cur].r; hasR = true; } if (m.ipc == null) infKnown = false; else { inf *= 1 + m.ipc; if (m.ipcEst) infEst = true; } }
    const gain = ms.reduce((a, m) => a + m[cur].gain, 0), r = hasR ? ret - 1 : null, ipc = infKnown ? inf - 1 : null;
    const pp = r != null && ipc != null ? (r - ipc) * 100 : null;
    const verdict = cur !== "ARS" ? (gain > 0 ? "up" : gain < 0 ? "down" : "flat") : pp == null ? null : pp > 0.5 ? "win" : pp < -0.5 ? "lose" : "tie";
    return {gain, r, ipc, ipcEst:infEst, pp, real:r != null && ipc != null ? (1 + r) / (1 + ipc) - 1 : null, verdict, from:ms[0].ym, to:ms[ms.length - 1].ym, n:ms.length};
  }
  return {normOp, normPos, compute, period, mepFn, ipcMap, priceFn, ymAdd, monthEnd, shift, ccyOf, isFci};
})();
if (typeof module !== "undefined") module.exports = INV;
