/* plasmastrike-frontend/app.js
 *
 * PlasmaStrike Frontend (Fly + Neon + Cloudflare)
 * - Loads /api/devices
 * - Renders clickable device cards
 * - Click card -> GET /api/devices/:mac
 * - Renders a "classic" details panel with sensor cards
 * - Handles BOTH sensor formats:
 *    A) sensors: { inletPSI, inletV, roPSI, roV, ... }
 *    B) sensors: [ {id,value,voltage,status}, ... ]
 */

(() => {
  // -------------------- Helpers --------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

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

    if (typeof value === "number") {
      d = new Date(value > 1e12 ? value : value * 1000);
    } else {
      d = new Date(value);
    }

    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleString();
  }

  function formatNumber(v, decimals = 2) {
    if (v === null || v === undefined) return "—";
    if (typeof v !== "number") {
      const n = Number(v);
      if (Number.isFinite(n)) return n.toFixed(decimals);
      return String(v);
    }
    return v.toFixed(decimals);
  }

  async function apiGet(path) {
    const res = await fetch(path, {
      method: "GET",
      headers: { Accept: "application/json" },
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

  // -------------------- DOM Targets --------------------
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

  function setDetailsEmpty() {
    const panel = getDetailsPanel();
    if (!panel) return;
    panel.innerHTML = `
      <div style="opacity:.85; font-size:14px;">
        Click a device…
      </div>
    `;
  }

  function setDetailsLoading(mac) {
    const panel = getDetailsPanel();
    if (!panel) return;
    panel.innerHTML = `
      <div style="opacity:.85; font-size:14px;">
        Loading details for <b>${escapeHtml(mac)}</b>…
      </div>
    `;
  }

  function setDetailsError(mac, err) {
    const panel = getDetailsPanel();
    if (!panel) return;
    panel.innerHTML = `
      <div style="color:#b00020; font-size:14px; line-height:1.4;">
        <b>Failed to load device:</b> ${escapeHtml(mac)}<br/>
        <span style="opacity:.9;">${escapeHtml(String(err?.message || err))}</span>
      </div>
    `;
  }

  // -------------------- Sensor Normalization --------------------
  function prettifySensorId(id) {
    return String(id || "")
      .replace(/^sensor-/, "")
      .replaceAll("-", " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function normalizeSensors(device) {
    const s = device?.sensors;

    // Case B: array format already
    if (Array.isArray(s)) {
      return s.map((x) => ({
        id: x.id,
        label: prettifySensorId(x.id),
        value: x.value,
        voltage: x.voltage,
        status: x.status || "normal",
        unit: inferUnitFromId(x.id),
      }));
    }

    // Case A: object format -> convert to array
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

  function inferUnitFromId(id) {
    const x = String(id || "");
    if (x.includes("temp")) return "°C";
    if (x.includes("float")) return "";
    return "PSI";
  }

  function normalizeFloats(device) {
    // device-level fields you already have:
    // floatTop, floatBottom may be 0/1 or true/false
    const top = device?.floatTop;
    const bottom = device?.floatBottom;

    const topVal = top === true ? 1 : top === false ? 0 : (typeof top === "number" ? top : null);
    const botVal = bottom === true ? 1 : bottom === false ? 0 : (typeof bottom === "number" ? bottom : null);

    return {
      top: topVal,
      bottom: botVal,
    };
  }

  // -------------------- Rendering: Devices List --------------------
  function highlightSelectedCard(selectedEl) {
    $$(".device-card").forEach((el) => el.classList.remove("selected"));
    if (selectedEl) selectedEl.classList.add("selected");
  }

  function macFromDevice(device) {
    return device?.mac || device?.macAddress || device?.id || device?.deviceMac || null;
  }

  function renderDevices(devices) {
    const container = getDevicesContainer();
    container.innerHTML = "";

    const frag = document.createDocumentFragment();

    devices.forEach((d) => {
      const mac = macFromDevice(d) || "UNKNOWN";
      const name = d?.name || d?.label || d?.customerName || d?.customer || "";
      const isOnline = d?.isOnline ?? d?.online ?? false;

      const machineMode = d?.machineMode ?? d?.machine_mode ?? "—";
      const pumpMode = d?.pumpMode ?? d?.pump_mode ?? "—";
      const faultActive = d?.faultActive ?? d?.fault_active ?? false;

      const lastSeen = d?.lastSeen ?? d?.last_seen ?? d?.updatedAt ?? d?.updated_at ?? null;

      const card = document.createElement("div");
      card.className = "device-card";
      card.dataset.mac = mac;

      card.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="width:10px; height:10px; border-radius:99px; background:${isOnline ? "#1bbf6a" : "#999"};"></div>
          <div style="font-weight:800;">${escapeHtml(mac)}</div>
          <div style="margin-left:auto; font-size:12px; opacity:.8;">
            ${isOnline ? "Online" : "Offline"}
          </div>
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

    container.appendChild(frag);
  }

  // -------------------- Rendering: Details Panel --------------------
  function renderSensorCardsHtml(device) {
    const sensors = normalizeSensors(device);
    const floats = normalizeFloats(device);

    const floatCards = [];
    if (floats.top !== null) {
      floatCards.push({
        label: "Float Top",
        value: floats.top,
        status: "normal",
        unit: "",
        voltage: undefined,
        id: "float-top",
        isBool: true,
      });
    }
    if (floats.bottom !== null) {
      floatCards.push({
        label: "Float Bottom",
        value: floats.bottom,
        status: "normal",
        unit: "",
        voltage: undefined,
        id: "float-bottom",
        isBool: true,
      });
    }

    const combined = [
      ...sensors.map((s) => ({ ...s, isBool: s.id?.includes("float") })),
      ...floatCards,
    ];

    if (combined.length === 0) {
      return `<div style="opacity:.75; font-size:13px;">No sensors returned for this device.</div>`;
    }

    return `
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap:12px;">
        ${combined
          .map((s) => {
            const status = String(s.status || "normal").toLowerCase();
            const isFault = status === "fault";
            const pillBg = isFault ? "rgba(176,0,32,.15)" : "rgba(27,191,106,.18)";
            const pillText = isFault ? "Fault" : "Normal";

            const mainValue = s.isBool
              ? (Number(s.value) === 1 ? "CLOSED" : "OPEN")
              : formatNumber(s.value, 2);

            const unit = s.isBool ? "" : (s.unit || "");

            return `
              <div style="padding:14px; border-radius:14px; background:rgba(0,0,0,.05);">
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
                  <div style="font-weight:800;">${escapeHtml(s.label)}</div>
                  <div style="margin-left:auto; font-size:12px; padding:4px 10px; border-radius:99px; background:${pillBg};">
                    ${pillText}
                  </div>
                </div>

                <div style="font-size:44px; font-weight:900; line-height:1;">
                  ${escapeHtml(String(mainValue))}
                  ${unit ? `<span style="font-size:16px; font-weight:800; opacity:.75;"> ${escapeHtml(unit)}</span>` : ""}
                </div>

                ${s.voltage !== undefined && !s.isBool ? `
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
    `;
  }

  function setDetailsDevice(mac, device) {
    const panel = getDetailsPanel();
    if (!panel) return;

    const isOnline = device?.isOnline ?? device?.online ?? false;
    const lastSeen = device?.lastSeen ?? device?.last_seen ?? device?.updatedAt ?? device?.updated_at ?? null;

    const machineMode = device?.machineMode ?? device?.machine_mode ?? "—";
    const pumpMode = device?.pumpMode ?? device?.pump_mode ?? "—";

    const faultActive = device?.faultActive ?? device?.fault_active ?? false;
    const faultMessage = device?.faultMessage ?? device?.fault_message ?? "";

    panel.innerHTML = `
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

      ${renderSensorCardsHtml(device)}

      <div style="margin-top:16px; font-size:12px; opacity:.7;">Raw JSON:</div>
      <pre style="padding:12px; background:rgba(0,0,0,.06); border-radius:8px; overflow:auto; max-height:35vh;">${safeJsonStringify(device)}</pre>
    `;
  }

  // -------------------- Click -> Load device details --------------------
  async function onDeviceClick(cardEl) {
    const mac = cardEl?.dataset?.mac;
    if (!mac) return;

    highlightSelectedCard(cardEl);
    setDetailsLoading(mac);

    try {
      const device = await apiGet(`/api/devices/${encodeURIComponent(mac)}`);
      setDetailsDevice(mac, device);
    } catch (err) {
      setDetailsError(mac, err);
    }
  }

  // -------------------- Boot --------------------
  async function boot() {
    setDetailsEmpty();

    try {
      const payload = await apiGet("/api/devices");
      const devices = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.devices)
          ? payload.devices
          : [];

      renderDevices(devices);

      // optional: auto-highlight first
      const first = $(".device-card");
      if (first) {
        // first.click();
      }
    } catch (err) {
      const container = getDevicesContainer();
      container.innerHTML = `
        <div style="color:#b00020; font-size:14px; line-height:1.4;">
          <b>Failed to load devices list</b><br/>
          <span style="opacity:.9;">${escapeHtml(String(err?.message || err))}</span>
        </div>
      `;
      setDetailsError("—", err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
