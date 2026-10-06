const enc = new TextEncoder();
const REGION = "eu-central-003";
const PHOTO_PREFIX = "photos/";
const MAX_FILE_BYTES = 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/webp"]);

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400"
  };
}
function json(data, status) {
  const headers = new Headers(corsHeaders());
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { status: status || 200, headers: headers });
}
function hex(bytes) {
  return Array.from(bytes, function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}
async function sha256(data) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", data)));
}
async function hmac(keyBytes, text) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}
function rfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, function (c) {
    return "%" + c.charCodeAt(0).toString(16).toUpperCase();
  });
}
function canonicalQuery(params) {
  return Array.from(params.entries()).map(function (entry) {
    return [rfc3986(entry[0]), rfc3986(entry[1])];
  }).sort(function (a, b) {
    return a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]);
  }).map(function (entry) { return entry[0] + "=" + entry[1]; }).join("&");
}
function encodedPath(value) {
  return value.split("/").map(rfc3986).join("/");
}
async function s3Request(env, method, key, params, body, contentType) {
  const endpoint = String(env.B2_ENDPOINT || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const bucket = String(env.BUCKET_NAME || "");
  const keyId = env.B2_APPLICATION_KEY_ID;
  const appKey = env.B2_APPLICATION_KEY;
  if (!endpoint || !bucket || !keyId || !appKey) throw new Error("Worker configuration is incomplete");
  const path = "/" + encodedPath(bucket) + (key ? "/" + encodedPath(key) : "");
  const url = new URL("https://" + endpoint + path);
  if (params) params.forEach(function (value, name) { url.searchParams.set(name, value); });
  const payload = body || new Uint8Array(0);
  const payloadHash = await sha256(payload);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "") ;
  const date = amzDate.slice(0, 8);
  const region = endpoint.split(".")[1] || REGION;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = "host:" + url.host + "\n" +
    "x-amz-content-sha256:" + payloadHash + "\n" +
    "x-amz-date:" + amzDate + "\n";
  const canonicalRequest = method + "\n" + url.pathname + "\n" + canonicalQuery(url.searchParams) + "\n" +
    canonicalHeaders + "\n" + signedHeaders + "\n" + payloadHash;
  const scope = date + "/" + region + "/s3/aws4_request";
  const stringToSign = "AWS4-HMAC-SHA256\n" + amzDate + "\n" + scope + "\n" + await sha256(enc.encode(canonicalRequest));
  const kDate = await hmac(enc.encode("AWS4" + appKey), date);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, "s3");
  const kSigning = await hmac(kService, "aws4_request");
  const signature = hex(await hmac(kSigning, stringToSign));
  const headers = new Headers({
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    "Authorization": "AWS4-HMAC-SHA256 Credential=" + keyId + "/" + scope + ", SignedHeaders=" + signedHeaders + ", Signature=" + signature
  });
  if (contentType) headers.set("Content-Type", contentType);
  return fetch(url.toString(), { method: method, headers: headers, body: method === "PUT" ? payload : undefined });
}
function xmlValue(text, tag) {
  const match = text.match(new RegExp("<" + tag + ">(.*?)</" + tag + ">", "s"));
  if (!match) return "";
  return match[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&apos;/g, "'");
}
function tokenMatches(expected, provided) {
  if (!expected || !provided || expected.length !== provided.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  return mismatch === 0;
}
function imagePage() {
  return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>School memories</title><style>*{box-sizing:border-box}body{margin:0;background:#f7f5f0;color:#20251f;font:16px system-ui,sans-serif}header{padding:36px 6vw;background:#183c35;color:#fff}h1{margin:0 0 8px;font-size:clamp(2rem,5vw,3.4rem)}header p{margin:0;color:#d8e4dc}.wrap{max-width:1200px;margin:auto;padding:28px 5vw}.panel{background:white;border:1px solid #e4e1d9;border-radius:18px;padding:22px;margin-bottom:24px;box-shadow:0 8px 28px #182b2110}.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}input,button{font:inherit}button{border:0;border-radius:10px;padding:11px 16px;background:#176d59;color:white;cursor:pointer}button:disabled{opacity:.55;cursor:wait}#status{color:#58625c}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px}.card{overflow:hidden;margin:0;background:white;border:1px solid #e6e3db;border-radius:14px}.card img{display:block;width:100%;height:210px;object-fit:cover;background:#eee}.card figcaption{padding:10px 12px;font-size:.88rem;overflow-wrap:anywhere}.muted{color:#647069}.storage-summary{margin:0 0 18px;padding:12px 16px;background:#e9f2ec;border:1px solid #d4e4d8;border-radius:12px;color:#183c35;font-weight:600}.hide{display:none}</style></head><body><header><h1>School memories</h1><p>Browse the photo archive and add a memory</p></header><main class="wrap"><section class="panel"><h2>Upload photos</h2><p class="muted">Choose an image up to 20 MB. It is compressed to WebP, up to 1 MB, before saving. The original is not kept.</p><form id="upload"><div class="row"><input id="files" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple required><button id="send" type="submit">Upload selected photos</button></div></form><p id="status" role="status"></p></section><section><div class="row"><h2>Photo archive</h2><button id="refresh" type="button">Refresh</button><button id="unlock" type="button">Admin delete</button><p class="muted">Enter the admin password to enable photo deletion.</p></div><form id="admin-form" class="row hide"><label for="admin-password">Admin password</label><input id="admin-password" type="password" autocomplete="current-password" required><button type="submit">Unlock</button></form><p id="storage-summary" class="storage-summary" role="status">Calculating storage used…</p><div id="grid" class="grid"></div><p id="empty" class="muted hide">No photos yet. Add the first one above.</p><button id="more" class="hide" type="button">Load more</button></section></main><script>const grid=document.querySelector("#grid"),statusBox=document.querySelector("#status"),more=document.querySelector("#more"),unlock=document.querySelector("#unlock");let cursor="",adminToken="",deleteConfigured=false;async function compressPhoto(file){if(file.size>20*1024*1024)throw new Error("Choose images that are 20 MB or smaller.");if(!file.type.startsWith("image/"))throw new Error("Choose an image file.");let bitmap;try{bitmap=await createImageBitmap(file)}catch(e){throw new Error("This browser cannot read that image format. Try JPEG or PNG.")}let scale=Math.min(1,1920/Math.max(bitmap.width,bitmap.height)),quality=.82,blob=null;for(let attempt=0;attempt<12;attempt++){const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext("2d").drawImage(bitmap,0,0,canvas.width,canvas.height);blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/webp",quality));if(blob&&blob.size<=1024*1024)break;if(quality>.59)quality=Math.max(.55,quality-.08);else{scale*=.82;quality=.78}}bitmap.close();if(!blob||blob.size>1024*1024)throw new Error("This image could not be reduced below 1 MB. Try a smaller image.");return blob}function card(item){const fig=document.createElement("figure");fig.className="card";const link=document.createElement("a");link.href=item.url;link.target="_blank";link.rel="noopener";const img=document.createElement("img");img.loading="lazy";img.src=item.url;img.alt=item.name;link.append(img);const caption=document.createElement("figcaption");caption.textContent=item.name;fig.append(link,caption);if(adminToken){const del=document.createElement("button");del.className="delete";del.type="button";del.textContent="Delete";del.addEventListener("click",async()=>{if(!window.confirm("Delete this photo permanently?"))return;try{const res=await fetch("/api/delete",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+adminToken},body:JSON.stringify({key:item.key})});const result=await res.json();if(!res.ok)throw new Error(result.error||"Delete failed");statusBox.textContent="Photo deleted.";await load(true)}catch(error){statusBox.textContent=error.message}});fig.append(del)}return fig}async function loadStorage(){const summary=document.querySelector("#storage-summary");try{const res=await fetch("/api/storage");const data=await res.json();if(!res.ok)throw new Error(data.error||"Could not read storage usage");const amount=data.bytes>=1073741824?(data.bytes/1073741824).toFixed(2)+" GB":(data.bytes/1048576).toFixed(2)+" MB";summary.textContent="Storage used: "+amount+" · "+data.photoCount+" photos"}catch(error){summary.textContent="Storage usage is temporarily unavailable."}}async function load(reset){if(reset){grid.replaceChildren();cursor="";loadStorage()}const url="/api/images"+(cursor?"?cursor="+encodeURIComponent(cursor):"");const res=await fetch(url);const data=await res.json();if(!res.ok)throw new Error(data.error||"Could not load photos");for(const item of data.items)grid.append(card(item));document.querySelector("#empty").classList.toggle("hide",grid.children.length!==0);cursor=data.next||"";more.classList.toggle("hide",!cursor)}unlock.addEventListener("click",()=>{const form=document.querySelector("#admin-form");form.classList.toggle("hide");if(!form.classList.contains("hide"))document.querySelector("#admin-password").focus()});document.querySelector("#admin-form").addEventListener("submit",async e=>{e.preventDefault();if(!deleteConfigured){statusBox.textContent="Admin deletion is off. Set ADMIN_PASSWORD in Worker settings first.";return}const field=document.querySelector("#admin-password"),candidate=field.value;if(!candidate)return;try{const res=await fetch("/api/admin/check",{method:"POST",headers:{"Authorization":"Bearer "+candidate}});if(!res.ok)throw new Error("That admin password was not accepted.");adminToken=candidate;field.value="";document.querySelector("#admin-form").classList.add("hide");unlock.textContent="Admin mode on";statusBox.textContent="Delete controls are active in this tab.";await load(true)}catch(error){statusBox.textContent=error.message}});fetch("/api/admin/status").then(r=>r.json()).then(data=>{deleteConfigured=!!data.enabled;if(!deleteConfigured)unlock.textContent="Admin password"}).catch(()=>{});document.querySelector("#refresh").addEventListener("click",()=>load(true).catch(e=>statusBox.textContent=e.message));more.addEventListener("click",()=>load(false).catch(e=>statusBox.textContent=e.message));document.querySelector("#upload").addEventListener("submit",async e=>{e.preventDefault();const files=Array.from(document.querySelector("#files").files);const button=document.querySelector("#send");button.disabled=true;try{for(let i=0;i<files.length;i++){statusBox.textContent="Compressing and uploading "+(i+1)+" of "+files.length+"…";const compressed=await compressPhoto(files[i]);const data=new FormData();data.append("file",compressed,files[i].name.replace(/\.[^.]+$/,"")+".webp");const res=await fetch("/api/upload",{method:"POST",body:data});const result=await res.json();if(!res.ok)throw new Error(result.error||"Upload failed")};document.querySelector("#files").value="";statusBox.textContent="Compressed uploads complete.";await load(true)}catch(error){statusBox.textContent=error.message}finally{button.disabled=false}});load(true).catch(e=>statusBox.textContent=e.message);</script></body></html>', {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
    if (request.method === "GET" && url.pathname === "/") return imagePage();
    if (request.method === "GET" && url.pathname === "/api/storage") {
      try {
        let bytes = 0, photoCount = 0, continuationToken = "", pages = 0;
        do {
          const params = new URLSearchParams({ "list-type": "2", "max-keys": "1000", "prefix": PHOTO_PREFIX });
          if (continuationToken) params.set("continuation-token", continuationToken);
          const upstream = await s3Request(env, "GET", "", params);
          if (!upstream.ok) return json({ error: "Could not read storage usage from B2." }, 502);
          const xml = await upstream.text();
          const objects = Array.from(xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g));
          for (const object of objects) { bytes += Number(xmlValue(object[1], "Size") || 0); photoCount++; }
          continuationToken = xmlValue(xml, "NextContinuationToken");
          pages++;
        } while (continuationToken && pages < 100);
        if (continuationToken) return json({ error: "Storage usage list is too large to summarize right now." }, 503);
        const headers = new Headers(corsHeaders());
        headers.set("Content-Type", "application/json; charset=utf-8");
        headers.set("Cache-Control", "public, max-age=60, s-maxage=300");
        return new Response(JSON.stringify({ bytes: bytes, photoCount: photoCount }), { headers: headers });
      } catch (error) { return json({ error: "Could not calculate storage usage." }, 500); }
    }
    if (request.method === "GET" && url.pathname === "/api/images") {
      try {
        const params = new URLSearchParams({ "list-type": "2", "max-keys": "100", "prefix": PHOTO_PREFIX });
        const cursor = url.searchParams.get("cursor");
        if (cursor) params.set("continuation-token", cursor);
        const upstream = await s3Request(env, "GET", "", params);
        if (!upstream.ok) return json({ error: "Could not read the photo archive from B2." }, 502);
        const xml = await upstream.text();
        const items = Array.from(xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)).map(function (match) {
          const block = match[1];
          const key = xmlValue(block, "Key");
          return { key: key, name: key.slice(PHOTO_PREFIX.length), size: Number(xmlValue(block, "Size") || 0), modified: xmlValue(block, "LastModified"), url: "/api/image?key=" + encodeURIComponent(key) };
        });
        return json({ items: items, next: xmlValue(xml, "NextContinuationToken") || null });
      } catch (error) { return json({ error: "The photo archive is not configured correctly." }, 500); }
    }
    if (request.method === "GET" && url.pathname === "/api/image") {
      const key = url.searchParams.get("key") || "";
      if (!key.startsWith(PHOTO_PREFIX) || key.includes("..")) return json({ error: "Invalid image path." }, 400);
      try {
        const upstream = await s3Request(env, "GET", key);
        if (!upstream.ok) return json({ error: upstream.status === 404 ? "Image not found." : "Could not retrieve this image." }, upstream.status === 404 ? 404 : 502);
        const headers = new Headers(corsHeaders());
        headers.set("Content-Type", upstream.headers.get("Content-Type") || "application/octet-stream");
        headers.set("Cache-Control", "public, max-age=3600");
        headers.set("X-Content-Type-Options", "nosniff");
        return new Response(upstream.body, { status: 200, headers: headers });
      } catch (error) { return json({ error: "Could not retrieve this image." }, 500); }
    }
    if (request.method === "GET" && url.pathname === "/api/admin/status") return json({ enabled: !!env.ADMIN_PASSWORD });
    if (request.method === "POST" && (url.pathname === "/api/admin/check" || url.pathname === "/api/delete")) {
      if (!env.ADMIN_PASSWORD) return json({ error: "Admin deletion is not configured." }, 503);
      const authorization = request.headers.get("Authorization") || "";
      const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
      if (!tokenMatches(env.ADMIN_PASSWORD, provided)) return json({ error: "Unauthorized." }, 403);
      if (url.pathname === "/api/admin/check") return json({ ok: true });
      try {
        const body = await request.json();
        const key = String(body.key || "");
        if (!key.startsWith(PHOTO_PREFIX) || key.includes("..")) return json({ error: "Invalid image path." }, 400);
        const upstream = await s3Request(env, "DELETE", key);
        if (!upstream.ok) return json({ error: "B2 could not delete this image." }, 502);
        return json({ deleted: true });
      } catch (error) { return json({ error: "Delete failed. Please try again." }, 500); }
    }
    if (request.method === "POST" && url.pathname === "/api/upload") {
      try {
        const form = await request.formData();
        const file = form.get("file");
        if (!file || typeof file.arrayBuffer !== "function") return json({ error: "Choose an image to upload." }, 400);
        if (file.size > MAX_FILE_BYTES) return json({ error: "Compressed images must be 1 MB or smaller." }, 413);
        if (!ALLOWED_TYPES.has(file.type)) return json({ error: "Use the gallery upload form so images are compressed to WebP." }, 415);
        const safeName = (file.name || "photo").normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "photo";
        const key = PHOTO_PREFIX + Date.now() + "-" + crypto.randomUUID() + "-" + safeName;
        const bytes = new Uint8Array(await file.arrayBuffer());
        const upstream = await s3Request(env, "PUT", key, null, bytes, file.type);
        if (!upstream.ok) return json({ error: "B2 could not save this image." }, 502);
        return json({ key: key, url: "/api/image?key=" + encodeURIComponent(key) }, 201);
      } catch (error) { return json({ error: "Upload failed. Please try again." }, 500); }
    }
    return json({ error: "Not found." }, 404);
  }
};
