const enc = new TextEncoder();
const REGION = "eu-central-003";
const PHOTO_PREFIX = "photos/";
// Prefer client-compressed WebP <=1MB; allow original JPEG/PNG/etc up to 20MB when compression cannot.
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/webp",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/avif"
]);

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
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
async function s3Request(env, method, key, params, body, contentType, extraHeaders) {
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
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const region = endpoint.split(".")[1] || REGION;
  const signed = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (extraHeaders) Object.entries(extraHeaders).forEach(function (entry) {
    const name = entry[0].toLowerCase();
    if (!(name.startsWith("x-amz-meta-") || name === "range")) throw new Error("Unsupported signed header");
    signed[name] = String(entry[1]).trim().replace(/\s+/g, " ");
  });
  const signedNames = Object.keys(signed).sort();
  const signedHeaders = signedNames.join(";");
  const canonicalHeaders = signedNames.map(function (name) { return name + ":" + signed[name] + "\n"; }).join("");
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
  if (extraHeaders) Object.entries(extraHeaders).forEach(function (entry) { headers.set(entry[0], String(entry[1])); });
  return fetch(url.toString(), { method: method, headers: headers, body: method === "PUT" ? payload : undefined });
}
function xmlValue(text, tag) {
  const match = text.match(new RegExp("<" + tag + ">(.*?)</" + tag + ">", "s"));
  if (!match) return "";
  return match[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&apos;/g, "'");
}
let googleJwksCache = { keys: [], expiresAt: 0 };
class HttpError extends Error {
  constructor(message, status) { super(message); this.name = "HttpError"; this.status = status; }
}
function authError(message, status) { return new HttpError(message, status); }
function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, function (character) { return character.charCodeAt(0); });
}
async function googleJwks(force) {
  if (!force && googleJwksCache.expiresAt > Date.now() && googleJwksCache.keys.length) return googleJwksCache.keys;
  let response;
  try { response = await fetch("https://www.googleapis.com/oauth2/v3/certs"); }
  catch (error) { throw authError("Google token verification is temporarily unavailable.", 503); }
  if (!response.ok) throw authError("Google token verification is temporarily unavailable.", 503);
  const data = await response.json();
  if (!Array.isArray(data.keys)) throw authError("Google token verification is temporarily unavailable.", 503);
  googleJwksCache = { keys: data.keys, expiresAt: Date.now() + 3600000 };
  return googleJwksCache.keys;
}
async function verifyGoogleToken(request, env) {
  if (!env.GOOGLE_CLIENT_ID) throw authError("Google sign-in is not configured.", 503);
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token || token.length > 16000) throw authError("A valid Google sign-in is required.", 401);
  const parts = token.split(".");
  if (parts.length !== 3) throw authError("A valid Google sign-in is required.", 401);
  let header, claims;
  try {
    header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
  } catch (error) { throw authError("A valid Google sign-in is required.", 401); }
  if (header.alg !== "RS256" || !header.kid) throw authError("A valid Google sign-in is required.", 401);
  let keys = await googleJwks(false);
  let jwk = keys.find(function (key) { return key.kid === header.kid && key.alg === "RS256"; });
  if (!jwk) {
    keys = await googleJwks(true);
    jwk = keys.find(function (key) { return key.kid === header.kid && key.alg === "RS256"; });
  }
  if (!jwk) throw authError("A valid Google sign-in is required.", 401);
  let valid = false;
  try {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    valid = await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, key, decodeBase64Url(parts[2]), enc.encode(parts[0] + "." + parts[1]));
  } catch (error) { throw authError("A valid Google sign-in is required.", 401); }
  const now = Math.floor(Date.now() / 1000);
  if (!valid || claims.aud !== env.GOOGLE_CLIENT_ID || !["accounts.google.com", "https://accounts.google.com"].includes(claims.iss) || claims.email_verified !== true || !Number.isFinite(claims.exp) || claims.exp <= now || !claims.sub || !claims.email) {
    throw authError("A valid Google sign-in is required.", 401);
  }
  return { sub: String(claims.sub), email: String(claims.email), name: typeof claims.name === "string" ? claims.name : "", picture: typeof claims.picture === "string" ? claims.picture : "" };
}
function isAdmin(user, env) {
  if (!user || !user.email) return false;
  const configured = [env.ADMIN_EMAIL];
  for (let i = 1; i <= 10; i++) configured.push(env["ADMIN_EMAIL_" + i]);
  const email = String(user.email).trim().toLowerCase();
  return configured.some(function (value) { return !!value && String(value).trim().toLowerCase() === email; });
}
function isSidecarKey(key) { return typeof key === "string" && (key.includes("sm-albums.webp") || key.includes("sm-descriptions.webp")); }
function photoKeyFrom(value) {
  try {
    let key = String(value || "");
    if (key.startsWith("/api/image?") || key.startsWith("http://") || key.startsWith("https://")) {
      const parsed = new URL(key, "https://gallery.invalid");
      if (parsed.pathname !== "/api/image") return "";
      key = parsed.searchParams.get("key") || "";
    }
    return key.startsWith(PHOTO_PREFIX) && !key.includes("..") ? key : "";
  } catch (error) { return ""; }
}
async function photoMetadata(env, key) {
  // Single HEAD only — never chain a GET fallback (each call counts as a Worker subrequest).
  const response = await s3Request(env, "HEAD", key);
  if (!response.ok) return { response: response, ownerId: "", ownerEmail: "" };
  return {
    response: response,
    ownerId: response.headers.get("x-amz-meta-owner-id") || "",
    ownerEmail: response.headers.get("x-amz-meta-owner-email") || ""
  };
}
function byteIndexOf(bytes, needle) {
  outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
const SIDE_CAR_WEBP = decodeBase64Url("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==".replace(/\+/g, "-").replace(/\//g, "_"));
async function readAlbumStore(env) {
  // Fixed key only — avoid listing the whole bucket (that alone can blow the subrequest budget).
  const key = "photos/sm-albums.webp";
  const response = await s3Request(env, "GET", key);
  if (response.status === 404) return { key: key, albums: [], prefix: SIDE_CAR_WEBP };
  if (!response.ok) throw new Error("Could not read the album store.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  const marker = enc.encode("\n<!--SMALBUMS-->");
  const markerIndex = byteIndexOf(bytes, marker);
  if (markerIndex < 0) throw new Error("The album store format is invalid.");
  const albums = JSON.parse(new TextDecoder().decode(bytes.slice(markerIndex + marker.length)));
  if (!Array.isArray(albums)) throw new Error("The album store format is invalid.");
  return { key: key, albums: albums, prefix: bytes.slice(0, markerIndex) };
}
async function writeAlbumStore(env, source, albums) {
  const marker = enc.encode("\n<!--SMALBUMS-->");
  const payload = enc.encode(JSON.stringify(albums));
  const output = new Uint8Array(source.prefix.length + marker.length + payload.length);
  output.set(source.prefix, 0); output.set(marker, source.prefix.length); output.set(payload, source.prefix.length + marker.length);
  const response = await s3Request(env, "PUT", "photos/sm-albums.webp", null, output, "image/webp");
  if (!response.ok) throw new Error("Could not save the album store.");
}
function normalizedAlbums(albums, revealPrivate) {
  return albums.map(function (raw) {
    const album = raw && typeof raw === "object" ? Object.assign({}, raw) : {};
    album.photos = Array.isArray(album.photos) ? album.photos.map(function (photo) {
      if (typeof photo === "string") {
        return { url: photo, ownerId: "legacy", ownerEmail: "", uploadedAt: "" };
      }
      const entry = Object.assign({}, photo || {});
      if (!entry.ownerId) entry.ownerId = "legacy";
      if (typeof entry.ownerEmail !== "string") entry.ownerEmail = "";
      if (!revealPrivate) {
        delete entry.ownerEmail;
        delete entry.ownerName;
      }
      return entry;
    }) : [];
    if (!revealPrivate && album.createdBy && typeof album.createdBy === "object") {
      album.createdBy = Object.assign({}, album.createdBy);
      delete album.createdBy.email;
    }
    return album;
  });
}
function publicAlbum(album, revealPrivate) { return normalizedAlbums([album], revealPrivate)[0]; }

function requireAlbumOwner(user, album, env) {
  if (isAdmin(user, env)) return;
  const ownerId = album && album.createdBy && album.createdBy.id ? String(album.createdBy.id) : "";
  if (!ownerId || ownerId !== user.sub) throw authError("You can only manage albums you created.", 403);
}

async function deleteObjectBestEffort(env, key) {
  if (!key || !key.startsWith(PHOTO_PREFIX) || key.includes("..")) return;
  try { await s3Request(env, "DELETE", key); } catch (error) { /* ignore cleanup failures */ }
}

async function requireAlbumPhotoAccess(env, user, key, options) {
  const strict = !!(options && options.strict);
  if (isAdmin(user, env)) return;
  // Non-strict (create album / append photos): trust the Google token and stamp
  // ownership in album JSON — no per-photo B2 HEAD (avoids subrequest storms).
  if (!strict) return;
  const meta = await photoMetadata(env, key);
  if (meta.response.status === 404) throw authError("Photo not found.", 404);
  if (!meta.response.ok) throw authError("Could not verify photo ownership.", 502);
  if (!meta.ownerId || meta.ownerId !== user.sub) throw authError("You can only add or remove photos you own.", 403);
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
          for (const object of objects) {
            const key = xmlValue(object[1], "Key");
            bytes += Number(xmlValue(object[1], "Size") || 0);
            if (key && !isSidecarKey(key)) photoCount++;
          }
          continuationToken = xmlValue(xml, "NextContinuationToken");
          pages++;
        } while (continuationToken && pages < 20);
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
        return json({ items: items.filter(function (item) { return !isSidecarKey(item.key); }), next: xmlValue(xml, "NextContinuationToken") || null });
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
    if (request.method === "GET" && url.pathname === "/api/me") {
      try {
        const user = await verifyGoogleToken(request, env);
        return json({ id: user.sub, email: user.email, name: user.name, isAdmin: isAdmin(user, env) });
      } catch (error) { return json({ error: error.message || "A valid Google sign-in is required." }, error.status || 401); }
    }
    if (request.method === "GET" && url.pathname === "/api/albums") {
      let user = null;
      if (request.headers.get("Authorization") && env.GOOGLE_CLIENT_ID) {
        try { user = await verifyGoogleToken(request, env); } catch (error) { user = null; }
      }
      try {
        const store = await readAlbumStore(env);
        const admin = isAdmin(user, env);
        // Ownership emails come from the album sidecar only (no per-photo B2 HEAD).
        return json({ albums: normalizedAlbums(store.albums, admin), viewerIsAdmin: admin });
      } catch (error) { return json({ error: "Could not read albums." }, error.status || 502); }
    }
    if (request.method === "POST" && url.pathname === "/api/albums") {
      let user;
      try { user = await verifyGoogleToken(request, env); }
      catch (error) { return json({ error: error.message }, error.status || 401); }
      try {
        const body = await request.json();
        const person = String(body.person || "").trim().slice(0, 160);
        const cover = String(body.cover || "");
        const coverKey = photoKeyFrom(cover);
        if (!person || !coverKey) return json({ error: "Provide an album name and a valid photo cover." }, 400);
        await requireAlbumPhotoAccess(env, user, coverKey, { strict: false });
        const store = await readAlbumStore(env);
        // Always store a proxy URL so clients never request /photos/… directly.
        const coverUrl = "/api/image?key=" + encodeURIComponent(coverKey);
        const album = { id: crypto.randomUUID(), person: person, cover: coverUrl, photos: [], createdAt: new Date().toISOString(), createdBy: { id: user.sub, email: user.email, name: user.name || undefined } };
        const albums = [album, ...store.albums];
        await writeAlbumStore(env, store, albums);
        return json({ album: publicAlbum(album, isAdmin(user, env)) }, 201);
      } catch (error) { return json({ error: error.message || "Could not create album." }, error.status || 500); }
    }
    const albumMatch = url.pathname.match(/^\/api\/albums\/([^/]+)$/);
    if (albumMatch && request.method === "PUT") {
      let user;
      try { user = await verifyGoogleToken(request, env); }
      catch (error) { return json({ error: error.message }, error.status || 401); }
      try {
        const albumId = decodeURIComponent(albumMatch[1]);
        const body = await request.json();
        const store = await readAlbumStore(env);
        const index = store.albums.findIndex(function (item) { return item && item.id === albumId; });
        if (index === -1) return json({ error: "Album not found." }, 404);
        const album = store.albums[index];
        requireAlbumOwner(user, album, env);

        let nextPerson = album.person;
        if (body.person !== undefined) {
          nextPerson = String(body.person || "").trim().slice(0, 160);
          if (!nextPerson) return json({ error: "Album name cannot be empty." }, 400);
        }

        let nextCover = album.cover;
        if (body.cover !== undefined) {
          const coverKey = photoKeyFrom(String(body.cover || ""));
          if (!coverKey) return json({ error: "Provide a valid cover photo." }, 400);
          await requireAlbumPhotoAccess(env, user, coverKey, { strict: false });
          nextCover = "/api/image?key=" + encodeURIComponent(coverKey);
          const previousKey = photoKeyFrom(album.cover || "");
          if (previousKey && previousKey !== coverKey) await deleteObjectBestEffort(env, previousKey);
        }

        const updated = Object.assign({}, album, { person: nextPerson, cover: nextCover });
        store.albums[index] = updated;
        await writeAlbumStore(env, store, store.albums);
        return json({ album: publicAlbum(updated, isAdmin(user, env)) });
      } catch (error) { return json({ error: error.message || "Could not update album." }, error.status || 500); }
    }
    if (albumMatch && request.method === "DELETE") {
      let user;
      try { user = await verifyGoogleToken(request, env); }
      catch (error) { return json({ error: error.message }, error.status || 401); }
      try {
        const albumId = decodeURIComponent(albumMatch[1]);
        const store = await readAlbumStore(env);
        const index = store.albums.findIndex(function (item) { return item && item.id === albumId; });
        if (index === -1) return json({ error: "Album not found." }, 404);
        const album = store.albums[index];
        requireAlbumOwner(user, album, env);

        // Cap B2 deletes so large albums stay under the Worker subrequest limit.
        const keys = [];
        const coverKey = photoKeyFrom(album.cover || "");
        if (coverKey) keys.push(coverKey);
        (Array.isArray(album.photos) ? album.photos : []).forEach(function (photo) {
          const key = photoKeyFrom(typeof photo === "string" ? photo : photo && photo.url);
          if (key) keys.push(key);
        });
        const MAX_DELETE = 40;
        for (let i = 0; i < Math.min(keys.length, MAX_DELETE); i++) {
          await deleteObjectBestEffort(env, keys[i]);
        }

        store.albums.splice(index, 1);
        await writeAlbumStore(env, store, store.albums);
        return json({ deleted: true, id: albumId, objectsDeleted: Math.min(keys.length, MAX_DELETE) });
      } catch (error) { return json({ error: error.message || "Could not delete album." }, error.status || 500); }
    }
    const albumPhotosMatch = url.pathname.match(/^\/api\/albums\/([^/]+)\/photos$/);
    if (albumPhotosMatch && request.method === "POST") {
      let user;
      try { user = await verifyGoogleToken(request, env); }
      catch (error) { return json({ error: error.message }, error.status || 401); }
      try {
        const albumId = decodeURIComponent(albumPhotosMatch[1]);
        const body = await request.json();
        if (!Array.isArray(body.photos) || body.photos.length < 1 || body.photos.length > 50) return json({ error: "Provide between 1 and 50 photo URLs." }, 400);
        const keys = body.photos.map(photoKeyFrom);
        if (keys.some(function (key) { return !key; })) return json({ error: "All photos must use valid gallery image URLs." }, 400);
        // One ownership gate for the batch (no N× B2 HEAD).
        await requireAlbumPhotoAccess(env, user, keys[0], { strict: false });
        const store = await readAlbumStore(env);
        const album = store.albums.find(function (item) { return item && item.id === albumId; });
        if (!album) return json({ error: "Album not found." }, 404);
        requireAlbumOwner(user, album, env);
        if (!Array.isArray(album.photos)) album.photos = [];
        const added = keys.map(function (key) {
          const entry = { url: "/api/image?key=" + encodeURIComponent(key), ownerId: user.sub, ownerEmail: user.email, uploadedAt: new Date().toISOString() };
          if (user.name) entry.ownerName = user.name;
          return entry;
        });
        album.photos.push(...added);
        await writeAlbumStore(env, store, store.albums);
        return json({ album: publicAlbum(album, isAdmin(user, env)), added: added.length });
      } catch (error) { return json({ error: error.message || "Could not add album photos." }, error.status || 500); }
    }
    if (albumPhotosMatch && request.method === "DELETE") {
      let user;
      try { user = await verifyGoogleToken(request, env); }
      catch (error) { return json({ error: error.message }, error.status || 401); }
      try {
        const albumId = decodeURIComponent(albumPhotosMatch[1]);
        const body = await request.json();
        const key = photoKeyFrom(body.key || body.url);
        if (!key) return json({ error: "Provide a valid gallery photo key or URL." }, 400);
        const store = await readAlbumStore(env);
        const album = store.albums.find(function (item) { return item && item.id === albumId; });
        if (!album) return json({ error: "Album not found." }, 404);
        const photoEntry = (Array.isArray(album.photos) ? album.photos : []).find(function (photo) {
          return photoKeyFrom(typeof photo === "string" ? photo : photo && photo.url) === key;
        });
        if (!photoEntry) return json({ error: "Photo is not in this album." }, 404);
        const entryOwner = typeof photoEntry === "object" && photoEntry ? String(photoEntry.ownerId || "") : "";
        if (!isAdmin(user, env) && entryOwner && entryOwner !== "legacy" && entryOwner !== user.sub) {
          return json({ error: "You can only add or remove photos you own." }, 403);
        }
        if (!isAdmin(user, env) && (!entryOwner || entryOwner === "legacy")) {
          await requireAlbumPhotoAccess(env, user, key, { strict: true });
        }
        const removed = await s3Request(env, "DELETE", key);
        if (!removed.ok) return json({ error: "B2 could not delete this image." }, 502);
        album.photos = album.photos.filter(function (photo) { return photoKeyFrom(typeof photo === "string" ? photo : photo && photo.url) !== key; });
        await writeAlbumStore(env, store, store.albums);
        return json({ deleted: true });
      } catch (error) { return json({ error: error.message || "Could not remove this album photo." }, error.status || 500); }
    }
    if (request.method === "GET" && url.pathname === "/api/admin/status") return json({ enabled: !!env.ADMIN_PASSWORD });
    if (request.method === "POST" && url.pathname === "/api/admin/check") {
      if (!env.ADMIN_PASSWORD) return json({ error: "Admin deletion is not configured." }, 503);
      const authorization = request.headers.get("Authorization") || "";
      const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
      if (!tokenMatches(env.ADMIN_PASSWORD, provided)) return json({ error: "Unauthorized." }, 403);
      return json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/api/delete") {
      const authorization = request.headers.get("Authorization") || "";
      const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
      const passwordAdmin = !!(env.ADMIN_PASSWORD && tokenMatches(env.ADMIN_PASSWORD, provided));
      let user = null;
      if (!passwordAdmin) {
        try { user = await verifyGoogleToken(request, env); }
        catch (error) { return json({ error: error.message }, error.status || 401); }
      }
      try {
        const body = await request.json();
        const key = String(body.key || "");
        if (!key.startsWith(PHOTO_PREFIX) || key.includes("..")) return json({ error: "Invalid image path." }, 400);
        const meta = await photoMetadata(env, key);
        if (meta.response.status === 404) return json({ error: "Image not found." }, 404);
        if (!meta.response.ok) return json({ error: "Could not verify photo ownership." }, 502);
        if (!passwordAdmin && !isAdmin(user, env) && (!meta.ownerId || meta.ownerId !== user.sub)) return json({ error: "You do not own this photo." }, 403);
        const upstream = await s3Request(env, "DELETE", key);
        if (!upstream.ok) return json({ error: "B2 could not delete this image." }, 502);
        return json({ deleted: true });
      } catch (error) { return json({ error: error.message || "Delete failed. Please try again." }, error.status || 500); }
    }
    if (request.method === "POST" && url.pathname === "/api/upload") {
      let user;
      try { user = await verifyGoogleToken(request, env); }
      catch (error) { return json({ error: error.message }, error.status || 401); }
      try {
        const form = await request.formData();
        const file = form.get("file");
        if (!file || typeof file.arrayBuffer !== "function") return json({ error: "Choose an image to upload." }, 400);
        if (file.size > MAX_FILE_BYTES) return json({ error: "Images must be 20 MB or smaller." }, 413);
        const fileType = String(file.type || "").toLowerCase();
        if (!ALLOWED_TYPES.has(fileType)) return json({ error: "Upload a JPEG, PNG, WebP, GIF, or AVIF image." }, 415);
        // Sidecar stores must stay WebP so the album/description parsers keep working.
        const pendingName = (file.name || "photo").normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "photo";
        if ((pendingName === "sm-albums.webp" || pendingName === "sm-descriptions.webp") && fileType !== "image/webp") {
          return json({ error: "Sidecar stores must be WebP." }, 415);
        }
        const safeName = pendingName;
        const isSidecar = safeName === "sm-albums.webp" || safeName === "sm-descriptions.webp";
        const key = PHOTO_PREFIX + Date.now() + "-" + crypto.randomUUID() + "-" + safeName;
        const bytes = new Uint8Array(await file.arrayBuffer());
        const metadata = isSidecar ? undefined : {
          "x-amz-meta-owner-id": user.sub,
          "x-amz-meta-owner-email": user.email,
          "x-amz-meta-owner-name": String(user.name || "").replace(/[\r\n]/g, " ").slice(0, 160)
        };
        const upstream = await s3Request(env, "PUT", key, null, bytes, fileType || file.type, metadata);
        if (!upstream.ok) return json({ error: "B2 could not save this image." }, 502);
        return json({ key: key, url: "/api/image?key=" + encodeURIComponent(key), ownerId: user.sub, ownerEmail: user.email }, 201);
      } catch (error) { return json({ error: error.message || "Upload failed. Please try again." }, error.status || 500); }
    }
    return json({ error: "Not found." }, 404);
  }
};