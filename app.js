/* plasmastrike-frontend/app.js
 *
 * CLICK-PROOF version for your provided index.html
 * - Renders into #devicesGrid
 * - Click device card -> loads /api/devices/:mac and shows details
 * - Tab switching works
 * - Does NOT rely on .hidden class (uses style.display)
 * - Forces pointer-events:auto on critical containers (helps if CSS blocks clicks)
 * - Uses event delegation for device card clicks
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

    tabs: $$(".tab"),
    panels: $$(".tabpanel"),
  };

  // ---------- safety: confirm DOM ----------
  function assertEl(name, node) {
    if (!node) console.error(`[app.js] Missing element: ${name}`);
  }
  assertEl("#devicesGrid", el.devicesGrid);
  assertEl("#deviceDetails", el.deviceDetails);
  assertEl("#detailsBody", el.detailsBody);

  // ---------- force-clickability (helps if CSS has pointer-events:none somewhere) ----------
  function forcePointerEvents() {
    // Make sure the main interactive areas accept clicks
    const targets = [
      document.body,
      el.devicesGrid,
      el.deviceDetails,
      $(".tabs"),
      $(".container"),
    ].filter(Boolean);

    targets.forEach((t) => {
      try {
        t.style.pointerEvents = "auto";
      } catch {}
    });

    // If some overlay is accidentally on top, this won’t remove it,
    // but it fixes the common “pointer-events: none” parent bug.
  }

  // ---------- API ----------
  function getBackendBase() {
    // Default is same-origin /api (Cloudflare worker route)
    return "";
  }

  function apiPath(path) {
    const base = getBackendBase();
    return base ? `${base}${path}` : path;
  }

  async function apiGet(path) {
    const url = apiPath(path);
    const res = await fetch(url, {
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

  // ---------- helpers ----------
  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safeJson(obj) {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  }

  function fmtTime(value) {
    if (!value) return "—";
    const d = typeof value === "number"
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

  // ---------- tabs (no CSS dependency) ----------
  function setActiveTab(tabName) {
    el.tabs.forEach((b) => b.classList.toggle("active", b.dataset.tab === tabName));

    el.panels.forEach((p) => {
      const on = p.id === `tab-${tabName}`;
      p.classList.toggle("active", on);
      // HARD display control so it works even if CSS is missing/broken
      p.style.display = on ? "block" : "none";
    });
  }

  function wireTabs() {
    el.tabs.forEach((btn) => {
      btn.addEventListener("click", () => {
        setActiveTab(btn.dataset.tab);
      });
    });
  }

  // ---------- details panel (no .hidden dependency) ----------
  function showDetails() {
    if (!el.deviceDetails) return;
    el.deviceDetails.style.display = "block";
  }

  function hideDetails() {
    if (!el.deviceDetails) return;
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

  // ---------- sensors: support both formats ----------
  function prettifySensorId(id) {
    return String(id || "")
      .replace(/^sensor-/, "")
      .replaceAll("-", " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function normalizeSensors(device) {
    const s = device?.sensors;

    // Array format
    if (Array.isArray(s)) {
      return s.map((x) => ({
        id: x.id,
        label: prettifySensorId(x.id),
        value: x.value,
        voltage: x.voltage,
        status: (x.status || "normal").toLowerCase(),
        unit: String(x.id || "").includes("temp") ? "°C" : "PSI",
      }));
    }

    // Object format
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
          status: "normal",
          unit: m.unit,
        });
      }
      return out;
    }

    return [];
  }

  function normalizeFloats(device) {
    const top = device?.floatTop;
    const bottom = device?.floatBottom;

    const toNum = (x) =>
      x === true ? 1 : x === false ? 0 : (typeof x === "number" ? x : null);

    return { top: toNum(top), bottom: toNum(bottom) };
  }

  function renderDetailsHtml(mac, device) {
    const isOnline = device?.isOnline ?? false;
    const lastSeen = device?.lastSeen ?? null;
    const machineMode = device?.machineMode ?? "—";
    const pumpMode = device?.pumpMode ?? "—";
    const faultActive = device?.faultActive ?? false;
    const faultMessage = device?.faultMessage ?? "";

    const sensors = normalizeSensors(device);
    const floats = normalizeFloats(device);

    if (floats.top !== null) sensors.push({ id: "float-top", label: "Float Top", value: floats.top, isBool: true });
    if (floats.bottom !== null) sensors.push({ id: "float-bottom", label: "Float Bottom", value: floats.bottom, isBool: true });

    const header = `
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
    `;

    const cards = sensors.length ? `
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap:12px;">
        ${sensors.map((s) => {
          const isBool = !!s.isBool || String(s.id).includes("float");
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
              <div style="margin-top:8px; font-size:12px; opacity:.7;">ID: ${escapeHtml(s.id)}</div>
            </div>
          `;
        }).join("")}
      </div>
    ` : `<div style="opacity:.8; font-size:13px;">No sensors returned.</div>`;

    const raw = `
      <div style="margin-top:16px; font-size:12px; opacity:.7;">Raw JSON:</div>
      <pre style="padding:12px; background:rgba(0,0,0,.06); border-radius:8px; overflow:auto; max-height:35vh;">${escapeHtml(safeJson(device))}</pre>
    `;

    return header + cards + raw;
  }

  function setDetailsDevice(mac, device) {
    showDetails();
    if (el.detailsTitle) el.detailsTitle.textContent = mac;

    // #detailsBody is a <pre> but we can still set innerHTML safely
    if (el.detailsBody) {
      el.detailsBody.innerHTML = renderDetailsHtml(mac, device);
    }
  }

  // ---------- device list rendering ----------
  function macFromDevice(d) {
    return d?.mac || d?.macAddress || d?.id || d?.deviceMac || null;
  }

  function renderDevices(devices) {
    if (!el.devicesGrid) return;

    el.devicesGrid.innerHTML = "";

    // HARD show/hide empty label with display (ignore .hidden CSS)
    if (el.devicesEmpty) el.devicesEmpty.style.display = devices.length ? "none" : "block";

    devices.forEach((d) => {
      const mac = macFromDevice(d) || "UNKNOWN";
      const isOnline = d?.isOnline ?? false;
      const lastSeen = d?.lastSeen ?? null;

      const card = document.createElement("div");
      card.className = "device-card";
      card.dataset.mac = mac;

      // Force clickable in case CSS disables it
      card.style.pointerEvents = "auto";
      card.style.cursor = "pointer";

      card.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="width:10px; height:10px; border-radius:99px; background:${isOnline ? "#1bbf6a" : "#999"};"></div>
          <div style="font-weight:900;">MAC: ${escapeHtml(mac)}</div>
        </div>
        <div style="margin-top:6px; font-size:12px; opacity:.88;">
          <div>Last seen: <b>${escapeHtml(fmtTime(lastSeen))}</b></div>
        </div>
      `;

      el.devicesGrid.appendChild(card);
    });

    if (el.deviceCount) el.deviceCount.textContent = String(devices.length);
  }

  // ---------- event delegation for card clicks ----------
  function wireDeviceClicks() {
    if (!el.devicesGrid) return;

    el.devicesGrid.addEventListener("click", async (evt) => {
      const card = evt.target?.closest?.(".device-card");
      if (!card) return;

      const mac = card.dataset.mac;
      if (!mac) return;

      setDetailsLoading(mac);

      try {
        const device = await apiGet(`/api/devices/${encodeURIComponent(mac)}`);
        setDetailsDevice(mac, device);
      } catch (err) {
        setDetailsError(mac, err);
      }
    }, true); // capture=true can help if something stops bubbling
  }

  // ---------- load loop ----------
  let lastRefreshAt = Date.now();
  let refreshAgeTimer = null;

  function startRefreshAge() {
    if (!el.refreshAge) return;
    if (refreshAgeTimer) clearInterval(refreshAgeTimer);

    refreshAgeTimer = setInterval(() => {
      el.refreshAge.textContent = String(Math.floor((Date.now() - lastRefreshAt) / 1000));
    }, 500);
  }

  async function loadDevices() {
    try {
      if (el.backendBadge) el.backendBadge.textContent = "API: …";

      const payload = await apiGet("/api/devices");
      const devices = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.devices)
          ? payload.devices
          : [];

      if (el.backendBadge) el.backendBadge.textContent = "API: OK";

      renderDevices(devices);
      lastRefreshAt = Date.now();
    } catch (err) {
      console.error(err);
      if (el.backendBadge) el.backendBadge.textContent = "API: ERROR";
      if (el.devicesGrid) {
        el.devicesGrid.innerHTML = `<div style="color:#b00020;">Failed to load devices: ${escapeHtml(String(err?.message || err))}</div>`;
      }
      if (el.deviceCount) el.deviceCount.textContent = "—";
    }
  }

  // ---------- boot ----------
  function wireControls() {
    if (el.btnCloseDetails) el.btnCloseDetails.addEventListener("click", hideDetails);
    if (el.btnRefreshNow) el.btnRefreshNow.addEventListener("click", loadDevices);
  }

  async function boot() {
    forcePointerEvents();
    wireTabs();
    wireControls();
    wireDeviceClicks();
    startRefreshAge();

    // Default: show devices tab
    setActiveTab("devices");

    // Default: hide details panel
    hideDetails();

    await loadDevices();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
