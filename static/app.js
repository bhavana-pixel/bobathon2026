// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let formVisible = false;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function fmt(dtStr) {
  // Format an ISO / SQLite datetime string for display
  const d = new Date(dtStr.includes("T") ? dtStr : dtStr.replace(" ", "T") + "Z");
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtPickup(dtStr) {
  // pickup_by is stored without timezone — treat as local
  const d = new Date(dtStr.includes("T") ? dtStr : dtStr.replace(" ", "T"));
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// Board rendering
// ---------------------------------------------------------------------------

async function loadBoard() {
  const res = await fetch("/api/posts");
  const posts = await res.json();

  const board = document.getElementById("board");
  const empty = document.getElementById("empty");

  board.innerHTML = "";

  if (posts.length === 0) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  posts.forEach(post => {
    board.appendChild(buildCard(post));
  });
}

function buildCard(post) {
  const claimed = !!post.claimed_by;
  const card = document.createElement("div");
  card.className = "card" + (claimed ? " claimed" : "");
  card.dataset.id = post.id;

  card.innerHTML = `
    <div class="card-header">
      <span class="card-donor">${esc(post.donor_name)}</span>
      <span class="card-badge ${claimed ? "claimed-badge" : ""}">
        ${claimed ? "Claimed" : "Available"}
      </span>
    </div>
    <div class="card-food">${esc(post.food_description)}</div>
    <div class="card-meta">
      <span>📦 ${esc(post.quantity)}</span>
      <span>📍 ${esc(post.location)}</span>
      <span>⏰ Pick up by ${fmtPickup(post.pickup_by)}</span>
      ${claimed ? `<span>✅ Claimed by ${esc(post.claimed_by)}</span>` : ""}
    </div>
    ${!claimed ? `
    <div class="card-actions">
      <button class="btn-claim" onclick="claimPost(${post.id})">Claim</button>
      <button class="btn-delete" onclick="deletePost(${post.id})">Delete (mine)</button>
    </div>` : ""}
  `;
  return card;
}

function esc(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
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
    // Pre-fill pickup_by with 2 hours from now
    const twoHoursLater = new Date(Date.now() + 2 * 60 * 60 * 1000);
    // datetime-local needs format YYYY-MM-DDTHH:MM
    const local = new Date(twoHoursLater.getTime() - twoHoursLater.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
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
    pickup_by:        document.getElementById("pickup_by").value,   // "YYYY-MM-DDTHH:MM"
  };

  const res = await fetch("/api/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json();
    alert("Error: " + (err.error || "Unknown error"));
    return;
  }

  const data = await res.json();

  // Reset + hide form
  document.getElementById("post-form").reset();
  toggleForm();

  // Show PIN modal
  document.getElementById("pin-value").textContent = data.pin;
  document.getElementById("pin-modal").style.display = "flex";

  // Refresh board
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
    alert("Could not claim: " + (err.error || "Unknown error"));
    return;
  }

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
    alert("Could not delete: " + (err.error || "Unknown error"));
    return;
  }

  loadBoard();
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

loadBoard();
// Auto-refresh every 30 seconds
setInterval(loadBoard, 30_000);
