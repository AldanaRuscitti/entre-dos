// Bot de Entre Dos en Cloudflare (gratis). Hace 3 cosas:
//  1) Cada 15 minutos le pide a GitHub que corra los avisos (reloj confiable).
//  2) Recibe al instante los mensajes del bot de Telegram y se los pasa a GitHub para procesarlos (respuesta en segundos).
//  3) Audios y fotos de tickets: los entiende con la IA gratis de Cloudflare y te propone el gasto con un botón ✅ para confirmar.
// Secretos (Cloudflare → este Worker → Configuración → Variables y secretos):
//   TELEGRAM_BOT_TOKEN  el token del bot (el mismo que está en GitHub)
//   TG_SECRET           una clave inventada, larga (la usa Telegram para que nadie más pueda escribirle a este Worker)
//   GH_TOKEN            token de GitHub con permiso "Actions: lectura y escritura" solo sobre el repositorio entre-dos
// Además: Enlaces (Bindings) → Workers AI con el nombre AI, y KV con el nombre Q; y un Cron Trigger "*/15 * * * *".
// Los mensajes quedan como mucho 1 día en la cola Q hasta que el programa de avisos los procesa (después se borran).
// Así el contenido nunca pasa por GitHub (cuyos registros son públicos). Audios y fotos no se guardan.
const REPO = "AldanaRuscitti/entre-dos";
const WORKFLOW = "avisos.yml";

export default {
  async scheduled(_ev, env, ctx) { ctx.waitUntil(dispatch(env)); },

  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    // Configuración inicial: abrir https://ESTE-WORKER/setup?key=TG_SECRET una sola vez
    if (url.pathname === "/setup") {
      if (!env.TG_SECRET || url.searchParams.get("key") !== env.TG_SECRET) return new Response("No permitido", {status:403});
      const r = await tg(env, "setWebhook", {url:`${url.origin}/tg`, secret_token:env.TG_SECRET, allowed_updates:["message", "callback_query"], drop_pending_updates:false});
      const gh = await dispatch(env);
      return new Response(`Telegram: ${r.ok ? "listo ✅" : "error: " + (r.description || "")}\nGitHub: ${gh ? "listo ✅" : "revisá GH_TOKEN"}`, {headers:{"content-type":"text/plain; charset=utf-8"}});
    }
    // El programa de avisos (GitHub) busca los mensajes pendientes y después avisa cuáles procesó
    if (url.pathname === "/pending" || url.pathname === "/ack") {
      if (!env.TG_SECRET || req.headers.get("X-Key") !== env.TG_SECRET) return new Response("No permitido", {status:403});
      if (url.pathname === "/pending") {
        const list = await env.Q.list({prefix:"u:"}); const out = [];
        for (const k of list.keys) { const v = await env.Q.get(k.name); if (v) out.push(JSON.parse(v)); }
        out.sort((a, b) => a.update_id - b.update_id);
        return new Response(JSON.stringify(out), {headers:{"content-type":"application/json", "cache-control":"no-store"}});
      }
      const body = await req.json().catch(() => ({}));
      for (const id of body.ids || []) await env.Q.delete("u:" + String(id).padStart(12, "0"));
      return new Response("ok");
    }
    if (url.pathname !== "/tg" || req.method !== "POST") return new Response("No permitido", {status:403});
    if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TG_SECRET) return new Response("No permitido", {status:403});
    const up = await req.json().catch(() => null);
    if (up) ctx.waitUntil(handle(env, up).catch(() => {}));
    return new Response("ok");
  }
};

async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(body)});
  return r.json().catch(() => ({}));
}
async function dispatch(env) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {method:"POST",
    headers:{Authorization:`Bearer ${env.GH_TOKEN}`, Accept:"application/vnd.github+json", "User-Agent":"entre-dos-bot", "X-GitHub-Api-Version":"2022-11-28"},
    body:JSON.stringify({ref:"main"})});
  return r.status === 204;
}

async function handle(env, up) {
  const msg = up.message;
  if (msg && (msg.voice || msg.audio || (msg.photo && msg.photo.length) || (msg.document && /^image\//.test(msg.document.mime_type || "")))) {
    const chat = msg.chat.id;
    await tg(env, "sendChatAction", {chat_id:chat, action:"typing"});
    try {
      let heard = "", cmd = "";
      if (msg.voice || msg.audio) {
        const bytes = await fileBytes(env, (msg.voice || msg.audio).file_id);
        heard = await transcribe(env, bytes);
        if (!heard) throw new Error("vacío");
        cmd = await toCommand(env, heard);
      } else {
        const fid = msg.photo ? msg.photo[msg.photo.length - 1].file_id : msg.document.file_id;
        const bytes = await fileBytes(env, fid);
        cmd = await receipt(env, bytes, msg.caption || "");
        heard = msg.caption || "foto de un ticket";
      }
      if (!/^\/(gasto|yo|compra|precio|falta|semana|hoy|manana)\b/.test(cmd)) {
        await tg(env, "sendMessage", {chat_id:chat, text:`Escuché: “${heard}”\nNo me quedó claro qué cargar. Probá de nuevo o escribime, por ejemplo: /gasto 5000 súper mitad`});
        return;
      }
      await tg(env, "sendMessage", {chat_id:chat, text:`Entendí: “${heard.slice(0, 300)}”\n→ ${cmd}`,
        reply_markup:{inline_keyboard:[[{text:"✅ Cargar", callback_data:"ai:ok"}, {text:"✖ No", callback_data:"ai:no"}]]}});
    } catch {
      await tg(env, "sendMessage", {chat_id:chat, text:"No pude entender el audio o la foto. Probá de nuevo, o escribime el comando (por ejemplo /gasto 5000 súper mitad)."});
    }
    return;
  }
  if (up.callback_query && up.callback_query.data === "ai:no") {
    const q = up.callback_query;
    await tg(env, "answerCallbackQuery", {callback_query_id:q.id, text:"Listo, no cargué nada"});
    await tg(env, "editMessageReplyMarkup", {chat_id:q.message.chat.id, message_id:q.message.message_id, reply_markup:{inline_keyboard:[]}});
    return;
  }
  // Todo lo demás (comandos, botones ✅) lo procesa el programa de avisos en GitHub, al instante
  if (msg && msg.chat) await tg(env, "sendChatAction", {chat_id:msg.chat.id, action:"typing"});
  if (up.callback_query) await tg(env, "answerCallbackQuery", {callback_query_id:up.callback_query.id, text:"Un segundo…"});
  await env.Q.put("u:" + String(up.update_id).padStart(12, "0"), JSON.stringify(up), {expirationTtl:86400});
  await dispatch(env);
}

async function fileBytes(env, fileId) {
  const f = await tg(env, "getFile", {file_id:fileId});
  if (!f.ok || (f.result.file_size || 0) > 10e6) throw new Error("archivo");
  const r = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${f.result.file_path}`);
  return new Uint8Array(await r.arrayBuffer());
}
const b64 = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };

async function transcribe(env, bytes) {
  try { const r = await env.AI.run("@cf/openai/whisper-large-v3-turbo", {audio:b64(bytes), language:"es"}); if (r && r.text) return r.text.trim(); } catch {}
  const r2 = await env.AI.run("@cf/openai/whisper", {audio:[...bytes]});
  return (r2 && r2.text || "").trim();
}

const RULES = `Convertí lo que dice la persona (español rioplatense) en UN comando del bot de una app de pareja. Respondé SOLO el comando, en una línea, sin explicar.
Comandos:
/gasto MONTO DESCRIPCIÓN [mitad|yo|vos|todo de NOMBRE]  → gasto compartido (por defecto se divide en partes iguales; "a medias" = mitad)
/yo MONTO DESCRIPCIÓN → gasto personal (solo mío)
/compra ITEM, ITEM → agregar a la lista de compras
/precio PRODUCTO MONTO → anotar cuánto salió algo
/falta → ver qué falta comprar
/hoy | /manana | /semana → ver la agenda
Montos en números enteros: "18 lucas" o "18 mil" = 18000, "1 palo" = 1000000, "2,5 k" = 2500.
Ejemplos:
"gasté 18 lucas en la verdu, a medias" → /gasto 18000 verdulería mitad
"pagué el súper 54300" → /gasto 54300 súper
"me compré un café de 3500, es mío" → /yo 3500 café
"anotá leche y yerba" → /compra leche, yerba
"la yerba salió 4500" → /precio yerba 4500`;
async function toCommand(env, text) {
  const r = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {messages:[{role:"system", content:RULES}, {role:"user", content:text}], max_tokens:60, temperature:0});
  return clean(r && r.response);
}
const clean = s => String(s || "").split("\n").map(x => x.trim()).find(x => x.startsWith("/")) || "";

async function receipt(env, bytes, caption) {
  const model = "@cf/meta/llama-3.2-11b-vision-instruct";
  const ask = {messages:[{role:"user", content:`Es una foto de un ticket o factura de Argentina. Respondé SOLO un comando en una línea con el TOTAL pagado y el nombre del comercio, así: /gasto TOTAL COMERCIO. El total en número entero, sin puntos ni signos. ${caption ? "La persona agregó: " + caption + ". Si dice que es solo suyo usá /yo en vez de /gasto; si dice a medias agregá 'mitad' al final." : ""}`}], image:[...bytes], max_tokens:60, temperature:0};
  let r;
  try { r = await env.AI.run(model, ask); }
  catch (e) { if (/agree/i.test(String(e && e.message))) { await env.AI.run(model, {prompt:"agree"}); r = await env.AI.run(model, ask); } else throw e; }
  return clean(r && r.response);
}
