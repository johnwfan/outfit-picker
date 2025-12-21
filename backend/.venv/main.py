from __future__ import annotations

import json
import os
import hashlib
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from google import genai
from google.genai import types
from google.genai.errors import ClientError

# -----------------------------
# Config / Environment
# -----------------------------
load_dotenv()  # reads backend/.env if present

NANOBANANA_MODEL = os.getenv("NANOBANANA_MODEL", "gemini-2.5-flash-image")
# If you accidentally set a preview model, you can force the stable one:
# NANOBANANA_MODEL = "gemini-2.5-flash-image"

client = genai.Client()  # uses GEMINI_API_KEY/GOOGLE_API_KEY from env

# -----------------------------
# Paths
# -----------------------------
BACKEND_DIR = Path(__file__).resolve().parent
ROOT_DIR = BACKEND_DIR.parent
STORAGE_DIR = ROOT_DIR / "storage"

CLOTHES_DIR = STORAGE_DIR / "clothes"
USER_DIR = STORAGE_DIR / "user"
OUTPUTS_DIR = STORAGE_DIR / "outputs"

DB_PATH = STORAGE_DIR / "db.json"


def ensure_dirs() -> None:
    CLOTHES_DIR.mkdir(parents=True, exist_ok=True)
    USER_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)


def _fresh_db() -> dict[str, Any]:
    return {"clothes": [], "refs": [], "generations": []}


def load_db() -> dict[str, Any]:
    ensure_dirs()
    if not DB_PATH.exists():
        return _fresh_db()

    try:
        db = json.loads(DB_PATH.read_text(encoding="utf-8"))
        # Harden shape
        if "clothes" not in db: db["clothes"] = []
        if "refs" not in db: db["refs"] = []
        if "generations" not in db: db["generations"] = []
        return db
    except json.JSONDecodeError:
        return _fresh_db()


def save_db(db: dict[str, Any]) -> None:
    ensure_dirs()
    DB_PATH.write_text(json.dumps(db, indent=2), encoding="utf-8")


def guess_mime_type(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext == ".png":
        return "image/png"
    if ext in [".jpg", ".jpeg"]:
        return "image/jpeg"
    if ext == ".webp":
        return "image/webp"
    # fallback
    return "image/png"


def save_upload(file: UploadFile, folder: Path) -> str:
    """
    Saves an uploaded file to folder with a uuid filename.
    Returns the saved filename.
    """
    ensure_dirs()

    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in [".png", ".jpg", ".jpeg", ".webp"]:
        suffix = ".png"

    filename = f"{uuid4().hex}{suffix}"
    out_path = folder / filename

    # read uploaded file into bytes
    content = file.file.read()
    out_path.write_bytes(content)
    return filename


# -----------------------------
# App
# -----------------------------
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ensure_dirs()
app.mount("/static", StaticFiles(directory=str(STORAGE_DIR)), name="static")


@app.get("/health")
def health():
    return {"status": "ok", "model": NANOBANANA_MODEL}


# -----------------------------
# Upload endpoints
# -----------------------------
@app.post("/upload/clothing")
def upload_clothing(
    item_type: str = Form(...),  # "top" or "bottom"
    tags: str = Form(""),        # optional comma-separated string
    file: UploadFile = File(...),
):
    t = item_type.strip().lower()
    if t not in {"top", "bottom"}:
        return {"ok": False, "error": "item_type must be 'top' or 'bottom'"}

    filename = save_upload(file, CLOTHES_DIR)
    tag_list = [x.strip() for x in tags.split(",") if x.strip()]

    db = load_db()
    item_id = uuid4().hex
    record = {
        "id": item_id,
        "type": t,
        "filename": filename,
        "tags": tag_list,
        "url": f"/static/clothes/{filename}",
    }
    db["clothes"].append(record)
    save_db(db)

    return {"ok": True, "item": record}


@app.post("/upload/reference")
def upload_reference(file: UploadFile = File(...)):
    filename = save_upload(file, USER_DIR)

    db = load_db()
    ref_id = uuid4().hex
    record = {
        "id": ref_id,
        "filename": filename,
        "url": f"/static/user/{filename}",
    }
    db["refs"].append(record)
    save_db(db)

    return {"ok": True, "ref": record}


# -----------------------------
# List endpoints
# -----------------------------
@app.get("/wardrobe/tops")
def wardrobe_tops():
    db = load_db()
    tops = [c for c in db["clothes"] if c.get("type") == "top"]
    return {"ok": True, "items": tops}


@app.get("/wardrobe/bottoms")
def wardrobe_bottoms():
    db = load_db()
    bottoms = [c for c in db["clothes"] if c.get("type") == "bottom"]
    return {"ok": True, "items": bottoms}


@app.get("/user/refs")
def user_refs():
    db = load_db()
    return {"ok": True, "refs": db["refs"]}


# -----------------------------
# Generation
# -----------------------------
class GenerateRequest(BaseModel):
    top_id: str
    bottom_id: str
    theme: str = ""


def _stub_copy_latest_ref_to_output(db: dict[str, Any], theme: str, top_id: str, bottom_id: str):
    """Fallback output for when API fails/quota issues: copy latest ref into outputs."""
    refs = db.get("refs", [])
    if not refs:
        raise HTTPException(status_code=400, detail="No reference photo uploaded")

    ref = refs[-1]
    src = USER_DIR / ref["filename"]
    if not src.exists():
        raise HTTPException(status_code=500, detail="Reference file missing on disk")

    out_name = f"{uuid4().hex}.png"
    dst = OUTPUTS_DIR / out_name
    shutil.copyfile(src, dst)

    output_url = f"/static/outputs/{out_name}"
    gen_record = {
        "id": uuid4().hex,
        "cache_key": None,
        "ref_id": ref["id"],
        "top_id": top_id,
        "bottom_id": bottom_id,
        "theme": theme,
        "model": "stub-copy-ref",
        "output_url": output_url,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    db["generations"].append(gen_record)
    save_db(db)
    return {"ok": True, "output_url": output_url, "generation": gen_record, "fallback": True}


@app.post("/generate")
def generate(req: GenerateRequest):
    db = load_db()

    refs = db.get("refs", [])
    if not refs:
        raise HTTPException(status_code=400, detail="No reference photo uploaded")

    clothes = db.get("clothes", [])
    top = next((c for c in clothes if c.get("id") == req.top_id), None)
    bottom = next((c for c in clothes if c.get("id") == req.bottom_id), None)

    if not top:
        raise HTTPException(status_code=400, detail="top_id not found")
    if not bottom:
        raise HTTPException(status_code=400, detail="bottom_id not found")

    ref = refs[-1]
    ref_path = USER_DIR / ref["filename"]
    top_path = CLOTHES_DIR / top["filename"]
    bottom_path = CLOTHES_DIR / bottom["filename"]

    if not ref_path.exists():
        raise HTTPException(status_code=500, detail="Reference file missing on disk")
    if not top_path.exists():
        raise HTTPException(status_code=500, detail="Top file missing on disk")
    if not bottom_path.exists():
        raise HTTPException(status_code=500, detail="Bottom file missing on disk")

    theme = (req.theme or "").strip()

    # ---- Caching ----
    cache_raw = f"{ref['id']}|{req.top_id}|{req.bottom_id}|{theme}".encode("utf-8")
    cache_key = hashlib.sha256(cache_raw).hexdigest()

    existing = next((g for g in db["generations"] if g.get("cache_key") == cache_key), None)
    if existing:
        out_file = OUTPUTS_DIR / os.path.basename(existing["output_url"])
        if out_file.exists():
            return {"ok": True, "output_url": existing["output_url"], "generation": existing, "cached": True}

    # ---- Prompt ----
    prompt = f"""
You are generating a photorealistic try-on image.

INPUTS:
- Image 1: person identity reference photo. Preserve the person's face, hairstyle, skin tone, and body proportions.
- Image 2: TOP garment photo. Use this exact top (same colors/patterns/logos).
- Image 3: BOTTOM garment photo. Use this exact bottom (same colors/patterns/logos).

TASK:
Generate a single full-body (or 3/4 body) photo of the person from Image 1 wearing the top from Image 2 and the bottom from Image 3.

CONSTRAINTS:
- Do NOT change the person's identity.
- Do NOT invent extra clothing items.
- Keep the outfit exactly those two garments.
- Neutral background, realistic lighting, clean result.
- No nudity.

THEME (optional): {theme if theme else "none"}
""".strip()

    def read_bytes(path: Path) -> bytes:
        return path.read_bytes()

    contents = [
        prompt,
        types.Part.from_bytes(data=read_bytes(ref_path), mime_type=guess_mime_type(ref_path.name)),
        types.Part.from_bytes(data=read_bytes(top_path), mime_type=guess_mime_type(top_path.name)),
        types.Part.from_bytes(data=read_bytes(bottom_path), mime_type=guess_mime_type(bottom_path.name)),
    ]

    # ---- Call Gemini (Nano Banana) ----
    try:
        response = client.models.generate_content(
            model=NANOBANANA_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                image_config=types.ImageConfig(aspect_ratio="3:4")
            ),
        )
    except ClientError as e:
        # If quota/rate-limited, return a clean 429 AND/OR fallback
        if getattr(e, "status_code", None) == 429:
            # Fallback so you can keep building/testing UI even without quota:
            return _stub_copy_latest_ref_to_output(db, theme, req.top_id, req.bottom_id)
        raise HTTPException(status_code=500, detail=str(e))

    # ---- Extract image ----
    generated_image = None
    # Some responses store candidates; but response.parts is usually ok.
    for part in getattr(response, "parts", []) or []:
        if getattr(part, "inline_data", None) is not None:
            generated_image = part.as_image()
            break

    if generated_image is None:
        # Sometimes you only get text back
        raise HTTPException(status_code=500, detail=f"No image returned. Text: {getattr(response, 'text', '')}")

    out_name = f"{cache_key}.png"
    out_path = OUTPUTS_DIR / out_name
    generated_image.save(out_path)

    output_url = f"/static/outputs/{out_name}"
    gen_record = {
        "id": uuid4().hex,
        "cache_key": cache_key,
        "ref_id": ref["id"],
        "top_id": req.top_id,
        "bottom_id": req.bottom_id,
        "theme": theme,
        "model": NANOBANANA_MODEL,
        "output_url": output_url,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    db["generations"].append(gen_record)
    save_db(db)

    return {"ok": True, "output_url": output_url, "generation": gen_record}
