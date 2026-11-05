import hashlib
import random
import sqlite3
import string
from datetime import datetime

from apscheduler.schedulers.background import BackgroundScheduler
from flask import Flask, g, jsonify, request, send_from_directory

app = Flask(__name__, static_folder="static")
DB_PATH = "foodrescue.db"


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
                created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
            )
        """)
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
            "DELETE FROM posts WHERE pickup_by < datetime('now') AND claimed_by IS NULL"
        )
        db.commit()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/api/posts", methods=["GET"])
def get_posts():
    db = get_db()
    rows = db.execute(
        "SELECT id, donor_name, food_description, quantity, pickup_by, location, claimed_by, created_at "
        "FROM posts WHERE pickup_by > datetime('now') ORDER BY created_at DESC"
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/posts", methods=["POST"])
def create_post():
    data = request.get_json(force=True)
    required = ("donor_name", "food_description", "quantity", "pickup_by", "location")
    if not all(data.get(f) for f in required):
        return jsonify({"error": "Missing required fields"}), 400

    pin = generate_pin()
    db = get_db()
    cur = db.execute(
        "INSERT INTO posts (donor_name, food_description, quantity, pickup_by, location, pin_hash) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (data["donor_name"], data["food_description"], data["quantity"],
         data["pickup_by"], data["location"], hash_pin(pin)),
    )
    db.commit()
    return jsonify({"id": cur.lastrowid, "pin": pin}), 201


@app.route("/api/posts/<int:post_id>/claim", methods=["POST"])
def claim_post(post_id):
    data = request.get_json(force=True)
    claimed_by = data.get("claimed_by", "").strip()
    if not claimed_by:
        return jsonify({"error": "claimed_by is required"}), 400

    db = get_db()
    row = db.execute(
        "SELECT id, claimed_by FROM posts WHERE id = ? AND pickup_by > datetime('now')",
        (post_id,)
    ).fetchone()
    if row is None:
        return jsonify({"error": "Post not found or expired"}), 404
    if row["claimed_by"]:
        return jsonify({"error": "Already claimed"}), 409

    db.execute("UPDATE posts SET claimed_by = ? WHERE id = ?", (claimed_by, post_id))
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
    init_db()
    scheduler = BackgroundScheduler()
    scheduler.add_job(expire_posts, "interval", seconds=60)
    scheduler.start()
    app.run(debug=True, port=5000)
