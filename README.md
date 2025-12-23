# Outfit Picker (AI Try-On)

A local-first web app that lets you upload your wardrobe (tops + bottoms) + a reference photo of yourself, browse items in two carousels, add a theme prompt, and generate an AI try-on image.

Built as a learning project to understand full-stack workflows: **Next.js frontend ↔ FastAPI backend ↔ file storage ↔ AI generation API**.

---

## Features

- **Upload wardrobe items** (tops & bottoms) with optional tags
- **Upload reference photos** (you)
- **Two carousels** (tops + bottoms) to select an outfit
- **Theme prompt** (e.g., “streetwear”, “formal”, “cozy winter”)
- **Generate endpoint** that creates an output image and serves it back to the frontend
- **Local storage** for images + a simple JSON “DB”
- **Caching**: same (ref + top + bottom + theme) returns the same output without re-generating
- **Fallback mode**: if the AI provider fails / quota is exceeded, backend can return a placeholder output so you can still test the full pipeline

---

## Tech Stack

**Frontend**
- Next.js (App Router)
- React
- Tailwind CSS

**Backend**
- FastAPI + Uvicorn
- Local file storage (`/storage`)
- JSON DB (`storage/db.json`)
- Gemini API via `google-genai` (model configurable)

---

## Project Structure

outfit-picker/
  frontend/                 # Next.js app
  backend/                  # FastAPI app
  storage/                  # local storage (created at runtime)
    clothes/                # uploaded tops/bottoms
    user/                   # reference photos
    outputs/                # generated images
    db.json                 # simple JSON db

Setup
1) Clone and install dependencies
Frontend

cd frontend
npm install

Backend

cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

    If PowerShell blocks scripts, you may need:
    Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

Environment Variables
Frontend: frontend/.env.local

Create a file at frontend/.env.local:

NEXT_PUBLIC_API_BASE=http://localhost:8000

Backend: backend/.env

Create a file at backend/.env:

GEMINI_API_KEY=YOUR_KEY_HERE
NANOBANANA_MODEL=gemini-2.5-flash-preview-image

Notes:

    The backend uses google-genai and reads GEMINI_API_KEY from environment variables.

    Model name is configurable via NANOBANANA_MODEL.

Run Locally
1) Start backend

From backend/:

.\.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000

Backend will serve:

    API at http://localhost:8000

    Static files at http://localhost:8000/static/...

2) Start frontend

From frontend/:

npm run dev

Open:

    http://localhost:3000

Usage

    Upload one reference photo (you)

    Upload tops and bottoms (optional tags)

    Use the tops carousel + bottoms carousel to select items

    Add an optional theme prompt

    Press Generate

    The generated image appears on the right side of the UI

API Endpoints (Backend)

    GET /health

    POST /upload/reference (multipart: file)

    POST /upload/clothing (multipart: file, item_type, tags)

    GET /wardrobe/tops

    GET /wardrobe/bottoms

    GET /user/refs

    POST /generate (json: { top_id, bottom_id, theme })

Optional (if you added delete support):

    DELETE /clothing/{id}

    DELETE /refs/{id}

Troubleshooting
“429 RESOURCE_EXHAUSTED” (Gemini quota)

This means your API key/project has hit quota limits or billing isn’t enabled for the model you’re calling.

What you can do:

    Check Google AI Studio / Gemini API usage + limits

    Enable billing / request higher quota

    Keep using the app with fallback mode for UI testing until quota is resolved

Images not showing

    Confirm NEXT_PUBLIC_API_BASE points to your backend (default http://localhost:8000)

    Confirm backend is running and /static/... URLs load in browser

Roadmap / Next Improvements

    Smart “auto-pick outfit” from theme prompt

    Better wardrobe tagging + filtering

    Let user choose which reference photo to use

    Real virtual try-on improvements (segmentation / pose / background)

    Deploy (Vercel for frontend + Render/Fly.io for backend)

Disclaimer

This is a personal learning project. Generated results depend heavily on the AI model, image quality, and prompt design. Always respect privacy and avoid uploading sensitive images.
