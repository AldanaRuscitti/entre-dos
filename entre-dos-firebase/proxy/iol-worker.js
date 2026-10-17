// Intermediario de Entre Dos para IOL (Cloudflare Worker, gratis).
// IOL no deja que una página web lea sus respuestas directo, así que esto solo las reenvía.
// Reglas de seguridad:
//  - Solo atiende pedidos que vienen de la app de Entre Dos (ORIGENES).
//  - Solo deja pasar: pedir el permiso (POST /token) y LEER datos (GET /api/v2/...). Nunca operar (comprar, vender, rescatar).
//  - No guarda ni registra nada: ni usuarios, ni contraseñas, ni respuestas.
const ORIGENES = ["https://aldanaruscitti.github.io", "http://localhost:8766"];
const IOL = "https://api.invertironline.com";

export default {
  async fetch(req) {
    const origin = req.headers.get("Origin") || "";
    const ok = ORIGENES.includes(origin);
    const cors = {"Access-Control-Allow-Origin":ok ? origin : "null", "Access-Control-Allow-Headers":"authorization, content-type", "Access-Control-Allow-Methods":"GET, POST, OPTIONS", "Access-Control-Max-Age":"86400", "Vary":"Origin"};
    if (req.method === "OPTIONS") return new Response(null, {status:204, headers:cors});
    if (!ok) return new Response("No permitido", {status:403, headers:cors});
    const url = new URL(req.url);
    const esToken = req.method === "POST" && url.pathname === "/token";
    const esLectura = req.method === "GET" && url.pathname.startsWith("/api/v2/") && !/operar|asesor/i.test(url.pathname);
    if (!esToken && !esLectura) return new Response("No permitido", {status:403, headers:cors});
    const headers = {Accept:"application/json"};
    const auth = req.headers.get("Authorization"); if (auth) headers.Authorization = auth;
    if (esToken) headers["Content-Type"] = "application/x-www-form-urlencoded";
    let r;
    try { r = await fetch(IOL + url.pathname + url.search, {method:req.method, headers, body:esToken ? await req.text() : undefined}); }
    catch { return new Response(JSON.stringify({error:"IOL no responde"}), {status:502, headers:{...cors, "Content-Type":"application/json"}}); }
    return new Response(r.body, {status:r.status, headers:{...cors, "Content-Type":r.headers.get("Content-Type") || "application/json", "Cache-Control":"no-store"}});
  }
};
