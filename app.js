// PlasmaStrike Frontend - SIMPLE, STABLE VERSION
// Works with your current index.html
// No crashes, no missing IDs, sales-safe

const DEFAULT_API = "https://api.plasma-strike.com";

const $ = (id) => document.getElementById(id);

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
  return (localStorage.getItem("apiBase") || DEFAULT_API).replace(/\/+$/, "");
}

function setApi(url) {
  localStorage.setItem("apiBase", url.replace(/\/+$/, ""));
}

function getRefreshSeconds() {
  return Number(localStorage.getItem("refreshSeconds") || 5);
}

// ---------------- DATA ----------------
let lastRefresh = Date.now();

function updateRefreshAge() {
  const el = $("refreshAge");
  if (!el) return;
  el.textContent = Math.floor((Date.now() - lastRefresh) / 1000);
}

// ---------------- FETCH HELPERS ----------------
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

// ---------------- DEVICES ----------------
async function loadDevices() {
  const api = getApi();

  try {
    await fetchJSON(`${api}/health`);
    setBackendBadge("Backend: OK", true);
  } catch {
    setBackendBadge("Backend: OFFLINE", false);
    $("deviceCount").textContent = "0";
    $("devicesGrid").innerHTML = "";
    $("devicesEmpty").classList.remove("hidden");
    return;
  }

  try {
    const data = await fetchJSON(`${api}/api/devices`);
    const devices = data.devices || [];

    $("deviceCount").textContent = devices.length;
    lastRefresh = Date.now();

    if (!devices.length) {
      $("devicesGrid").innerHTML = "";
      $("devicesEmpty").classList.remove("hidden");
      return;
    }

    $("devicesEmpty").classList.add("hidden");

    $("devicesGrid").innerHTML = devices.map(d => `
      <div class="card">
        <div><b>Status:</b> ${d.isOnline ? "🟢 Online" : "🔴 Offline"}</div>
        <div><b>MAC:</b> ${d.mac || d.macAddress}</div>
        <div><b>Last seen:</b> ${d.lastSeen || "—"}</div>
        <div><b>PSI:</b> ${d.psi ?? "—"}</div>
      </div>
    `).join("");

  } catch (e) {
    showToast("Device fetch failed");
  }
}

// ---------------- LOGS ----------------
async function loadLogs() {
  const api = getApi();
  const box = $("logsBox");
  if (!box) return;

  box.textContent = "Loading…";

  try {
    const data = await fetchJSON(`${api}/api/service-logs?limit=100`);
    box.textContent = JSON.stringify(data.logs || data, null, 2);
  } catch {
    box.textContent = "Logs not available";
  }
}

// ---------------- CALIBRATION ----------------
async function loadCalibration() {
  const api = getApi();
  const sel = $("calDeviceSelect");
  const box = $("calBox");

  if (!sel || !box || !sel.value) {
    box.textContent = "Select a device…";
    return;
  }

  try {
    const data = await fetchJSON(`${api}/api/devices/${sel.value}`);
    box.textContent = JSON.stringify(data, null, 2);
  } catch {
    box.textContent = "Calibration load failed";
  }
}

// ---------------- WIRING ----------------
function wireUI() {
  $("btnRefreshNow")?.addEventListener("click", loadDevices);
  $("btnLogsRefresh")?.addEventListener("click", loadLogs);
  $("btnCalRefresh")?.addEventListener("click", loadCalibration);
  $("calDeviceSelect")?.addEventListener("change", loadCalibration);

  $("btnSaveBackendUrl")?.addEventListener("click", () => {
    const v = $("backendUrlInput").value.trim();
    if (!v) return;
    setApi(v);
    showToast("Backend saved");
    loadDevices();
  });

  $("refreshSeconds")?.addEventListener("change", e => {
    localStorage.setItem("refreshSeconds", e.target.value);
  });

  setInterval(updateRefreshAge, 1000);
}

// ---------------- BOOT ----------------
function boot() {
  $("backendUrlInput").value = getApi();
  wireUI();
  loadDevices();
  setInterval(loadDevices, getRefreshSeconds() * 1000);
}

boot();
