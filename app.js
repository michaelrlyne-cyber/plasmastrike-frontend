/* plasmastrike-frontend/app.js
 *
 * Works with your provided index.html:
 * - Renders device cards into #devicesGrid
 * - Click card -> GET /api/devices/:mac
 * - Opens #deviceDetails panel (removes .hidden)
 * - Fills #detailsTitle and #detailsBody
 * - Close button hides details panel
 * - Updates #backendBadge, #deviceCount, #refreshAge
 * - Simple tab switching via .tab buttons
 *
 * Sensor display:
 * - Shows "classic" sensor cards in details (Inlet/RO/Filter/Air/Temp + floats)
 * - Handles BOTH sensor formats:
 *   A) sensors: { inletPSI, inletV, roPSI, roV, ... }
 *   B) sensors: [ {id,value,voltage,status}, ... ]
 * - Also includes Raw JSON at bottom for debugging
 */

(() => {
  // -------------------- DOM helpers --------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // Required elements from your index.html
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
    backendUrlInput: $("#backendUrlInput"),
    btnSaveBackendUrl: $("#btnSaveBackendUrl"),

    psiSmoothingEnabled: $("#psiSmoothingEnabled"),
    psiSmoothingWindow: $("#psiSmoothingWindow"),

    // Tabs
    tabs: $$(".tab"),
    tabPanels: $$(".tabpanel"),
  };

  // -------------------- Settings --------------------
  const LS = {
    backendUrl: "ps_backendUrl",
    refreshSeconds: "ps_refreshSeconds",
    psiSmoothOn: "ps_psiSmoothOn",
    psiSmoothWindow: "ps_psiSmoothWindow",
  };

  function getBackendBase() {
    // We use same-origin /api/* by default (Cloudflare Worker routes it)
    // But allow overriding to full backend URL if you want.
    const saved = localStorage.getItem(LS.backendUrl);
    if (!saved || saved.trim() === "") return ""; // use relative /api
    return saved.replace(/\/+$/, ""); // strip trailing slash
  }

  function setBackendBase(v) {
    const val = String(v || "").trim();
    localStorage.setItem(LS.backendUrl, val);
  }

  function apiPath(path) {
    const base = getBackendBase();
    // If base is empty -> same origin (/api/...)
    return base ? `${base}${path}` : path;
  }

  function getRefreshSeconds() {
    const saved = localStorage.getItem(LS.refreshSeconds);
    const n = Number(saved);
    if (Number.isFinite(n) && n >= 2 && n <= 60) return n;
    return 5;
  }

  function setRefreshSeconds(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return;
    const clamped = Math.max(2, Math.min(60, v));
    localStorage.setItem(LS.refreshSeconds, String(clamped));
  }

  function getSmoothingEnabled() {
    const saved = localStorage.getItem(LS.psiSmoothOn);
    if (saved === null) return true; // default checked
    return saved === "true";
  }

  function setSmoothingEnabled(v) {
    localStorage.setItem(LS.psiSmoothOn, String(!!v));
  }

  function getSmoothingWindow() {
    const saved = localStorage.getItem(LS.psiSmoothWindow);
    const n = Number(saved);
    if (Number.isFinite(n) && n >= 1 && n <= 60) return n;
    return 12;
  }

  function setSmoothingWindow(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return;
    const clamped = Math.max(1, Math.min(60, v));
    localStorage.setItem(LS.psiSmoothWindow, String(clamped));
  }

  // -------------------- General helpers --------------------
  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safeJsonStringify(obj) {
    try {
      return JSON.stringify(obj, null, 2);
    } catch (e) {
      return String(obj);
    }
  }

  function fmtTime(value) {
    if (!value) return "—";
    let d = null;
    if (typeof value === "number") d = new Date(value > 1e12 ? value : value * 1000);
    else d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleString();
  }

  function formatNumber(v, decimals = 2) {
    if (v === null || v === undefined) return "—";
    if (typeof v === "number") return v.toFixed(decimals);
    const n = Number(v);
    if (Number.isFinite(n)) return n.toFixed(decimals);
    return String(v);
  }

  async function apiGet(path) {
    const url = apiPath(path);
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    let body = null;
    const ct = res.headers.get("content-type") || "";
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

  // -------------------- UI: badges / toast --------------------
  function setBackendBadge(ok, text) {
    if (!el.backendBadge) return;
    el.backendBadge.textContent = text;

    // Your CSS classes exist: badge-warn etc. Keep simple:
    el.backendBadge.classList.remove("badge-warn");
    el.backendBadge.classList.remove("badge-ok");
    el.backendBadge.classList.remove("badge-bad");

    if (ok === true) el.backendBadge.classList.add("badge-ok");
    else if (ok === false) el.backendBadge.classList.add("badge-bad");
    else el.backendBadge.classList.add("badge-warn");
  }

  // -------------------- Tabs --------------------
  function setActiveTab(name) {
    el.tabs.forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    el.tabPanels.forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
  }

  function wireTabs() {
    el.tabs.forEach((btn) => {
      btn.addEventListener("click", () => {
        setActiveTab(btn.dataset.tab);
      });
    });
  }

  // -------------------- Details panel --------------------
  function hideDetails() {
    if (!el.deviceDetails) return;
    el.deviceDetails.classList.add("hidden");
    if (el.detailsBody) el.detailsBody.textContent = "Click a device…";
    if (el.detailsTitle) el.detailsTitle.textContent = "Device";
  }

  function showDetails() {
    if (!el.deviceDetails) return;
    el.deviceDetails.classList.remove("hidden");
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

  // -------------------- Sensor normalization + rendering --------------------
  function prettifySensorId(id) {
    return String(id || "")
      .replace(/^sensor-/, "")
      .replaceAll("-", " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function inferUnitFromId(id) {
    const x = String(id || "");
    if (x.includes("temp")) return "°C";
    if (x.includes("float")) return "";
    return "PSI";
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
        unit: inferUnitFromId(x.id),
      }));
    }

    // Object format
    if (s && typeof s === "object") {
      const out = [];
      const map = [
        { id: "sensor-inlet",  label: "Inlet",  valueKey: "inletPSI",  voltKey: "inletV",  unit: "PSI" },
        { id: "sensor-ro",     label: "RO",     valueKey: "roPSI",     voltKey: "roV",     unit: "PSI" },
        { id: "sensor-filter", label: "Filter", valueKey: "filterPSI", voltKey: "filterV", unit: "PSI" },
        { id: "sensor-air",    label: "Air",    valueKey: "airPSI",    voltKey: "airV",    unit: "PSI" },
        { id: "sensor-temp",   label: "Temp",   valueKey: "tempC",     voltKey: null,      unit: "°C"  },
      ];

      for (const m of map) {
        const v = s[m.valueKey];
        if (v === undefined || v === null) continue;
        out.push({
          id: m.id,
          label: m.label,
          value: v,
          voltage: m.voltKey ? s[m.voltKey] : undefined,
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

    const topVal =
      top === true ? 1 : top === false ? 0 : (typeof top === "number" ? top : null);
    const botVal =
      bottom === true ? 1 : bottom === false ? 0 : (typeof bottom === "number" ? bottom : null);

    return { top: topVal, bottom: botVal };
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

    // Add floats as cards too
    if (floats.top !== null) {
      sensors.push({
        id: "float-top",
        label: "Float Top",
        value: floats.top,
        voltage: undefined,
        status: "normal",
        unit: "",
        isBool: true,
      });
    }
    if (floats.bottom !== null) {
      sensors.push({
        id: "float-bottom",
        label: "Float Bottom",
        value: floats.bottom,
        voltage: undefined,
        status: "normal",
        unit: "",
        isBool: true,
      });
    }

    const cardsHtml = sensors.length
      ? `
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap:12px;">
          ${sensors
            .map((s) => {
              const status = (s.status || "normal").toLowerCase();
              const isFault = status === "fault";
              const pillBg = isFault ? "rgba(176,0,32,.15)" : "rgba(27,191,106,.18)";
              const pillText = isFault ? "Fault" : "Normal";

              const isBool = s.isBool || String(s.id || "").includes("float");
              const mainValue = isBool
                ? (Number(s.value) === 1 ? "CLOSED" : "OPEN")
                : formatNumber(s.value, 2);
              const unit = isBool ? "" : (s.unit || "");

              return `
                <div style="padding:14px; border-radius:14px; background:rgba(0,0,0,.05);">
                  <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
                    <div style="font-weight:800;">${escapeHtml(s.label)}</div>
                    <div style="margin-left:auto; font-size:12px; padding:4px 10px; border-radius:999px; background:${pillBg};">
                      ${pillText}
                    </div>
                  </div>

                  <div style="font-size:44px; font-weight:900; line-height:1;">
                    ${escapeHtml(String(mainValue))}
                    ${unit ? `<span style="font-size:16px; font-weight:800; opacity:.75;"> ${escapeHtml(unit)}</span>` : ""}
                  </div>

                  ${s.voltage !== undefined && !isBool ? `
                    <div style="margin-top:10px; font-size:18px; font-weight:800; opacity:.85;">
                      ${formatNumber(Number(s.voltage), 4)} V
                    </div>
                  ` : ""}

                  <div style="margin-top:8px; font-size:12px; opacity:.7;">
                    ID: ${escapeHtml(s.id || "")}
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      `
      : `<div style="opacity:.8; font-size:13px;">No sensors returned for this device.</div>`;

    const headerHtml = `
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
        <div style="padding:6px 10px; border-radius:999px; background:rgba(0,0,0,.06); font-size:12px;">
          Status: <b>${isOnline ? "Online" : "Offline"}</b>
        </div>
      </div>

      ${faultActive ? `
        <div style="padding:10px 12px; border-radius:12px; background:rgba(176,0,32,.08); color:#b00020; margin-bottom:14px;">
          <b>FAULT:</b> ${escapeHtml(faultMessage || "Active")}
        </div>
      ` : ""}
    `;

    const rawJsonHtml = `
      <div style="margin-top:16px; font-size:12px; opacity:.7;">Raw JSON:</div>
      <pre style="padding:12px; background:rgba(0,0,0,.06); border-radius:8px; overflow:auto; max-height:35vh;">${escapeHtml(
        safeJsonStringify(device)
      )}</pre>
    `;

    return headerHtml + cardsHtml + rawJsonHtml;
  }

  function setDetailsDevice(mac, device) {
    showDetails();
    if (el.detailsTitle) el.detailsTitle.textContent = mac;

    // detailsBody is a <pre>, but we want rich HTML.
    // We'll replace its contents with HTML while keeping your styling.
    if (el.detailsBody) {
      el.detailsBody.innerHTML = renderDetailsHtml(mac, device);
    }
  }

  // -------------------- Device cards rendering --------------------
  function clearDeviceSelection() {
    $$(".device-card", el.devicesGrid || document).forEach((c) => c.classList.remove("selected"));
  }

  function selectCard(cardEl) {
    clearDeviceSelection();
    if (cardEl) cardEl.classList.add("selected");
  }

  function macFromDevice(d) {
    return d?.mac || d?.macAddress || d?.id || d?.deviceMac || null;
  }

  function renderDevices(devices) {
    if (!el.devicesGrid) return;

    el.devicesGrid.innerHTML = "";
    if (el.devicesEmpty) el.devicesEmpty.classList.toggle("hidden", devices.length !== 0);

    const frag = document.createDocumentFragment();

    devices.forEach((d) => {
      const mac = macFromDevice(d) || "UNKNOWN";
      const name = d?.name || d?.label || d?.customerName || d?.customer || "";
      const isOnline = d?.isOnline ?? false;

      const machineMode = d?.machineMode ?? "—";
      const pumpMode = d?.pumpMode ?? "—";
      const faultActive = d?.faultActive ?? false;
      const lastSeen = d?.lastSeen ?? null;

      const card = document.createElement("div");
      card.className = "device-card"; // your CSS can style this
      card.dataset.mac = mac;

      card.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="width:10px; height:10px; border-radius:99px; background:${isOnline ? "#1bbf6a" : "#999"};"></div>
          <div style="font-weight:900;">${escapeHtml(mac)}</div>
          <div style="margin-left:auto; font-size:12px; opacity:.8;">${isOnline ? "Online" : "Offline"}</div>
        </div>

        <div style="margin-top:6px; font-size:12px; opacity:.88;">
          ${name ? `<div style="margin-bottom:4px;"><b>${escapeHtml(name)}</b></div>` : ""}
          <div>Machine: <b>${escapeHtml(String(machineMode))}</b> &nbsp; | &nbsp; Pump: <b>${escapeHtml(String(pumpMode))}</b></div>
          <div>Fault: <b>${faultActive ? "YES" : "NO"}</b> &nbsp; | &nbsp; Last: <b>${escapeHtml(fmtTime(lastSeen))}</b></div>
        </div>
      `;

      card.addEventListener("click", () => onDeviceClick(card));
      frag.appendChild(card);
    });

    el.devicesGrid.appendChild(frag);

    if (el.deviceCount) el.deviceCount.textContent = String(devices.length);
  }

  // -------------------- Fetch + refresh loop --------------------
  let refreshTimer = null;
  let refreshAgeTimer = null;
  let lastRefreshAt = Date.now();

  function startRefreshAgeTicker() {
    if (!el.refreshAge) return;
    if (refreshAgeTimer) clearInterval(refreshAgeTimer);

    refreshAgeTimer = setInterval(() => {
      const sec = Math.floor((Date.now() - lastRefreshAt) / 1000);
      el.refreshAge.textContent = String(sec);
    }, 500);
  }

  async function loadDevicesOnce() {
    try {
      // Quick API health badge
      setBackendBadge(null, "API: …");

      const payload = await apiGet("/api/devices");
      const devices = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.devices)
          ? payload.devices
          : [];

      setBackendBadge(true, "API: OK");
      renderDevices(devices);

      lastRefreshAt = Date.now();
    } catch (err) {
      setBackendBadge(false, `API: ERROR`);
      console.error(err);
      if (el.devicesGrid) {
        el.devicesGrid.innerHTML = `
          <div style="color:#b00020; font-size:14px; line-height:1.4;">
            <b>Failed to load devices list</b><br/>
            <span style="opacity:.9;">${escapeHtml(String(err?.message || err))}</span>
          </div>
        `;
      }
      if (el.deviceCount) el.deviceCount.textContent = "—";
    }
  }

  function scheduleAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);

    const sec = getRefreshSeconds();
    refreshTimer = setInterval(() => {
      loadDevicesOnce();
    }, sec * 1000);
  }

  async function onDeviceClick(cardEl) {
    const mac = cardEl?.dataset?.mac;
    if (!mac) return;

    selectCard(cardEl);
    setDetailsLoading(mac);

    try {
      const device = await apiGet(`/api/devices/${encodeURIComponent(mac)}`);
      setDetailsDevice(mac, device);
    } catch (err) {
      setDetailsError(mac, err);
    }
  }

  // -------------------- Wire UI controls --------------------
  function wireControls() {
    // Close details
    if (el.btnCloseDetails) el.btnCloseDetails.addEventListener("click", hideDetails);

    // Refresh now
    if (el.btnRefreshNow) el.btnRefreshNow.addEventListener("click", () => loadDevicesOnce());

    // Backend URL setting (optional)
    if (el.backendUrlInput) el.backendUrlInput.value = getBackendBase();
    if (el.btnSaveBackendUrl) {
      el.btnSaveBackendUrl.addEventListener("click", () => {
        setBackendBase(el.backendUrlInput?.value || "");
        loadDevicesOnce();
      });
    }

    // Refresh seconds
    if (el.refreshSeconds) {
      el.refreshSeconds.value = String(getRefreshSeconds());
      el.refreshSeconds.addEventListener("change", () => {
        setRefreshSeconds(el.refreshSeconds.value);
        scheduleAutoRefresh();
      });
    }

    // PSI smoothing toggles (stored only; you can apply later)
    if (el.psiSmoothingEnabled) {
      el.psiSmoothingEnabled.checked = getSmoothingEnabled();
      el.psiSmoothingEnabled.addEventListener("change", () => {
        setSmoothingEnabled(el.psiSmoothingEnabled.checked);
      });
    }
    if (el.psiSmoothingWindow) {
      el.psiSmoothingWindow.value = String(getSmoothingWindow());
      el.psiSmoothingWindow.addEventListener("change", () => {
        setSmoothingWindow(el.psiSmoothingWindow.value);
      });
    }
  }

  // -------------------- Boot --------------------
  async function boot() {
    wireTabs();
    wireControls();
    startRefreshAgeTicker();

    // default tab
    setActiveTab("devices");

    // default details hidden
    hideDetails();

    // initial load + auto refresh
    await loadDevicesOnce();
    scheduleAutoRefresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
