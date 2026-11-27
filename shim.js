/* Xavier's family — capa Google directa.
   Emula window.claude.use("mcp" | "db" | "user") amb les API de Google,
   perquè l'app funcioni fora de Claude. */
(function () {
  "use strict";
  const CFG = window.XF_CONFIG || {};
  const CLIENT_ID = CFG.clientId || "";
  const FOLDER_ID = CFG.folderId || "1bnokMvQ8ofoV3mgSsR-StzbCubecYl00";
  const SHEET_TITLE = CFG.sheetTitle || "Xavier's family · dades";
  const SCOPES = "openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive";
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const SS = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  };

  // ---------- Inici de sessió (OAuth amb redirecció) ----------
  const redirectUri = location.origin + location.pathname;
  let token = null;
  (function readHash() {
    if (!location.hash || location.hash.length < 2) return;
    const h = new URLSearchParams(location.hash.slice(1));
    if (!h.has("access_token") && !h.has("error")) return;
    const st = h.get("state") || "";
    if (st && st !== SS.get("xf.g.state")) { history.replaceState(null, "", redirectUri); return; }
    if (h.get("access_token")) {
      const exp = Date.now() + (parseInt(h.get("expires_in") || "3600", 10) - 60) * 1000;
      LS.set("xf.g.tok", JSON.stringify({ t: h.get("access_token"), exp }));
      LS.set("xf.g.ok", "1");
      SS.set("xf.g.silentFail", "");
    } else {
      SS.set("xf.g.silentFail", String(Date.now()));
    }
    history.replaceState(null, "", redirectUri);
  })();
  function loadToken() {
    try { const o = JSON.parse(LS.get("xf.g.tok") || "null"); if (o && o.t && o.exp > Date.now()) return o.t; } catch (e) {}
    return null;
  }
  token = loadToken();

  function signIn(interactive) {
    const st = Math.random().toString(36).slice(2) + Date.now().toString(36);
    SS.set("xf.g.state", st);
    const p = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: redirectUri, response_type: "token", scope: SCOPES, include_granted_scopes: "true", state: st });
    const hint = LS.get("xf.g.email");
    if (hint) p.set("login_hint", hint);
    p.set("prompt", interactive ? (hint ? "consent" : "select_account consent") : "none");
    location.assign("https://accounts.google.com/o/oauth2/v2/auth?" + p.toString());
    return new Promise(() => {});
  }
  function canSilent() {
    if (LS.get("xf.g.ok") !== "1") return false;
    const f = parseInt(SS.get("xf.g.silentFail") || "0", 10);
    return !f || Date.now() - f > 5 * 60000;
  }
  function renew() { if (canSilent()) return signIn(false); showGate(); return new Promise(() => {}); }

  function showGate() {
    if (document.getElementById("xfGate")) return;
    const g = document.createElement("div");
    g.id = "xfGate";
    g.setAttribute("role", "dialog");
    g.setAttribute("aria-label", "Inicia la sessió");
    g.innerHTML = '<div class="xg-card"><img src="icon-192.png" alt="" width="88" height="88"><h1>Xavier\'s family</h1>' +
      '<p>Entra amb el compte de Google que té accés al calendari i a les fotos de la família.</p>' +
      '<button type="button" class="btn primary" id="xfGateBtn">Entra amb Google</button>' +
      '<p class="xg-small">El primer cop Google pot dir «Google no ha verificat aquesta app». Prem «Avançat» i després «Continua».</p></div>';
    const css = document.createElement("style");
    css.textContent = '#xfGate{position:fixed;inset:0;z-index:9999;background:var(--bg);display:grid;place-items:center;padding:24px 16px;}' +
      '#xfGate .xg-card{max-width:380px;text-align:center;}#xfGate img{border-radius:22px;box-shadow:0 10px 30px -10px rgba(0,0,0,.35);}' +
      '#xfGate h1{font-family:var(--font-display);font-size:1.8rem;margin:18px 0 8px;color:var(--fg);}#xfGate p{color:var(--muted);line-height:1.45;margin:0 0 20px;}' +
      '#xfGate .btn{font-size:1.05rem;padding:14px 22px;}#xfGate .xg-small{font-size:.85rem;margin-top:22px;}';
    document.head.append(css);
    document.body.append(g);
    document.getElementById("xfGateBtn").onclick = () => signIn(true);
  }

  let tokenWait = null;
  function getToken() {
    if (token && (loadToken() === token)) return Promise.resolve(token);
    token = loadToken();
    if (token) return Promise.resolve(token);
    if (!CLIENT_ID) { showGate(); return new Promise(() => {}); }
    if (!tokenWait) tokenWait = renew();
    return tokenWait;
  }
  // Renova en tornar a l'app si el permís ha caducat
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && LS.get("xf.g.ok") === "1" && !loadToken() && !document.querySelector(".sheet:not([hidden])")) renew();
  });

  function err(code, msg, extra) { return Object.assign(new Error(msg || code), { code }, extra || {}); }
  async function gfetch(url, opts, raw) {
    const t = await getToken();
    let res;
    try {
      res = await fetch(url, { ...(opts || {}), headers: { ...((opts && opts.headers) || {}), Authorization: "Bearer " + t } });
    } catch (e) { throw err("upstream_error", "network", { retryable: true, retryAfterMs: 5000 }); }
    if (res.status === 401) { LS.del("xf.g.tok"); token = null; renew(); throw err("needs_reauth"); }
    if (!res.ok) {
      let reason = ""; try { const j = await res.json(); reason = (j.error && (j.error.status || (j.error.errors && j.error.errors[0] && j.error.errors[0].reason))) || ""; } catch (e) {}
      if (res.status === 429 || res.status >= 500 || reason === "rateLimitExceeded" || reason === "userRateLimitExceeded") throw err("upstream_error", reason, { retryable: true, retryAfterMs: 8000 });
      throw err("tool_error", res.status + " " + reason);
    }
    if (raw) return res;
    if (res.status === 204) return null;
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  }

  // userinfo (per al login_hint)
  if (token && !LS.get("xf.g.email")) gfetch("https://openidconnect.googleapis.com/v1/userinfo").then(u => { if (u && u.email) LS.set("xf.g.email", u.email); }).catch(() => {});

  // ---------- Calendar ----------
  const CAL = "https://www.googleapis.com/calendar/v3/calendars/";
  function madridOffset(naive) {
    // "YYYY-MM-DDTHH:MM:SS" (hora de Madrid) -> amb el desplaçament correcte
    const d = new Date(naive + "Z");
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", timeZoneName: "shortOffset" }).formatToParts(d);
    const tz = (parts.find(p => p.type === "timeZoneName") || {}).value || "GMT+1";
    const m = /GMT([+-])(\d+)(?::(\d+))?/.exec(tz);
    const off = m ? m[1] + String(m[2]).padStart(2, "0") + ":" + String(m[3] || "00").padStart(2, "0") : "+01:00";
    return naive + off;
  }
  function evBody(i) {
    const b = {};
    if ("summary" in i) b.summary = i.summary;
    if ("description" in i) b.description = i.description;
    if (i.colorId) b.colorId = i.colorId;
    if (i.startTime) {
      if (i.allDay) { b.start = { date: i.startTime.slice(0, 10) }; b.end = { date: (i.endTime || i.startTime).slice(0, 10) }; }
      else { b.start = { dateTime: i.startTime, timeZone: i.timeZone || "Europe/Madrid" }; b.end = { dateTime: i.endTime, timeZone: i.timeZone || "Europe/Madrid" }; }
    }
    return b;
  }
  const calTools = {
    async list_events(i) {
      let out = [], pageToken = "";
      for (let n = 0; n < 10; n++) {
        const q = new URLSearchParams({ timeMin: madridOffset(i.startTime), timeMax: madridOffset(i.endTime), singleEvents: "true", orderBy: "startTime", maxResults: "2500", timeZone: i.timeZone || "Europe/Madrid" });
        if (pageToken) q.set("pageToken", pageToken);
        const r = await gfetch(CAL + encodeURIComponent(i.calendarId) + "/events?" + q);
        out = out.concat((r && r.items) || []);
        pageToken = r && r.nextPageToken; if (!pageToken) break;
      }
      return { payload: { events: out } };
    },
    async create_event(i) {
      const r = await gfetch(CAL + encodeURIComponent(i.calendarId) + "/events?sendUpdates=none", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(evBody(i)) });
      return { payload: r };
    },
    async update_event(i) {
      const b = evBody(i);
      if (i.startTime && i.allDay) { b.start.dateTime = null; b.end.dateTime = null; }
      if (i.startTime && !i.allDay) { b.start.date = null; b.end.date = null; }
      const r = await gfetch(CAL + encodeURIComponent(i.calendarId) + "/events/" + encodeURIComponent(i.eventId) + "?sendUpdates=none", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
      return { payload: r };
    },
    async delete_event(i) {
      await gfetch(CAL + encodeURIComponent(i.calendarId) + "/events/" + encodeURIComponent(i.eventId) + "?sendUpdates=none", { method: "DELETE" });
      return { payload: { ok: true } };
    }
  };

  // ---------- Drive ----------
  const DRV = "https://www.googleapis.com/drive/v3/files";
  const FIELDS = "id,name,mimeType,parents,createdTime,modifiedTime,webViewLink,trashed";
  function fileOut(f) { return f && { id: f.id, title: f.name, mimeType: f.mimeType, parentId: (f.parents && f.parents[0]) || "", createdTime: f.createdTime, modifiedTime: f.modifiedTime, viewUrl: f.webViewLink, trashed: !!f.trashed }; }
  function b64ToBlob(b64, type) { const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type }); }
  const driveTools = {
    async search_files(i) {
      const q = new URLSearchParams({ q: i.query, pageSize: String(Math.min(1000, i.pageSize || 200)), fields: "nextPageToken,files(" + FIELDS + ")", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
      if (i.pageToken) q.set("pageToken", i.pageToken);
      const r = await gfetch(DRV + "?" + q);
      return { payload: { files: ((r && r.files) || []).map(fileOut), nextPageToken: (r && r.nextPageToken) || "" } };
    },
    async download_file_content(i) {
      const res = await gfetch(DRV + "/" + encodeURIComponent(i.fileId) + "?alt=media&supportsAllDrives=true", {}, true);
      return { blob: await res.blob(), payload: {} };
    },
    async create_file(i) {
      const meta = { name: i.title, mimeType: i.contentMimeType, parents: i.parentId ? [i.parentId] : undefined };
      if (i.contentMimeType === "application/vnd.google-apps.folder" || i.base64Content == null) {
        const r = await gfetch(DRV + "?supportsAllDrives=true&fields=" + FIELDS, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(meta) });
        return { payload: fileOut(r) };
      }
      let blob = i.base64Content;
      if (blob && blob.$file) blob = blob.$file.data;
      else if (typeof blob === "string") blob = b64ToBlob(blob, i.contentMimeType);
      const boundary = "xf" + Math.random().toString(36).slice(2);
      const body = new Blob(["--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) + "\r\n--" + boundary + "\r\nContent-Type: " + (i.contentMimeType || blob.type || "application/octet-stream") + "\r\n\r\n", blob, "\r\n--" + boundary + "--"]);
      const r = await gfetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=" + FIELDS, { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + boundary }, body });
      return { payload: fileOut(r) };
    },
    async trash_file(i) {
      const r = await gfetch(DRV + "/" + encodeURIComponent(i.fileId) + "?supportsAllDrives=true", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) });
      return { payload: r };
    }
  };

  // ---------- mcp ----------
  const servers = { "Google Calendar": calTools, "Google Drive": driveTools };
  const watchers = new Set();
  const mcp = {
    async callTool(server, tool, input) {
      const s = servers[server]; const fn = s && s[tool];
      if (!fn) throw err("not_in_manifest");
      return fn(input || {});
    },
    async listTools() { return { fileArgs: true }; },
    async invalidate(server, tool) {
      for (const w of watchers) if (w.server === server && w.tool === tool) setTimeout(w.run, 1500);
    },
    watchTool(server, tool, input, cb, opts) {
      const w = { server, tool, busy: false };
      w.run = async () => {
        if (w.busy) return; w.busy = true;
        try { cb({ type: "data", result: await mcp.callTool(server, tool, input) }); }
        catch (e) { cb({ type: "error", error: e }); }
        w.busy = false;
      };
      const ms = (opts && opts.refetchInterval) || 60000;
      const iv = setInterval(() => { if (document.visibilityState === "visible") w.run(); }, ms);
      const onVis = () => { if (document.visibilityState === "visible") w.run(); };
      document.addEventListener("visibilitychange", onVis);
      watchers.add(w);
      return () => { clearInterval(iv); document.removeEventListener("visibilitychange", onVis); watchers.delete(w); };
    }
  };

  // ---------- db sobre un full de càlcul del Drive ----------
  const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets/";
  let sheetId = CFG.sheetId || LS.get("xf.sheetId") || "";
  async function ensureSheet() {
    if (sheetId) return sheetId;
    const q = "name = '" + SHEET_TITLE.replace(/'/g, "\\'") + "' and '" + FOLDER_ID + "' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false";
    const r = await gfetch(DRV + "?" + new URLSearchParams({ q, fields: "files(id)", supportsAllDrives: "true", includeItemsFromAllDrives: "true" }));
    if (r && r.files && r.files[0]) sheetId = r.files[0].id;
    else {
      const c = await gfetch(DRV + "?supportsAllDrives=true&fields=id", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: SHEET_TITLE, mimeType: "application/vnd.google-apps.spreadsheet", parents: [FOLDER_ID] }) });
      sheetId = c.id;
      await gfetch(SHEETS + sheetId + "/values/A1:D1?valueInputOption=RAW", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: [["col", "id", "dades", "actualitzat"]] }) });
    }
    LS.set("xf.sheetId", sheetId);
    return sheetId;
  }
  const store = { rows: new Map(), loaded: false };   // "col/id" -> { r, data }
  const listeners = new Set();
  function snapFor(l) {
    if (l.kind === "col") {
      const docs = [];
      for (const [k, v] of store.rows) { const i = k.indexOf("/"); if (k.slice(0, i) === l.col) docs.push({ id: k.slice(i + 1), data: () => JSON.parse(JSON.stringify(v.data)) }); }
      return { docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false } };
    }
    const v = store.rows.get(l.path);
    return { id: l.path.split("/")[1], exists: !!v, data: () => (v ? JSON.parse(JSON.stringify(v.data)) : undefined), metadata: { fromCache: false } };
  }
  function notify() { for (const l of listeners) { try { l.cb(snapFor(l)); } catch (e) { console.error(e); } } }
  let loading = null;
  function load() {
    if (loading) return loading;
    loading = (async () => {
      const id = await ensureSheet();
      const r = await gfetch(SHEETS + id + "/values/A2:D20000?majorDimension=ROWS");
      const rows = new Map();
      ((r && r.values) || []).forEach((v, i) => {
        if (!v || !v[0] || !v[1] || !v[2]) return;
        try { rows.set(v[0] + "/" + v[1], { r: i + 2, data: JSON.parse(v[2]) }); } catch (e) {}
      });
      store.rows = rows; store.loaded = true; notify();
    })().finally(() => { loading = null; });
    return loading;
  }
  let queue = Promise.resolve();
  function enqueue(fn) { const p = queue.then(fn); queue = p.catch(() => {}); return p; }
  async function writeRow(key, data) {
    const id = await ensureSheet();
    const [col, did] = key.split("/");
    const row = [col, did, JSON.stringify(data), new Date().toISOString()];
    const cur = store.rows.get(key);
    if (cur) {
      await gfetch(SHEETS + id + "/values/A" + cur.r + ":D" + cur.r + "?valueInputOption=RAW", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: [row] }) });
      cur.data = data;
    } else {
      const r = await gfetch(SHEETS + id + "/values/A1:D1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: [row] }) });
      const m = /![A-Z]+(\d+)/.exec((r && r.updates && r.updates.updatedRange) || "");
      store.rows.set(key, { r: m ? +m[1] : 0, data });
    }
    notify();
  }
  function clean(o) { return JSON.parse(JSON.stringify(o === undefined ? {} : o)); }
  function docRef(col, did) {
    const key = col + "/" + did;
    return {
      id: did,
      set(data) { return enqueue(async () => { await load(); await writeRow(key, clean(data)); }); },
      update(patch) { return enqueue(async () => { await load(); const cur = store.rows.get(key); await writeRow(key, { ...(cur ? cur.data : {}), ...clean(patch) }); }); },
      delete() {
        return enqueue(async () => {
          await load(); const cur = store.rows.get(key); if (!cur) return;
          const id = await ensureSheet();
          await gfetch(SHEETS + id + "/values/A" + cur.r + ":D" + cur.r + ":clear", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
          store.rows.delete(key); notify();
        });
      },
      async get() { await load(); return snapFor({ kind: "doc", path: key }); },
      onSnapshot(cb) { return listen({ kind: "doc", path: key, cb }); }
    };
  }
  function newId() { const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"; let s = ""; const r = crypto.getRandomValues(new Uint8Array(20)); for (const x of r) s += a[x % a.length]; return s; }
  let pollStarted = false;
  function listen(l) {
    listeners.add(l);
    if (store.loaded) setTimeout(() => l.cb(snapFor(l)), 0);
    if (!pollStarted) {
      pollStarted = true;
      const tick = () => { if (document.visibilityState === "visible") load().catch(retryLater); };
      const retryLater = () => setTimeout(tick, 8000);
      tick();
      setInterval(tick, 20000);
      document.addEventListener("visibilitychange", tick);
    }
    return () => listeners.delete(l);
  }
  const db = {
    collection(col) { return { doc(id) { return docRef(col, id || newId()); }, onSnapshot(cb) { return listen({ kind: "col", col, cb }); } }; },
    doc(path) { const [c, d] = path.split("/"); return docRef(c, d); }
  };

  const user = { async can() { return true; } };

  window.claude = {
    async use(name) {
      await getToken();
      if (name === "mcp") return mcp;
      if (name === "db") return db;
      if (name === "user") return user;
      return null;
    }
  };
  window.XF = { signOut() { LS.del("xf.g.tok"); LS.del("xf.g.ok"); LS.del("xf.g.email"); location.reload(); }, signIn: () => signIn(true) };

  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
