/* PlasmaStrike Frontend app.js
 *
 * FIXES:
 * 1) Worker/proxy sanity: if /api/devices returns HTML, show API: ERROR (no silent "0 devices")
 * 2) Clicking a device now shows THAT device (even if backend returns {devices:[...]} again)
 * 3) Device details uses /api/devices?mac=... (since /api/devices/:mac is not implemented)
 * 4) Renders "sensor cards" style view like your old app:
 *    - Inlet / RO / Filter / Air / Temp
 *    - Floats shown as OPEN/CLOSED
 *    - Volts are HIDDEN on Devices details (kept for Calibration later)
 *
 * Works with your index.html IDs:
 * - #devicesGrid, #devicesEmpty
 * - #deviceDetails, #detailsTitle, #detailsBody, #btnCloseDetails
 * - #backendBadge, #deviceCount, #refreshAge, #btnRefreshNow
 */

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);

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
  };

  // ---------- helpers ----------
  function setBadge(text) {
    if (el.backendBadge) el.backendBadge.textContent = text;
  }

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function fmtTime(v) {
    if (!v) return "—";
    const d = typeof v === "number" ? new Date(v > 1e12 ? v : v * 1000) : new Date(v);
    return isNaN(d.getTime()) ? String(v) : d.toLocaleString();
  }

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

  function macFromDevice(d) {
    return d?.mac || d?.macAddress || d?.deviceMac || d?.id || null;
  }

  function normalizeMac(m) {
    return String(m || "").trim().toUpperCase();
  }

  // ---------- API: MUST be JSON ----------
  async function apiGetJson(path) {
    const res = await fetch(path, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const text = await res.text();

    // If proxy is wrong, you'll often get HTML here with 200 OK.
    if (!ct.includes("application/json")) {
      const preview = text.slice(0, 120).replace(/\s+/g, " ");
      throw new Error(
        `Expected JSON from ${path}, got "${ct || "no content-type"}". Preview: ${preview}`
      );
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSON from ${path}.`);
    }

    if (!res.ok) {
      const msg = data?.error || `${res.status} ${res.statusText}`;
      throw new Error(msg);
    }
    return data;
  }

  function extractDevices(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.devices)) return payload.devices;
    return [];
  }

  // ---------- sensors helpers (hide volts on Devices) ----------
  function coerceNumber(x) {
    const n = typeof x === "number" ? x : Number(x);
    return Number.isFinite(n) ? n : null;
  }

  function cardHtml({ title, value, unit = "", status = "Normal", sub = "" }) {
    const ok = String(status).toLowerCase() !== "fault";
    const pillBg = ok ? "rgba(27,191,106,.18)" : "rgba(176,0,32,.15)";
    const pillText = ok ? "Normal" : "Fault";

    return `
      <div style="padding:14px; border-radius:14px; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.06);">
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
          <div style="font-weight:800;">${esc(title)}</div>
          <div style="margin-left:auto; font-size:12px; padding:4px 10px; border-radius:999px; background:${pillBg};">
            ${pillText}
          </div>
        </div>

        <div style="font-size:44px; font-weight:900; line-height:1;">
          ${esc(value)}
          ${unit ? `<span style="font-size:16px; font-weight:800; opacity:.75;"> ${esc(unit)}</span>` : ""}
        </div>

        ${sub ? `<div style="margin-top:8px; font-size:12px; opacity:.75;">${sub}</div>` : ""}
      </div>
    `;
  }

  function buildSensorCards(device) {
    // Device can have sensors as:
    // A) object: { inletPSI, inletV, roPSI, roV, ... }
    // B) array:  [ {id,value,voltage,status}, ... ]
    const s = device?.sensors;
    const cards = [];

    // helper to push PSI card
    const pushPsi = (title, psiValue, status = "normal") => {
      const psi = coerceNumber(psiValue);
      if (psi === null) return;
      cards.push(
        cardHtml({
          title,
          value: psi.toFixed(2),
          unit: "PSI",
          status,
        })
      );
    };

    const pushTemp = (tempValue, status = "normal") => {
      const t = coerceNumber(tempValue);
      if (t === null) return;
      cards.push(
        cardHtml({
          title: "Temp",
          value: t.toFixed(0),
          unit: "°C",
          status,
        })
      );
    };

    // Floats
    const floatTop = device?.floatTop;
    const floatBottom = device?.floatBottom;

    const floatToState = (v) => {
      // backend sometimes gives true/false or 0/1
      if (v === true || v === 1) return "CLOSED";
      if (v === false || v === 0) return "OPEN";
      return null;
    };

    const ft = floatToState(floatTop);
    const fb = floatToState(floatBottom);

    if (ft) {
      cards.push(
        cardHtml({
          title: "Float Top",
          value: ft,
          unit: "",
          status: "normal",
        })
      );
    }
    if (fb) {
      cards.push(
        cardHtml({
          title: "Float Bottom",
          value: fb,
          unit: "",
          status: "normal",
        })
      );
    }

    // Case B: array sensors
    if (Array.isArray(s)) {
      const byId = new Map(s.map((x) => [String(x.id || ""), x]));
      const inlet = byId.get("sensor-inlet");
      const ro = byId.get("sensor-ro");
      const filter = byId.get("sensor-filter");
      const air = byId.get("sensor-air");
      const temp = byId.get("sensor-temp");

      if (inlet) pushPsi("Inlet", inlet.value, inlet.status);
      if (ro) pushPsi("RO", ro.value, ro.status);
      if (filter) pushPsi("Filter", filter.value, filter.status);
      if (air) pushPsi("Air", air.value, air.status);
      if (temp) pushTemp(temp.value, temp.status);

      return cards;
    }

    // Case A: object sensors
    if (s && typeof s === "object") {
      pushPsi("Inlet", s.inletPSI, device?.faultActive ? "fault" : "normal"); // rough
      pushPsi("RO", s.roPSI, "normal");
      pushPsi("Filter", s.filterPSI, "normal");
      pushPsi("Air", s.airPSI, "normal");
      pushTemp(s.tempC, "normal");
      return cards;
    }

    return cards;
  }

  function renderDeviceDetails(mac, device) {
    const isOnline = device?.isOnline ?? device?.online ?? false;
    const lastSeen = device?.lastSeen ?? device?.updatedAt ?? device?.last_seen ?? null;
    const machineMode = device?.machineMode ?? device?.machine_mode ?? "—";
    const pumpMode = device?.pumpMode ?? device?.pump_mode ?? "—";
    const faultActive = device?.faultActive ?? device?.fault_active ?? false;
    const faultMessage = device?.faultMessage ?? device?.fault_message ?? "";

    const header = `
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
        <div style="width:10px; height:10px; border-radius:999px; background:${isOnline ? "#1bbf6a" : "#999"};"></div>
        <div style="font-size:16px; font-weight:900;">${esc(mac)}</div>
        <div style="margin-left:auto; font-size:12px; opacity:.8;">Last seen: ${esc(fmtTime(lastSeen))}</div>
      </div>

      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px;">
        <div style="padding:6px 10px; border-radius:999px; background:rgba(255,255,255,.06); font-size:12px;">
          Machine: <b>${esc(String(machineMode))}</b>
        </div>
        <div style="padding:6px 10px; border-radius:999px; background:rgba(255,255,255,.06); font-size:12px;">
          Pump: <b>${esc(String(pumpMode))}</b>
        </div>
        <div style="padding:6px 10px; border-radius:999px; background:rgba(255,255,255,.06); font-size:12px;">
          Status: <b>${isOnline ? "Online" : "Offline"}</b>
        </div>
      </div>

      ${
        faultActive
          ? `<div style="padding:10px 12px; border-radius:12px; background:rgba(176,0,32,.10); color:#ff6b6b; margin-bottom:14px;">
               <b>FAULT:</b> ${esc(faultMessage || "Active")}
             </div>`
          : ""
      }
    `;

    const cards = buildSensorCards(device);
    const cardsGrid = cards.length
      ? `<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap:12px;">${cards.join(
          ""
        )}</div>`
      : `<div style="opacity:.8; font-size:13px;">No sensor fields returned for this device.</div>`;

    const raw = `
      <div style="margin-top:16px; font-size:12px; opacity:.7;">Raw JSON (for debugging):</div>
      <pre class="codebox" style="white-space:pre-wrap">${esc(JSON.stringify(device, null, 2))}</pre>
    `;

    return header + cardsGrid + raw;
  }

  // ---------- render device list ----------
  function renderDevices(devices) {
    if (!el.devicesGrid) return;

    el.devicesGrid.innerHTML = "";
    if (el.devicesEmpty) el.devicesEmpty.style.display = devices.length ? "none" : "block";
    if (el.deviceCount) el.deviceCount.textContent = String(devices.length);

    for (const d of devices) {
      const mac = macFromDevice(d) || "UNKNOWN";
      const online = d?.isOnline ?? d?.online ?? false;
      const lastSeen = d?.lastSeen ?? d?.updatedAt ?? d?.last_seen ?? null;

      const machineMode = d?.machineMode ?? d?.machine_mode ?? "—";
      const pumpMode = d?.pumpMode ?? d?.pump_mode ?? "—";
      const faultActive = d?.faultActive ?? d?.fault_active ?? false;

      const card = document.createElement("div");
      card.className = "card";
      card.dataset.mac = mac;
      card.style.cursor = "pointer";

      card.innerHTML = `
        <div><b>Status:</b> ${online ? "🟢 Online" : "⚪ Offline"}</div>
        <div><b>MAC:</b> ${esc(mac)}</div>
        <div><b>Last seen:</b> ${esc(fmtTime(lastSeen))}</div>
        <div><b>Machine:</b> ${esc(machineMode)} &nbsp; | &nbsp; <b>Pump:</b> ${esc(pumpMode)}</div>
        <div><b>Fault:</b> ${faultActive ? "YES" : "NO"}</div>
      `;

      card.addEventListener("click", () => openDevice(mac));
      el.devicesGrid.appendChild(card);
    }
  }

  // ---------- device details ----------
  async function openDevice(mac) {
    try {
      showDetails();
      if (el.detailsTitle) el.detailsTitle.textContent = mac;
      if (el.detailsBody) el.detailsBody.textContent = `Loading ${mac}…`;

      // Backend currently returns the device list even with ?mac=.
      // So we fetch and then pick the exact device we clicked.
      const payload = await apiGetJson(`/api/devices?mac=${encodeURIComponent(mac)}`);
      const list = extractDevices(payload);

      const want = normalizeMac(mac);
      const found =
        list.find((d) => normalizeMac(macFromDevice(d)) === want) ||
        list.find((d) => normalizeMac(d?.macAddress) === want) ||
        list[0] ||
        null;

      if (!found) throw new Error(`No device found for MAC ${mac}`);

      if (el.detailsBody) {
        el.detailsBody.innerHTML = renderDeviceDetails(mac, found);
      }
    } catch (err) {
      showDetails();
      if (el.detailsBody)
        el.detailsBody.innerHTML = `
          <div style="color:#ff6b6b; font-weight:800;">ERROR</div>
          <pre class="codebox" style="white-space:pre-wrap">${esc(String(err.message || err))}</pre>
        `;
    }
  }

  // ---------- refresh age + load ----------
  let lastRefreshAt = Date.now();

  function startRefreshAge() {
    if (!el.refreshAge) return;
    setInterval(() => {
      el.refreshAge.textContent = String(Math.floor((Date.now() - lastRefreshAt) / 1000));
    }, 500);
  }

  async function refreshDevices() {
    try {
      setBadge("API: …");

      const payload = await apiGetJson("/api/devices");
      const devices = extractDevices(payload);

      setBadge("API: OK");
      renderDevices(devices);
      lastRefreshAt = Date.now();
    } catch (err) {
      setBadge("API: ERROR");
      if (el.devicesGrid) {
        el.devicesGrid.innerHTML =
          `<div style="color:#ff6b6b"><b>API ERROR</b><br>${esc(String(err.message || err))}</div>`;
      }
      if (el.deviceCount) el.deviceCount.textContent = "—";
    }
  }

  function boot() {
    hideDetails();

    if (el.btnCloseDetails) el.btnCloseDetails.addEventListener("click", hideDetails);
    if (el.btnRefreshNow) el.btnRefreshNow.addEventListener("click", refreshDevices);

    startRefreshAge();
    refreshDevices();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
