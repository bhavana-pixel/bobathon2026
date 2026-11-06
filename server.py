import argparse
import hashlib
import random
import sqlite3
import string
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from flask import Flask, g, jsonify, request, send_from_directory

app = Flask(__name__, static_folder="static")
DB_PATH = "foodrescue.db"

# Set to True when server is launched with --demo
DEMO_MODE = False


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_db():
    db = getattr(g, "_database", None)
    if db is None:
        db = g._database = sqlite3.connect(DB_PATH)
        db.row_factory = sqlite3.Row
    return db


@app.teardown_appcontext
def close_db(exc):
    db = getattr(g, "_database", None)
    if db is not None:
        db.close()


# Max claims allowed per device fingerprint within the rolling window
CLAIM_RATE_LIMIT = 3
CLAIM_RATE_WINDOW_HOURS = 24


def device_fingerprint(ip: str, user_agent: str) -> str:
    """Return a stable, opaque hash for an IP + User-Agent pair."""
    raw = f"{ip}|{user_agent}"
    return hashlib.sha256(raw.encode()).hexdigest()


def init_db():
    with sqlite3.connect(DB_PATH) as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS posts (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                donor_name       TEXT    NOT NULL,
                food_description TEXT    NOT NULL,
                quantity         TEXT    NOT NULL,
                pickup_by        TEXT    NOT NULL,
                location         TEXT    NOT NULL,
                pin_hash         TEXT    NOT NULL,
                claimed_by       TEXT,
                created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
                is_demo          INTEGER NOT NULL DEFAULT 0
            )
        """)
        # Add is_demo column to pre-existing databases that lack it
        try:
            db.execute("ALTER TABLE posts ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0")
        except sqlite3.OperationalError:
            pass  # Column already exists
        db.execute("""
            CREATE TABLE IF NOT EXISTS claim_attempts (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                fingerprint TEXT    NOT NULL,
                claimed_at  TEXT    NOT NULL DEFAULT (datetime('now'))
            )
        """)
        db.execute("CREATE INDEX IF NOT EXISTS idx_claim_attempts_fp ON claim_attempts(fingerprint)")
        db.commit()


# ---------------------------------------------------------------------------
# PIN helpers
# ---------------------------------------------------------------------------

def generate_pin():
    return "".join(random.choices(string.digits, k=4))


def hash_pin(pin: str) -> str:
    return hashlib.sha256(pin.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Expiry job
# ---------------------------------------------------------------------------

def expire_posts():
    with sqlite3.connect(DB_PATH) as db:
        db.execute(
            "DELETE FROM posts WHERE pickup_by < datetime('now') AND claimed_by IS NULL AND is_demo = 0"
        )
        # Prune claim_attempts older than the rate-limit window
        db.execute(
            "DELETE FROM claim_attempts WHERE claimed_at < datetime('now', ?)",
            (f"-{CLAIM_RATE_WINDOW_HOURS} hours",)
        )
        db.commit()


# ---------------------------------------------------------------------------
# Demo data helpers
# ---------------------------------------------------------------------------

DEMO_PIN = "0000"

DEMO_ENTRIES = [
    {
        "donor_name": "Green Leaf Café",
        "food_description": "Vegetable pasta bake, garden salad, dinner rolls",
        "quantity": "Feeds ~20 people",
        "location": "123 Main St, back entrance",
        "hours": 3,
        "claimed_by": None,
    },
    {
        "donor_name": "Sunrise Bakery",
        "food_description": "Assorted pastries, croissants, and sourdough loaves",
        "quantity": "~40 items",
        "location": "45 Baker Ave, front counter",
        "hours": 2,
        "claimed_by": None,
    },
    {
        "donor_name": "City Hotel Kitchen",
        "food_description": "Buffet surplus: rice, grilled chicken, roasted vegetables",
        "quantity": "Feeds ~50 people",
        "location": "Grand City Hotel, loading dock (Level B1)",
        "hours": 4,
        "claimed_by": "Downtown Food Bank",
    },
    {
        "donor_name": "FreshMart Superstore",
        "food_description": "Bananas, apples, yoghurt (near best-before)",
        "quantity": "3 crates",
        "location": "FreshMart, 8 Commerce Rd — ask for the duty manager",
        "hours": 5,
        "claimed_by": None,
    },
    {
        "donor_name": "Community Diner",
        "food_description": "Lentil soup, cornbread, mixed fruit salad",
        "quantity": "Feeds ~30 people",
        "location": "77 Elm Street, side door",
        "hours": 2,
        "claimed_by": None,
    },
]


def seed_demo():
    """Insert demo entries into the database (clears existing demo rows first)."""
    clear_demo()
    with sqlite3.connect(DB_PATH) as db:
        db.execute("DELETE FROM claim_attempts")
        db.commit()
    now = datetime.now(timezone.utc)
    with sqlite3.connect(DB_PATH) as db:
        for entry in DEMO_ENTRIES:
            pickup_by = (now + timedelta(hours=entry["hours"])).strftime("%Y-%m-%d %H:%M:%S")
            db.execute(
                "INSERT INTO posts "
                "(donor_name, food_description, quantity, pickup_by, location, pin_hash, claimed_by, is_demo) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
                (
                    entry["donor_name"],
                    entry["food_description"],
                    entry["quantity"],
                    pickup_by,
                    entry["location"],
                    hash_pin(DEMO_PIN),
                    entry["claimed_by"],
                ),
            )
        db.commit()


def clear_demo():
    """Remove all demo entries from the database."""
    with sqlite3.connect(DB_PATH) as db:
        db.execute("DELETE FROM posts WHERE is_demo = 1")
        db.commit()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/about")
def about():
    return send_from_directory("static", "about.html")


@app.route("/api/demo/status", methods=["GET"])
def demo_status():
    return jsonify({"demo_mode": DEMO_MODE})


@app.route("/api/demo/seed", methods=["POST"])
def demo_seed():
    if not DEMO_MODE:
        return jsonify({"error": "Not in demo mode"}), 403
    seed_demo()
    return jsonify({"ok": True, "pin": DEMO_PIN})


@app.route("/api/demo/clear", methods=["DELETE"])
def demo_clear():
    if not DEMO_MODE:
        return jsonify({"error": "Not in demo mode"}), 403
    clear_demo()
    return jsonify({"ok": True})


@app.route("/api/posts", methods=["GET"])
def get_posts():
    db = get_db()
    rows = db.execute(
        "SELECT id, donor_name, food_description, quantity, pickup_by, location, claimed_by, created_at, is_demo "
        "FROM posts WHERE pickup_by > datetime('now') ORDER BY created_at DESC"
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/posts", methods=["POST"])
def create_post():
    data = request.get_json(force=True)
    required = ("donor_name", "food_description", "quantity", "pickup_by", "location")
    if not all(data.get(f) for f in required):
        return jsonify({"error": "Missing required fields"}), 400

    # pickup_by arrives as a naive local datetime string ("YYYY-MM-DDTHH:MM").
    # Parse it as local time and convert to UTC so comparisons against
    # SQLite's datetime('now') (which is always UTC) are correct.
    try:
        pickup_local = datetime.fromisoformat(data["pickup_by"])
        pickup_utc = pickup_local.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid pickup_by format"}), 400

    pin = generate_pin()
    db = get_db()
    cur = db.execute(
        "INSERT INTO posts (donor_name, food_description, quantity, pickup_by, location, pin_hash, is_demo) "
        "VALUES (?, ?, ?, ?, ?, ?, 0)",
        (data["donor_name"], data["food_description"], data["quantity"],
         pickup_utc, data["location"], hash_pin(pin)),
    )
    db.commit()
    return jsonify({"id": cur.lastrowid, "pin": pin}), 201


@app.route("/api/posts/<int:post_id>/claim", methods=["POST"])
def claim_post(post_id):
    data = request.get_json(force=True)
    claimed_by = data.get("claimed_by", "").strip()
    if not claimed_by:
        return jsonify({"error": "claimed_by is required"}), 400

    # --- Rate limiting: max CLAIM_RATE_LIMIT claims per device per 24 h ---
    ip = request.remote_addr or ""
    ua = request.headers.get("User-Agent", "")
    fp = device_fingerprint(ip, ua)

    db = get_db()
    window_start = (datetime.now(timezone.utc) - timedelta(hours=CLAIM_RATE_WINDOW_HOURS)).strftime("%Y-%m-%d %H:%M:%S")
    recent = db.execute(
        "SELECT COUNT(*) FROM claim_attempts WHERE fingerprint = ? AND claimed_at >= ?",
        (fp, window_start)
    ).fetchone()[0]
    if recent >= CLAIM_RATE_LIMIT:
        return jsonify({
            "error": f"Rate limit exceeded: you may only claim {CLAIM_RATE_LIMIT} items per {CLAIM_RATE_WINDOW_HOURS}-hour period."
        }), 429
    # ----------------------------------------------------------------------

    row = db.execute(
        "SELECT id, claimed_by FROM posts WHERE id = ? AND pickup_by > datetime('now')",
        (post_id,)
    ).fetchone()
    if row is None:
        return jsonify({"error": "Post not found or expired"}), 404
    if row["claimed_by"]:
        return jsonify({"error": "Already claimed"}), 409

    db.execute("UPDATE posts SET claimed_by = ? WHERE id = ?", (claimed_by, post_id))
    db.execute("INSERT INTO claim_attempts (fingerprint) VALUES (?)", (fp,))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/posts/<int:post_id>", methods=["DELETE"])
def delete_post(post_id):
    data = request.get_json(force=True)
    pin = data.get("pin", "")
    if not pin:
        return jsonify({"error": "pin is required"}), 400

    db = get_db()
    row = db.execute("SELECT pin_hash FROM posts WHERE id = ?", (post_id,)).fetchone()
    if row is None:
        return jsonify({"error": "Post not found"}), 404
    if row["pin_hash"] != hash_pin(pin):
        return jsonify({"error": "Incorrect PIN"}), 403

    db.execute("DELETE FROM posts WHERE id = ?", (post_id,))
    db.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="FoodRescue server")
    parser.add_argument(
        "--demo",
        action="store_true",
        help="Run in demo mode: seeds sample entries and exposes /api/demo/* endpoints",
    )
    parser.add_argument("--port", type=int, default=5000)
    args = parser.parse_args()

    DEMO_MODE = args.demo

    init_db()

    if DEMO_MODE:
        seed_demo()
        print("🎬 Demo mode active — sample entries loaded. PIN for all demo posts: 0000")

    scheduler = BackgroundScheduler()
    scheduler.add_job(expire_posts, "interval", seconds=60)
    scheduler.start()
    app.run(debug=True, port=args.port)
