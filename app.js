/* plasmastrike-frontend/app.js
 *
 * BULLETPROOF CLICK ROUTING
 * Some global script/CSS is preventing document-level click handlers.
 * This version listens at WINDOW capture and routes clicks manually.
 *
 * Matches your index.html structure:
 * - cards are <div class="card"> inside #devicesGrid
 * - details panel: #deviceDetails, #detailsTitle, #detailsBody, #btnCloseDetails
 * - tabs: .tab buttons with data-tab
 * - panels: .tabpanel sections with ids tab-devices/tab-logs/tab-calibration/tab-settings
 */

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const el = {
    backendBadge: $("#backendBadge"),
    deviceCount: $("#deviceCount"),
    refreshAge: $("#refreshAge"),

    devicesGrid: $("#devicesGrid"),
    devicesEmpty: $("#devicesEmpty"),

    deviceDetails: $("#deviceDetails"),
    detailsTitle: $("#detailsTitle"),
    detailsBody: $("#detailsBody"),
    btnCloseDetails: $("#btnCloseDetails"),

    btnRefreshNow: $("#btnRefreshNow"),
    refreshSeconds: $("#refreshSeconds"),

    tabs: $$(".tab"),
    panels: $$(".tabpanel"),
  };

  // -------- helpers --------
  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safeJson(obj) {
    try { return JSON.stringify(obj, null, 2); }
    catch { return String(obj); }
  }

  function fmtTime(value) {
    if (!value) return "—";
    const d =
      typeof value === "number"
        ? new Date(value > 1e12 ? value : value * 1000)
        : new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleString();
  }

  function formatNumber(v, decimals = 2) {
    if (v === null || v === undefined) return "—";
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) return n.toFixed(decimals);
    return String(v);
  }

  // -------- API (same-origin /api via Cloudflare Worker) --------
  async function apiGet(path) {
    const res = await fetch(path, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    const ct = res.headers.get("content-type") || "";
    let body = null;
    if (ct.includes("application/json")) body = await res.json().catch(() => null);
    else body = await res.text().catch(() => null);

    if (!res.ok) {
      const msg =
        (body && body.error) ||
        (typeof body === "string" && body) ||
        `${res.status} ${res.statusText}`;
      throw new Error(msg);
    }
    return body;
  }

  // -------- Tabs --------
  function setActiveTab(name) {
    el.tabs.forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    el.panels.forEach((p) => {
      const on = p.id === `tab-${name}`;
      p.classList.toggle("active", on);
      p.style.display = on ? "block" : "none";
    });
  }

  // -------- Details panel --------
  function showDetails() {
    if (!el.deviceDetails) return;
    el.deviceDetails.classList.remove("hidden");
    el.deviceDetails.style.display = "block";
  }

  function hideDetails() {
    if (!el.deviceDetails) return;
    el.deviceDetails.classList.add("hidden");
    el.deviceDetails.style.display = "none";
    if (el.detailsTitle) el.detailsTitle.textContent = "Device";
    if (el.detailsBody) el.detailsBody.textContent = "Click a device…";
  }

  function setDetailsLoading(mac) {
    showDetails();
    if (el.detailsTitle) el.detailsTitle.textContent = mac;
    if (el.detailsBody) el.detailsBody.textContent = `Loading ${mac}…`;
  }

  function setDetailsError(mac, err) {
    showDetails();
    if (el.detailsTitle) el.detailsTitle.textContent = mac;
    if (el.detailsBody) el.detailsBody.textContent = `ERROR: ${String(err?.message || err)}`;
  }

  // -------- Sensors (supports both formats) --------
  function prettifySensorId(id) {
    return String(id || "")
      .replace(/^sensor-/, "")
      .replaceAll("-", " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function normalizeSensors(device) {
    const s = device?.sensors;

    if (Array.isArray(s)) {
      return s.map((x) => ({
        id: x.id,
        label: prettifySensorId(x.id),
        value: x.value,
        voltage: x.voltage,
        unit: String(x.id || "").includes("temp") ? "°C" : "PSI",
        isBool: String(x.id || "").includes("float"),
      }));
    }

    if (s && typeof s === "object") {
      const out = [];
      const map = [
        { id: "sensor-inlet",  label: "Inlet",  v: "inletPSI",  vv: "inletV",  unit: "PSI" },
        { id: "sensor-ro",     label: "RO",     v: "roPSI",     vv: "roV",     unit: "PSI" },
        { id: "sensor-filter", label: "Filter", v: "filterPSI", vv: "filterV", unit: "PSI" },
        { id: "sensor-air",    label: "Air",    v: "airPSI",    vv: "airV",    unit: "PSI" },
        { id: "sensor-temp",   label: "Temp",   v: "tempC",     vv: null,      unit: "°C"  },
      ];
      for (const m of map) {
        if (s[m.v] === undefined || s[m.v] === null) continue;
        out.push({
          id: m.id,
          label: m.label,
          value: s[m.v],
          voltage: m.vv ? s[m.vv] : undefined,
          unit: m.unit,
          isBool: false,
        });
      }
      return out;
    }

    return [];
  }

  function normalizeFloats(device) {
    const toNum = (x) =>
      x === true ? 1 : x === false ? 0 : typeof x === "number" ? x : null;
    return { top: toNum(device?.floatTop), bottom: toNum(device?.floatBottom) };
  }

  function renderDetailsHtml(mac, device) {
    const isOnline = device?.isOnline ?? false;
    const lastSeen = device?.lastSeen ?? null;
    const machineMode = device?.machineMode ?? "—";
    const pumpMode = device?.pumpMode ?? "—";
    const faultActive = device?.faultActive ?? false;
    const faultMessage = device?.faultMessage ?? "";

    let sensors = normalizeSensors(device);
    const floats = normalizeFloats(device);

    if (floats.top !== null) sensors.push({ id: "float-top", label: "Float Top", value: floats.top, isBool: true });
    if (floats.bottom !== null) sensors.push({ id: "float-bottom", label: "Float Bottom", value: floats.bottom, isBool: true });

    const cards = sensors.length ? `
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap:12px;">
        ${sensors.map((s) => {
          const isBool = !!s.isBool;
          const val = isBool ? (Number(s.value) === 1 ? "CLOSED" : "OPEN") : formatNumber(s.value, 2);
          const unit = isBool ? "" : (s.unit || "");
          return `
            <div style="padding:14px; border-radius:14px; background:rgba(0,0,0,.05);">
              <div style="font-weight:800; margin-bottom:8px;">${escapeHtml(s.label)}</div>
              <div style="font-size:44px; font-weight:900; line-height:1;">
                ${escapeHtml(String(val))}
                ${unit ? `<span style="font-size:16px; font-weight:800; opacity:.75;"> ${escapeHtml(unit)}</span>` : ""}
              </div>
              ${s.voltage !== undefined && !isBool ? `
                <div style="margin-top:10px; font-size:18px; font-weight:800; opacity:.85;">
                  ${formatNumber(Number(s.voltage), 4)} V
                </div>
              ` : ""}
              <div style="margin-top:8px; font-size:12px; opacity:.7;">ID: ${escapeHtml(s.id || "")}</div>
            </div>
          `;
        }).join("")}
      </div>
    ` : `<div style="opacity:.8; font-size:13px;">No sensors returned.</div>`;

    return `
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
        <div style="width:10px; height:10px; border-radius:99px; background:${isOnline ? "#1bbf6a" : "#999"};"></div>
        <div style="font-size:16px; font-weight:900;">${escapeHtml(mac)}</div>
        <div style="margin-left:auto; font-size:12px; opacity:.8;">
          Last seen: ${escapeHtml(fmtTime(lastSeen))}
        </div>
      </div>

      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px;">
        <div style="padding:6px 10px; border-radius:999px; background:rgba(0,0,0,.06); font-size:12px;">
          Machine: <b>${escapeHtml(String(machineMode))}</b>
        </div>
        <div style="padding:6px 10px; border-radius:999px; background:rgba(0,0,0,.06); font-size:12px;">
          Pump: <b>${escapeHtml(String(pumpMode))}</b>
        </div>
      </div>

      ${faultActive ? `
        <div style="padding:10px 12px; border-radius:12px; background:rgba(176,0,32,.08); color:#b00020; margin-bottom:14px;">
          <b>FAULT:</b> ${escapeHtml(faultMessage || "Active")}
        </div>
      ` : ""}

      ${cards}

      <div style="margin-top:16px; font-size:12px; opacity:.7;">Raw JSON:</div>
      <pre style="padding:12px; background:rgba(0,0,0,.06); border-radius:8px; overflow:auto; max-height:35vh;">${escapeHtml(safeJson(device))}</pre>
    `;
  }

  function setDetailsDevice(mac, device) {
    showDetails();
    if (el.detailsTitle) el.detailsTitle.textContent = mac;
    if (el.detailsBody) el.detailsBody.innerHTML = renderDetailsHtml(mac, device);
  }

  // -------- Render device cards as .card (your DOM uses .card) --------
  function macFromDevice(d) {
    return d?.mac || d?.macAddress || d?.id || d?.deviceMac || null;
  }

  function renderDevices(devices) {
    if (!el.devicesGrid) return;
    el.devicesGrid.innerHTML = "";

    if (el.devicesEmpty) el.devicesEmpty.style.display = devices.length ? "none" : "block";
    if (el.deviceCount) el.deviceCount.textContent = String(devices.length);

    devices.forEach((d) => {
      const mac = macFromDevice(d) || "UNKNOWN";
      const isOnline = d?.isOnline ?? false;
      const lastSeen = d?.lastSeen ?? null;

      const card = document.createElement("div");
      card.className = "card";
      card.dataset.mac = mac;
      card.style.cursor = "pointer";

      card.innerHTML = `
        <div><b>Status:</b> ${isOnline ? "🟢 Online" : "⚪ Offline"}</div>
        <div><b>MAC:</b> ${escapeHtml(mac)}</div>
        <div><b>Last seen:</b> ${escapeHtml(String(lastSeen || "—"))}</div>
      `;

      el.devicesGrid.appendChild(card);
    });
  }

  // -------- Refresh age / timers --------
  let lastRefreshAt = Date.now();
  let refreshAgeTimer = null;
  let refreshTimer = null;

  function startRefreshAge() {
    if (!el.refreshAge) return;
    if (refreshAgeTimer) clearInterval(refreshAgeTimer);
    refreshAgeTimer = setInterval(() => {
      el.refreshAge.textContent = String(Math.floor((Date.now() - lastRefreshAt) / 1000));
    }, 500);
  }

  function setBackendBadge(text) {
    if (el.backendBadge) el.backendBadge.textContent = text;
  }

  async function loadDevices() {
    try {
      setBackendBadge("API: …");
      const payload = await apiGet("/api/devices");
      const devices = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.devices)
          ? payload.devices
          : [];
      setBackendBadge("API: OK");
      renderDevices(devices);
      lastRefreshAt = Date.now();
    } catch (err) {
      console.error(err);
      setBackendBadge("API: ERROR");
      if (el.devicesGrid) el.devicesGrid.innerHTML = `<div style="color:#b00020;">Load failed: ${escapeHtml(String(err?.message || err))}</div>`;
    }
  }

  function getRefreshSeconds() {
    const n = Number(el.refreshSeconds?.value);
    return Number.isFinite(n) && n >= 2 && n <= 60 ? n : 5;
  }

  function scheduleAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(loadDevices, getRefreshSeconds() * 1000);
  }

  // ==========================================================
  //  THE KEY: WINDOW CAPTURE CLICK ROUTER
  // ==========================================================
  function windowClickRouter(e) {
    const t = e.target;

    // Close details button
    if (t && (t.id === "btnCloseDetails" || t.closest?.("#btnCloseDetails"))) {
      hideDetails();
      return;
    }

    // Refresh now button
    if (t && (t.id === "btnRefreshNow" || t.closest?.("#btnRefreshNow"))) {
      loadDevices();
      return;
    }

    // Tab buttons
    const tabBtn = t?.closest?.(".tab");
    if (tabBtn && tabBtn.dataset?.tab) {
      setActiveTab(tabBtn.dataset.tab);
      return;
    }

    // Device cards (.card inside #devicesGrid)
    const card = t?.closest?.("#devicesGrid .card");
    if (card && card.dataset?.mac) {
      const mac = card.dataset.mac;
      setDetailsLoading(mac);
      apiGet(`/api/devices/${encodeURIComponent(mac)}`)
        .then((device) => setDetailsDevice(mac, device))
        .catch((err) => setDetailsError(mac, err));
      return;
    }
  }

  // -------- Boot --------
  async function boot() {
    // Default tab
    setActiveTab("devices");

    // Hide details initially
    hideDetails();

    // Wire window capture router (above document)
    window.addEventListener("click", windowClickRouter, true);

    // Also wire change for refresh seconds
    if (el.refreshSeconds) el.refreshSeconds.addEventListener("change", scheduleAutoRefresh);

    startRefreshAge();
    await loadDevices();
    scheduleAutoRefresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
