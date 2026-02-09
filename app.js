/* PlasmaStrike Frontend app.js (robust + short)
 * Works with your index.html:
 * - List container:  #devicesGrid
 * - Details panel:   #deviceDetails, #detailsTitle, #detailsBody, #btnCloseDetails
 * - Uses .card items (matches your existing DOM)
 *
 * IMPORTANT: Handles BOTH response shapes:
 *   A) [ ...devices ]
 *   B) { ok:true, count:N, devices:[ ...devices ] }
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

  function setBadge(text) {
    if (el.backendBadge) el.backendBadge.textContent = text;
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

  async function apiGetJson(path) {
    const res = await fetch(path, { cache: "no-store", headers: { Accept: "application/json" } });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    if (!res.ok) {
      const msg = typeof data === "string" ? data : (data?.error || `${res.status} ${res.statusText}`);
      throw new Error(msg);
    }
    return data;
  }

  function extractDevices(payload) {
    // Handles:
    //  - Array payload: [...]
    //  - Object payload: { devices: [...] }
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.devices)) return payload.devices;
    return [];
  }

  function macFromDevice(d) {
    return d?.mac || d?.macAddress || d?.deviceMac || d?.id || null;
  }

  function renderDevices(devices) {
    if (!el.devicesGrid) return;

    el.devicesGrid.innerHTML = "";
    if (el.devicesEmpty) el.devicesEmpty.style.display = devices.length ? "none" : "block";
    if (el.deviceCount) el.deviceCount.textContent = String(devices.length);

    for (const d of devices) {
      const mac = macFromDevice(d) || "UNKNOWN";
      const online = d?.isOnline ?? d?.online ?? false;
      const lastSeen = d?.lastSeen ?? d?.updatedAt ?? d?.last_seen ?? null;

      const card = document.createElement("div");
      card.className = "card";
      card.dataset.mac = mac;
      card.style.cursor = "pointer";

      card.innerHTML = `
        <div><b>Status:</b> ${online ? "🟢 Online" : "⚪ Offline"}</div>
        <div><b>MAC:</b> ${esc(mac)}</div>
        <div><b>Last seen:</b> ${esc(fmtTime(lastSeen))}</div>
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

      const device = await apiGetJson(`/api/devices/${encodeURIComponent(mac)}`);

      // For now: show raw JSON (you said raw is fine)
      if (el.detailsBody) {
        el.detailsBody.innerHTML = `<pre class="codebox" style="white-space:pre-wrap">${esc(JSON.stringify(device, null, 2))}</pre>`;
      }
    } catch (err) {
      showDetails();
      if (el.detailsBody) el.detailsBody.textContent = `ERROR loading ${mac}: ${String(err.message || err)}`;
    }
  }

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
        el.devicesGrid.innerHTML = `<div style="color:#b00020"><b>Failed to load /api/devices</b><br>${esc(String(err.message || err))}</div>`;
      }
      if (el.deviceCount) el.deviceCount.textContent = "—";
    }
  }

  function boot() {
    // Details closed initially
    hideDetails();

    // Close button
    if (el.btnCloseDetails) el.btnCloseDetails.addEventListener("click", hideDetails);

    // Refresh now
    if (el.btnRefreshNow) el.btnRefreshNow.addEventListener("click", refreshDevices);

    startRefreshAge();
    refreshDevices();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
