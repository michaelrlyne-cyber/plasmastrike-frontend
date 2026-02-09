// PlasmaStrike Frontend - SIMPLE, STABLE, SALES-READY
// Incremental improvements only (no rewrite, no framework)
// - Fixes "No devices found" bug
// - Sales-readable device cards + "Last seen: 15s ago"
// - PSI smoothing (toggle + window)
// - Volts/raw stays ONLY in Calibration (not on Devices)
// - Sales View mode: ?view=sales hides advanced tabs + locks backend URL

const DEFAULT_API = "https://api.plasma-strike.com";
const PROD_API = "https://api.plasma-strike.com";

const $ = (id) => document.getElementById(id);

// ---------------- VIEW MODE ----------------
function isSalesView() {
  const params = new URLSearchParams(location.search);
  return params.get("view") === "sales";
}

function applySalesView() {
  if (!isSalesView()) return;

  document.body.classList.add("sales-view");

  // Force production backend and lock it down
  try { localStorage.setItem("apiBase", PROD_API); } catch {}

  const backendInput = $("backendUrlInput");
  if (backendInput) {
    backendInput.value = PROD_API;
    backendInput.disabled = true;
  }

  const saveBtn = $("btnSaveBackendUrl");
  if (saveBtn) saveBtn.disabled = true;

  // Hide advanced tabs (if present)
  document.querySelectorAll(".tab-logs,.tab-calibration,.tab-settings").forEach(el => {
    el.style.display = "none";
  });

  // Optional hint in Settings (if the element exists)
  const salesHint = $("salesHint");
  if (salesHint) salesHint.style.display = "block";
}

// ---------------- UI HELPERS ----------------
function setBackendBadge(text, ok) {
  const el = $("backendBadge");
  if (!el) return;
  el.textContent = text;
  el.className = "badge " + (ok ? "badge-ok" : "badge-warn");
}

function showToast(msg) {
  const t = $("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.add("hidden"), 3000);
}

// Stop favicon errors
(() => {
  const link = document.createElement("link");
  link.rel = "icon";
  link.href = "data:,";
  document.head.appendChild(link);
})();

// ---------------- SETTINGS ----------------
function getApi() {
  const raw = (localStorage.getItem("apiBase") || DEFAULT_API);
  return raw.replace(/\/+$/, "");
}

function setApi(url) {
  localStorage.setItem("apiBase", url.replace(/\/+$/, ""));
}

function getRefreshSeconds() {
  const v = Number(localStorage.getItem("refreshSeconds") || 5);
  if (!Number.isFinite(v) || v < 2) return 5;
  return v;
}

function getSmoothingEnabled() {
  const el = $("psiSmoothingEnabled");
  return el ? !!el.checked : true;
}

function getSmoothingWindow() {
  const el = $("psiSmoothingWindow");
  const v = el ? Number(el.value) : 12;
  if (!Number.isFinite(v)) return 12;
  return Math.min(60, Math.max(1, Math.floor(v)));
}

// ---------------- DATA ----------------
let lastRefresh = Date.now();

// Per-device smoothing buffers: { mac: [psi1, psi2, ...] }
const psiHistory = new Map();

function updateRefreshAge() {
  const el = $("refreshAge");
  if (!el) return;
  el.textContent = Math.floor((Date.now() - lastRefresh) / 1000);
}

// "Last seen: 15s ago" formatter
function formatLastSeen(lastSeenIsoOrMs) {
  if (!lastSeenIsoOrMs) return "Unknown";

  const t = typeof lastSeenIsoOrMs === "number"
    ? lastSeenIsoOrMs
    : Date.parse(lastSeenIsoOrMs);

  if (!Number.isFinite(t)) return "Unknown";

  const diffSec = Math.max(0, Math.floor((Date.now() - t) / 1000));

  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

// Safe number parse
function toNumber(x) {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}

// Compute smoothed PSI per device
function getSmoothedPsi(mac, rawPsi) {
  const enabled = getSmoothingEnabled();
  const win = getSmoothingWindow();

  const n = toNumber(rawPsi);
  if (n === null) return null;

  if (!enabled) {
    // If smoothing disabled, still reset history to avoid stale averaging
    psiHistory.set(mac, [n]);
    return n;
  }

  const arr = psiHistory.get(mac) || [];
  arr.push(n);
  while (arr.length > win) arr.shift();
  psiHistory.set(mac, arr);

  const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
  return avg;
}

// Toggle empty state correctly (fixes your bug)
function setDevicesEmptyState({ loading = false, error = null, count = 0 }) {
  const empty = $("devicesEmpty");
  if (!empty) return;

  if (loading) {
    empty.textContent = "Loading devices…";
    empty.classList.remove("hidden");
    return;
  }

  if (error) {
    empty.textContent = `Error loading devices: ${error}`;
    empty.classList.remove("hidden");
    return;
  }

  if (count === 0) {
    empty.textContent = "No devices found.";
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");
}

// ---------------- FETCH HELPERS ----------------
async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

// ---------------- DEVICES ----------------
function normalizeMac(d) {
  return d?.mac || d?.macAddress || d?.id || "";
}

function friendlyName(d) {
  // If you later add "friendlyName" or "name" from backend, it will show automatically.
  return d?.friendlyName || d?.name || "";
}

function renderDevices(devices) {
  const grid = $("devicesGrid");
  if (!grid) return;

  const cards = devices.map(d => {
    const mac = normalizeMac(d);
    const name = friendlyName(d);
    const online = !!d.isOnline;

    // PSI: use raw d.psi if present, otherwise null
    const rawPsi = d.psi ?? d.pressurePsi ?? d.psi1 ?? d.waterPsi;
    const smoothed = mac ? getSmoothedPsi(mac, rawPsi) : toNumber(rawPsi);

    const psiText = (smoothed === null) ? "—" : `${Math.round(smoothed)} PSI`;
    const lastSeenText = formatLastSeen(d.lastSeen);

    // Sales-readable, no volts here.
    return `
      <div class="card">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
          <div>
            <div style="font-weight:700;font-size:16px;line-height:1.2;">
              ${name ? escapeHtml(name) : "Device"}
            </div>
            <div style="opacity:.75;font-size:12px;margin-top:2px;">
              MAC: ${escapeHtml(mac || "—")}
            </div>
          </div>

          <div style="font-weight:700;">
            ${online ? "🟢 Online" : "🔴 Offline"}
          </div>
        </div>

        <div style="margin-top:12px;font-size:28px;font-weight:800;">
          ${psiText}
        </div>

        <div style="margin-top:8px;opacity:.8;">
          Last seen: ${escapeHtml(lastSeenText)}
        </div>
      </div>
    `;
  });

  grid.innerHTML = cards.join("");
}

// Tiny HTML escaping for names/MAC (safety)
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

async function loadDevices() {
  const api = getApi();
  const grid = $("devicesGrid");
  const countEl = $("deviceCount");

  setDevicesEmptyState({ loading: true });

  // Health check first (keeps badge stable)
  try {
    await fetchJSON(`${api}/health`);
    setBackendBadge("API: OK", true);
  } catch {
    setBackendBadge("API: OFFLINE", false);
    if (countEl) countEl.textContent = "0";
    if (grid) grid.innerHTML = "";
    setDevicesEmptyState({ loading: false, error: "API offline", count: 0 });
    return;
  }

  try {
    const data = await fetchJSON(`${api}/api/devices`);
    const devices = data.devices || [];

    if (countEl) countEl.textContent = String(devices.length);
    lastRefresh = Date.now();

    if (!devices.length) {
      if (grid) grid.innerHTML = "";
      setDevicesEmptyState({ loading: false, count: 0 });
      return;
    }

    renderDevices(devices);
    setDevicesEmptyState({ loading: false, count: devices.length });

    // Keep calibration dropdown in sync
    populateCalibrationSelect(devices);
  } catch (e) {
    if (grid) grid.innerHTML = "";
    setDevicesEmptyState({ loading: false, error: "Device fetch failed", count: 0 });
    showToast("Device fetch failed");
  }
}

// ---------------- LOGS ----------------
async function loadLogs() {
  const api = getApi();
  const box = $("logsBox");
  if (!box) return;

  box.textContent = "Loading…";

  const limitEl = $("logsLimit");
  const limit = limitEl ? Number(limitEl.value) : 100;

  try {
    const data = await fetchJSON(`${api}/api/service-logs?limit=${Number.isFinite(limit) ? limit : 100}`);
    box.textContent = JSON.stringify(data.logs || data, null, 2);
  } catch {
    box.textContent = "Logs not available";
  }
}

// ---------------- CALIBRATION ----------------
function populateCalibrationSelect(devices) {
  const sel = $("calDeviceSelect");
  if (!sel) return;

  const current = sel.value;

  // Build options
  const opts = devices.map(d => {
    const mac = normalizeMac(d);
    const name = friendlyName(d);
    const label = name ? `${name} (${mac})` : mac;
    return { value: mac, label };
  }).filter(o => o.value);

  // Only rewrite if list changed (reduces UI flicker)
  const existing = Array.from(sel.options).map(o => o.value).join("|");
  const next = opts.map(o => o.value).join("|");
  if (existing !== next) {
    sel.innerHTML = `<option value="">Select…</option>` +
      opts.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join("");
  }

  // Restore selection if possible
  if (current && opts.some(o => o.value === current)) {
    sel.value = current;
  }
}

async function loadCalibration() {
  const api = getApi();
  const sel = $("calDeviceSelect");
  const box = $("calBox");

  if (!sel || !box || !sel.value) {
    if (box) box.textContent = "Select a device…";
    return;
  }

  try {
    const data = await fetchJSON(`${api}/api/devices/${sel.value}`);
    box.textContent = JSON.stringify(data, null, 2);
  } catch {
    box.textContent = "Calibration load failed";
  }
}

// ---------------- TABS ----------------
function wireTabs() {
  const tabs = document.querySelectorAll(".tab");
  const panels = {
    devices: $("tab-devices"),
    logs: $("tab-logs"),
    calibration: $("tab-calibration"),
    settings: $("tab-settings"),
  };

  tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      const name = btn.getAttribute("data-tab");
      tabs.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      Object.values(panels).forEach(p => p && p.classList.remove("active"));
      if (panels[name]) panels[name].classList.add("active");
    });
  });
}

// ---------------- WIRING ----------------
function wireUI() {
  $("btnRefreshNow")?.addEventListener("click", loadDevices);
  $("btnLogsRefresh")?.addEventListener("click", loadLogs);
  $("btnCalRefresh")?.addEventListener("click", loadCalibration);
  $("calDeviceSelect")?.addEventListener("change", loadCalibration);

  $("btnSaveBackendUrl")?.addEventListener("click", () => {
    if (isSalesView()) return; // sales safety
    const v = $("backendUrlInput")?.value?.trim();
    if (!v) return;
    setApi(v);
    showToast("Backend saved");
    loadDevices();
  });

  $("refreshSeconds")?.addEventListener("change", e => {
    localStorage.setItem("refreshSeconds", e.target.value);
  });

  // When smoothing settings change, rerender (using last known data next refresh)
  $("psiSmoothingEnabled")?.addEventListener("change", () => loadDevices());
  $("psiSmoothingWindow")?.addEventListener("change", () => loadDevices());

  setInterval(updateRefreshAge, 1000);
  wireTabs();
}

// ---------------- BOOT ----------------
let _refreshTimer = null;

function startAutoRefresh() {
  if (_refreshTimer) clearInterval(_refreshTimer);
  _refreshTimer = setInterval(loadDevices, getRefreshSeconds() * 1000);
}

function boot() {
  applySalesView();

  const backendInput = $("backendUrlInput");
  if (backendInput) backendInput.value = getApi();

  wireUI();
  loadDevices();
  startAutoRefresh();
}

boot();
