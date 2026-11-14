#!/bin/bash
# Runner script to start both FastAPI Backend and Next.js Frontend

echo "🚀 Starting Receipts (Sumble on Live Wire)..."

# Trap CTRL+C to cleanly kill both processes
trap 'kill 0' SIGINT

# Start Backend on port 8000
echo "📦 Starting FastAPI Backend on http://localhost:8000..."
(cd backend && python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload) &

# Start Frontend on port 3000
echo "💻 Starting Next.js Frontend on http://localhost:3000..."
(cd frontend && npm run dev) &

# Wait for all background processes
wait
