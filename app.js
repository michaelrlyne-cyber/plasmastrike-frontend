/* PlasmaStrike Frontend app.js (robust + LOUD when routing is wrong)
 *
 * Works with your index.html:
 * - List container:  #devicesGrid
 * - Details panel:   #deviceDetails, #detailsTitle, #detailsBody, #btnCloseDetails
 * - Uses .card items (matches your DOM)
 *
 * Key behavior:
 * - Calls /api/devices (via your domain)
 * - If response is NOT JSON (e.g. HTML page), shows API: ERROR clearly
 * - Handles BOTH valid response shapes:
 *   A) [ ...devices ]
 *   B) { ok:true, count:N, devices:[ ...devices ] }
 *
 * IMPORTANT CHANGE:
 * - Device details fetch uses: /api/devices?mac=...
 *   (NOT /api/devices/:mac which your backend does not implement)
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

  // ---------- tiny helpers ----------
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

  // ---------- API: MUST be JSON ----------
  async function apiGetJson(path) {
    const res = await fetch(path, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const text = await res.text();

    // If worker/proxy is wrong, you'll often get HTML here with 200 OK.
    if (!ct.includes("application/json")) {
      const preview = text.slice(0, 120).replace(/\s+/g, " ");
      throw new Error(
        `Expected JSON from ${path}, got "${ct || "no content-type"}". ` +
        `Preview: ${preview}`
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

  function macFromDevice(d) {
    return d?.mac || d?.macAddress || d?.deviceMac || d?.id || null;
  }

  // ---------- render ----------
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

  async function openDevice(mac) {
    try {
      showDetails();
      if (el.detailsTitle) el.detailsTitle.textContent = mac;
      if (el.detailsBody) el.detailsBody.textContent = `Loading ${mac}…`;

      // ✅ IMPORTANT: query param instead of /:mac path
      const device = await apiGetJson(`/api/devices?mac=${encodeURIComponent(mac)}`);

      if (el.detailsBody) {
        el.detailsBody.innerHTML =
          `<pre class="codebox" style="white-space:pre-wrap">${esc(JSON.stringify(device, null, 2))}</pre>`;
      }
    } catch (err) {
      showDetails();
      if (el.detailsBody) el.detailsBody.innerHTML =
        `<div style="color:#ff6b6b; font-weight:700;">ERROR:</div>
         <pre class="codebox" style="white-space:pre-wrap">${esc(String(err.message || err))}</pre>`;
    }
  }

  // ---------- refresh age ----------
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
