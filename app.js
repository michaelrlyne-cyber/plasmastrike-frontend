/* plasmastrike-frontend/app.js
 *
 * PlasmaStrike Frontend
 * - Loads /api/devices
 * - Renders clickable device cards
 * - Click card -> GET /api/devices/:mac
 * - Populates details panel with raw JSON (for now)
 */

(() => {
  // ---------- Helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function safeJsonStringify(obj) {
    try {
      return JSON.stringify(obj, null, 2);
    } catch (e) {
      return String(obj);
    }
  }

  function fmtTime(value) {
    if (!value) return "—";
    // supports ISO, unix ms, unix sec
    let d = null;
    if (typeof value === "number") {
      d = new Date(value > 1e12 ? value : value * 1000);
    } else {
      d = new Date(value);
    }
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleString();
  }

  async function apiGet(path) {
    const res = await fetch(path, {
      method: "GET",
      headers: { "Accept": "application/json" },
      cache: "no-store",
    });

    let body = null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      body = await res.json().catch(() => null);
    } else {
      body = await res.text().catch(() => null);
    }

    if (!res.ok) {
      const msg =
        (body && body.error) ||
        (typeof body === "string" && body) ||
        `${res.status} ${res.statusText}`;
      throw new Error(msg);
    }
    return body;
  }

  // ---------- DOM hookups (flexible) ----------
  // We try a few common IDs/classes so it works with your current index.html.
  function getDevicesContainer() {
    return (
      $("#devices") ||
      $("#device-list") ||
      $(".devices") ||
      $(".device-list") ||
      $("#deviceGrid") ||
      $(".device-grid") ||
      document.body
    );
  }

  function getDetailsPanel() {
    // Your new details panel exists in DOM; try common selectors.
    // If your index.html has a specific id/class, add it here.
    return (
      $("#device-details") ||
      $("#deviceDetails") ||
      $(".device-details") ||
      $(".details-panel") ||
      $("#details") ||
      $(".details") ||
      null
    );
  }

  function setDetailsLoading(mac) {
    const panel = getDetailsPanel();
    if (!panel) return;
    panel.innerHTML = `
      <div style="opacity:.85; font-size:14px;">
        Loading details for <b>${mac}</b>…
      </div>
    `;
  }

  function setDetailsEmpty() {
    const panel = getDetailsPanel();
    if (!panel) return;
    panel.innerHTML = `
      <div style="opacity:.85; font-size:14px;">
        Click a device…
      </div>
    `;
  }

  function setDetailsError(mac, err) {
    const panel = getDetailsPanel();
    if (!panel) return;
    panel.innerHTML = `
      <div style="color:#b00020; font-size:14px; line-height:1.4;">
        <b>Failed to load device:</b> ${mac}<br/>
        <span style="opacity:.9;">${String(err.message || err)}</span>
      </div>
      <pre style="margin-top:12px; padding:12px; background:rgba(0,0,0,.06); border-radius:8px; overflow:auto;">${String(err.stack || "")}</pre>
    `;
  }

  function setDetailsJson(mac, data) {
    const panel = getDetailsPanel();
    if (!panel) return;

    // Show a minimal header + raw JSON
    const isOnline = data?.isOnline ?? data?.online ?? false;
    const lastSeen = data?.lastSeen ?? data?.last_seen ?? data?.updatedAt ?? data?.updated_at;

    panel.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
        <div style="width:10px; height:10px; border-radius:99px; background:${isOnline ? "#1bbf6a" : "#999"};"></div>
        <div style="font-size:16px; font-weight:700;">${mac}</div>
        <div style="margin-left:auto; font-size:12px; opacity:.8;">
          Last seen: ${fmtTime(lastSeen)}
        </div>
      </div>

      <div style="font-size:12px; opacity:.75; margin-bottom:8px;">
        Raw JSON (temporary view)
      </div>

      <pre style="padding:12px; background:rgba(0,0,0,.06); border-radius:8px; overflow:auto; max-height:55vh;">${safeJsonStringify(
        data
      )}</pre>
    `;
  }

  function highlightSelectedCard(selectedEl) {
    $$(".device-card").forEach((el) => el.classList.remove("selected"));
    if (selectedEl) selectedEl.classList.add("selected");
  }

  function macFromDevice(device) {
    return device?.mac || device?.macAddress || device?.id || device?.deviceMac || null;
  }

  // ---------- Rendering ----------
  function renderDevices(devices) {
    const container = getDevicesContainer();

    // If index.html already has cards, we still re-render for safety.
    // You can change this to only wire existing cards if you prefer.
    container.innerHTML = "";

    const frag = document.createDocumentFragment();

    devices.forEach((d) => {
      const mac = macFromDevice(d) || "UNKNOWN";
      const name = d?.name || d?.label || d?.customerName || d?.customer || "";
      const isOnline = d?.isOnline ?? d?.online ?? false;

      const machineMode = d?.machineMode ?? d?.machine_mode ?? "";
      const pumpMode = d?.pumpMode ?? d?.pump_mode ?? "";
      const faultActive = d?.faultActive ?? d?.fault_active ?? false;

      const lastSeen = d?.lastSeen ?? d?.last_seen ?? d?.updatedAt ?? d?.updated_at ?? null;

      const card = document.createElement("div");
      card.className = "device-card";
      card.dataset.mac = mac;

      // Keep markup simple. Your CSS can style .device-card and .selected.
      card.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="width:10px; height:10px; border-radius:99px; background:${isOnline ? "#1bbf6a" : "#999"};"></div>
          <div style="font-weight:700;">${mac}</div>
          <div style="margin-left:auto; font-size:12px; opacity:.8;">${isOnline ? "Online" : "Offline"}</div>
        </div>

        <div style="margin-top:6px; font-size:12px; opacity:.85;">
          ${name ? `<div><b>${escapeHtml(name)}</b></div>` : ""}
          <div>Machine: <b>${escapeHtml(String(machineMode || "—"))}</b> &nbsp; | &nbsp; Pump: <b>${escapeHtml(String(pumpMode || "—"))}</b></div>
          <div>Fault: <b>${faultActive ? "YES" : "NO"}</b> &nbsp; | &nbsp; Last seen: <b>${escapeHtml(fmtTime(lastSeen))}</b></div>
        </div>
      `;

      card.addEventListener("click", () => {
        onDeviceClick(card);
      });

      frag.appendChild(card);
    });

    container.appendChild(frag);
  }

  async function onDeviceClick(cardEl) {
    const mac = cardEl?.dataset?.mac;
    if (!mac) return;

    highlightSelectedCard(cardEl);
    setDetailsLoading(mac);

    try {
      const data = await apiGet(`/api/devices/${encodeURIComponent(mac)}`);
      setDetailsJson(mac, data);
    } catch (err) {
      setDetailsError(mac, err);
    }
  }

  // Simple HTML escape for names/modes in innerHTML
  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // ---------- Boot ----------
  async function boot() {
    // Show default state in details
    setDetailsEmpty();

    // Load devices
    try {
      const payload = await apiGet("/api/devices");

      // Your backend might return { count, devices: [...] } OR just [...]
      const devices = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.devices)
          ? payload.devices
          : [];

      renderDevices(devices);

      // Optional: auto-select first device
      const first = $(".device-card");
      if (first) {
        // Uncomment if you want auto-open
        // first.click();
      }
    } catch (err) {
      const container = getDevicesContainer();
      container.innerHTML = `
        <div style="color:#b00020; font-size:14px; line-height:1.4;">
          <b>Failed to load devices list</b><br/>
          <span style="opacity:.9;">${String(err.message || err)}</span>
        </div>
      `;
      // Also show in details
      setDetailsError("—", err);
    }
  }

  // Run after DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
