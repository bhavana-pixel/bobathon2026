# 🌱 FoodRescue

> Connect surplus food with people who need it — before it's too late.

FoodRescue is a lightweight web app that bridges the gap between food donors (restaurants, cafeterias, bakeries) and recipients (shelters, food banks, individuals) by giving them a dead-simple, real-time board to post and claim surplus food before it goes to waste.

Built at **Bobathon 2026** in under 1.5 hours.

---

## Features

- **Post surplus food** — donors post food with a description, quantity, location, and pickup window
- **Claim food** — recipients claim available posts with their name
- **Auto-expiry** — posts disappear automatically after the pickup window closes
- **Urgency countdowns** — live timers on each card turn amber then red as the deadline approaches
- **Search & sort** — filter by keyword or sort by newest / expiring soonest / available only
- **PIN-protected deletion** — donors get a 4-digit PIN to delete their own posts (no accounts needed)
- **Dark / Light mode** — toggle with preference saved to localStorage
- **About Us page** — accessible from the header on every page
- **Demo mode** — seed the board with sample data via `--demo` flag

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python · Flask |
| Database | SQLite (zero setup) |
| Scheduler | APScheduler (auto-expiry) |
| Frontend | Vanilla HTML · CSS · JavaScript (no build step) |

---

## Getting Started

**1. Install dependencies**
```bash
pip install -r requirements.txt
```

**2. Run the server**
```bash
python server.py
```

**3. Open in your browser**
```
http://localhost:5000
```

**4. (Optional) Run with sample data**
```bash
python server.py --demo
```

---

## Project Structure

```
foodrescue/
├── server.py          # Flask backend — API routes, DB, expiry scheduler
├── foodrescue.db      # SQLite database (auto-created on first run)
├── requirements.txt   # flask, apscheduler
└── static/
    ├── index.html     # Main board page
    ├── about.html     # About Us page
    ├── app.js         # All frontend logic
    └── style.css      # Styles + dark/light theme tokens
```

---

## API Endpoints

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/posts` | List all active (non-expired) posts |
| `POST` | `/api/posts` | Create a new post → returns `{ id, pin }` |
| `POST` | `/api/posts/<id>/claim` | Claim a post |
| `DELETE` | `/api/posts/<id>` | Delete a post using its PIN |

---

## Our Mission

We built FoodRescue to help food insecure families all across the world. With rising poverty rates and world hunger, we are committed to solving food insecurity through technology.

---

*🌱 FoodRescue™ · All rights reserved · © 2026*
