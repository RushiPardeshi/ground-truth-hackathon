# Receipts: Sales Intelligence on Live Wire
> *"Account intelligence where every claim has receipts."*

Built for the **Ground Truth Hackathon** using the **You.com Search & Contents APIs**.

---

## 💡 The Problem & Our Pitch
Static technographic databases charge five figures a year for millions of company profiles, but claims are opaque, often stale, and lack verifiable provenance. Outbound sales reps pitching five- and six-figure software cannot risk reaching out based on hallucinated or outdated data.

**Receipts** provides on-demand, real-time sales intelligence for **any target account**, where **100% of detected tools, migration triggers, and hiring signals are backed by clickable, verifiable receipts**:
- 🟢 **Confirmed**: Direct client-side HTML `<script>` tags extracted via the You.com Contents API + Vendor Case Studies.
- 🟡 **Strong**: Active ATS job postings across Greenhouse, Lever, and Ashby with verbatim migration language.
- 🔵 **Inferred**: Strategic "Why Now" executive angle with a 1-click cited cold outreach email.
- 📡 **Signal Watcher**: Live real-time diff engine comparing crawls over time to alert reps the minute a new competitor footprint or role appears.

---

## 🎯 The Live Demo: Terms.so Outbound Flywheel
- **The Buyer**: [Terms.so](https://terms.so) (Frictionless, browser-native markdown agreements).
- **The Target Audience**: High-growth design agencies & creative studios (e.g., Pentagram, Huge Inc, IDEO, MetaLab).
- **The Competitors to Displace**: DocuSign, PandaDoc, Adobe Sign.
- **The Value**: Pinpoints agencies hiring for operations roles with legacy contract pain, extracts the exact job post receipt, and drafts a cited outreach email ready to send in 1 click.

---

## 🚀 Quickstart Guide

### 1. Requirements & Setup
Ensure your You.com API key is in `.env`:
```bash
YDC_API_KEY=your_actual_you_com_key_here
```

### 2. Launch Backend & Frontend (One Command)
```bash
./run.sh
```
Or start them independently:

**Backend (FastAPI)**:
```bash
cd backend
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

**Frontend (Next.js 14 + Tailwind)**:
```bash
cd frontend
npm run dev
```

Visit **http://localhost:3000** to view the live dashboard.

---

## 🛠 Project Structure
```
├── .env.example            # Environment template (secrets git-ignored)
├── .gitignore              # Production gitignore protecting .env & node_modules
├── REQUIREMENTS.md         # Full hackathon product requirements & sprint plan
├── run.sh                  # One-click startup script for both servers
├── backend/
│   ├── main.py             # FastAPI REST endpoints (/api/scan, /api/leads/discover)
│   ├── scanner.py          # IntelligenceEngine (You.com Search + Contents + Diff)
│   ├── requirements.txt    # Python dependencies
│   └── snapshots/          # Local JSON snapshot store for Signal Watcher diffs
└── frontend/
    ├── app/
    │   ├── page.tsx        # Receipt-first intelligence dashboard & playbook UI
    │   ├── layout.tsx      # App shell & metadata
    │   └── globals.css     # Dark mode theme & monospace typography
    └── package.json        # Next.js 14, React 18, Tailwind CSS
```

---

## 🏆 Hackathon Judging Alignment
1. **Ground Truth**: Every claim has an interactive `[Inspect Receipt ↗]` button showing the verbatim HTML script tag or ATS job quote with a direct link.
2. **Live Wire / Real-Time**: Scans the live web on demand + features a "Signal Watcher" that detects diffs between crawls.
3. **Business Viability**: Concrete ROI for B2B outbound teams closing deals for Terms.so.
