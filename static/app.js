// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let formVisible = false;
let demoMode    = false;
let allPosts    = [];   // master list fetched from server

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function fmtPickup(dtStr) {
  // pickup_by is stored in UTC — append "Z" so the browser converts to local time
  const normalized = dtStr.includes("T") ? dtStr : dtStr.replace(" ", "T");
  const d = new Date(normalized.endsWith("Z") ? normalized : normalized + "Z");
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function pickupDate(dtStr) {
  const normalized = dtStr.includes("T") ? dtStr : dtStr.replace(" ", "T");
  return new Date(normalized.endsWith("Z") ? normalized : normalized + "Z");
}

function esc(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// ---------------------------------------------------------------------------
// Feature 1: Countdown helpers
// ---------------------------------------------------------------------------

function countdownText(dtStr) {
  const diff = pickupDate(dtStr) - Date.now();
  if (diff <= 0) return null;
  const totalMins = Math.floor(diff / 60000);
  const hrs  = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hrs > 0) return `${hrs}h ${mins}m left`;
  return `${mins}m left`;
}

function countdownClass(dtStr) {
  const diff = pickupDate(dtStr) - Date.now();
  const mins = diff / 60000;
  if (mins <= 30)  return "critical";
  if (mins <= 120) return "urgent";
  return "ok";
}

// Tick all countdown chips on the page every 30 s
function tickCountdowns() {
  document.querySelectorAll("[data-pickup]").forEach(el => {
    const dtStr = el.dataset.pickup;
    const text  = countdownText(dtStr);
    if (!text) {
      // expired mid-session — remove the card and reload
      loadBoard();
      return;
    }
    el.textContent = "⏱ " + text;
    el.className = "countdown " + countdownClass(dtStr);
  });
}

// ---------------------------------------------------------------------------
// Feature 2: Toast notifications
// ---------------------------------------------------------------------------

function showToast(message, type = "success", duration = 3500) {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = "toast" + (type !== "success" ? " " + type : "");
  const icon = type === "error" ? "✕" : type === "warning" ? "⚠️" : "✓";
  toast.textContent = icon + "  " + message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("removing");
    toast.addEventListener("animationend", () => toast.remove());
  }, duration);
}

// ---------------------------------------------------------------------------
// Board rendering
// ---------------------------------------------------------------------------

async function loadBoard() {
  const res = await fetch("/api/posts");
  allPosts = await res.json();
  applyFilters();
}

// Feature 3 & 4: apply search + sort and render
function applyFilters() {
  const query  = (document.getElementById("search-input")?.value || "").toLowerCase().trim();
  const sort   = document.getElementById("sort-select")?.value || "newest";

  let posts = [...allPosts];

  // Filter: available only
  if (sort === "available") {
    posts = posts.filter(p => !p.claimed_by);
  }

  // Search across food, donor, location
  if (query) {
    posts = posts.filter(p =>
      p.food_description.toLowerCase().includes(query) ||
      p.donor_name.toLowerCase().includes(query) ||
      p.location.toLowerCase().includes(query)
    );
  }

  // Sort
  if (sort === "expiry") {
    posts.sort((a, b) => pickupDate(a.pickup_by) - pickupDate(b.pickup_by));
  } else {
    // newest (default) — already sorted by created_at DESC from server
  }

  const board = document.getElementById("board");
  const empty = document.getElementById("empty");
  board.innerHTML = "";

  if (posts.length === 0) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  posts.forEach(post => board.appendChild(buildCard(post)));
}

function buildCard(post) {
  const claimed = !!post.claimed_by;
  const isDemo  = !!post.is_demo;
  const card = document.createElement("div");
  card.className = "card" + (claimed ? " claimed" : "") + (isDemo ? " demo-card" : "");
  card.dataset.id = post.id;

  // Feature 1: countdown chip
  const cdText  = !claimed ? countdownText(post.pickup_by) : null;
  const cdClass = !claimed && cdText ? countdownClass(post.pickup_by) : "ok";
  const countdownChip = cdText
    ? `<span class="countdown ${cdClass}" data-pickup="${post.pickup_by}">⏱ ${esc(cdText)}</span>`
    : "";

  card.innerHTML = `
    <div class="card-header">
      <span class="card-donor">${esc(post.donor_name)}</span>
      <div style="display:flex;gap:6px;align-items:center">
        ${isDemo ? `<span class="demo-pill">Sample</span>` : ""}
        <span class="card-badge ${claimed ? "claimed-badge" : ""}">
          ${claimed ? "Claimed" : "Available"}
        </span>
      </div>
    </div>
    <div class="card-food">${esc(post.food_description)}</div>
    <div class="card-meta">
      <span>📦 ${esc(post.quantity)}</span>
      <span>📍 ${esc(post.location)}</span>
      <span>⏰ Pick up by ${fmtPickup(post.pickup_by)}</span>
      ${countdownChip}
      ${claimed ? `<span>✅ Claimed by ${esc(post.claimed_by)}</span>` : ""}
    </div>
    ${!claimed ? `
    <div class="card-actions">
      <button class="btn-claim" onclick="claimPost(${post.id})">Claim</button>
      <button class="btn-delete" onclick="deletePost(${post.id})">${isDemo ? "Delete (PIN: 0000)" : "Delete (mine)"}</button>
    </div>` : ""}
  `;
  return card;
}

// ---------------------------------------------------------------------------
// Toggle post form
// ---------------------------------------------------------------------------

function toggleForm() {
  formVisible = !formVisible;
  const container = document.getElementById("post-form-container");
  const btn = document.getElementById("toggle-form-btn");
  container.style.display = formVisible ? "block" : "none";
  btn.textContent = formVisible ? "✕ Cancel" : "+ Post Food";

  if (formVisible) {
    const twoHoursLater = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const local = new Date(twoHoursLater.getTime() - twoHoursLater.getTimezoneOffset() * 60000)
      .toISOString().slice(0, 16);
    document.getElementById("pickup_by").value = local;
    document.getElementById("donor_name").focus();
  }
}

// ---------------------------------------------------------------------------
// Submit new post
// ---------------------------------------------------------------------------

async function submitPost(e) {
  e.preventDefault();
  const body = {
    donor_name:       document.getElementById("donor_name").value.trim(),
    food_description: document.getElementById("food_description").value.trim(),
    quantity:         document.getElementById("quantity").value.trim(),
    location:         document.getElementById("location").value.trim(),
    pickup_by:        document.getElementById("pickup_by").value,
  };

  const res = await fetch("/api/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json();
    showToast(err.error || "Could not post food.", "error");
    return;
  }

  const data = await res.json();
  document.getElementById("post-form").reset();
  toggleForm();
  document.getElementById("pin-value").textContent = data.pin;
  document.getElementById("pin-modal").style.display = "flex";
  showToast("Food posted successfully!");
  loadBoard();
}

// ---------------------------------------------------------------------------
// PIN modal
// ---------------------------------------------------------------------------

function closePinModal() {
  document.getElementById("pin-modal").style.display = "none";
}

// ---------------------------------------------------------------------------
// Claim a post
// ---------------------------------------------------------------------------

async function claimPost(id) {
  const claimed_by = prompt("Your name or organization (shelter, food bank, etc.):");
  if (!claimed_by || !claimed_by.trim()) return;

  const res = await fetch(`/api/posts/${id}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ claimed_by: claimed_by.trim() }),
  });

  if (!res.ok) {
    const err = await res.json();
    showToast(err.error || "Could not claim post.", "error");
    return;
  }

  showToast("Post claimed! 🎉 Thank you for helping.");
  loadBoard();
}

// ---------------------------------------------------------------------------
// Delete a post
// ---------------------------------------------------------------------------

async function deletePost(id) {
  const pin = prompt("Enter your 4-digit PIN to delete this post:");
  if (!pin) return;

  const res = await fetch(`/api/posts/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin }),
  });

  if (!res.ok) {
    const err = await res.json();
    showToast(err.error || "Could not delete post.", "error");
    return;
  }

  showToast("Post deleted.", "warning");
  loadBoard();
}

// ---------------------------------------------------------------------------
// Demo mode controls
// ---------------------------------------------------------------------------

async function initDemoMode() {
  const res = await fetch("/api/demo/status");
  const data = await res.json();
  demoMode = data.demo_mode;
  if (demoMode) {
    document.getElementById("demo-banner").style.display = "block";
  }
}

async function demoSeed() {
  const res = await fetch("/api/demo/seed", { method: "POST" });
  if (!res.ok) { showToast("Could not seed demo data.", "error"); return; }
  showToast("Sample posts loaded.");
  loadBoard();
}

async function demoClear() {
  const res = await fetch("/api/demo/clear", { method: "DELETE" });
  if (!res.ok) { showToast("Could not clear demo data.", "error"); return; }
  showToast("Sample posts cleared.", "warning");
  loadBoard();
}

// ---------------------------------------------------------------------------
// Theme toggle
// ---------------------------------------------------------------------------

function applyTheme(dark) {
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  document.getElementById("theme-icon").textContent  = dark ? "☀️" : "🌙";
  document.getElementById("theme-label").textContent = dark ? "Light" : "Dark";
}

function toggleTheme() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const next = !isDark;
  applyTheme(next);
  localStorage.setItem("fr-theme", next ? "dark" : "light");
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

applyTheme(localStorage.getItem("fr-theme") === "dark");

initDemoMode();
loadBoard();

// Tick countdowns every 30 s; reload board every 30 s
setInterval(tickCountdowns, 30_000);
setInterval(loadBoard, 30_000);
