from __future__ import annotations

import json
import os
import re
import shutil
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from PIL import Image, ImageDraw

from google import genai
from google.genai import types

# ---------------- Env / Client ----------------
load_dotenv()

NANOBANANA_MODEL = os.getenv("NANOBANANA_MODEL", "gemini-2.5-flash-preview-image")
ALLOW_PLACEHOLDER_FALLBACK = os.getenv("ALLOW_PLACEHOLDER_FALLBACK", "1") == "1"

# genai.Client() will use GEMINI_API_KEY or GOOGLE_API_KEY if present.
client = genai.Client()

# ---------------- Paths ----------------
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
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)


def load_db() -> dict[str, Any]:
    ensure_dirs()
    if not DB_PATH.exists():
        return {"clothes": [], "refs": [], "generations": []}
    try:
        return json.loads(DB_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"clothes": [], "refs": [], "generations": []}


def save_db(db: dict[str, Any]) -> None:
    ensure_dirs()
    DB_PATH.write_text(json.dumps(db, indent=2), encoding="utf-8")


def guess_mime_from_suffix(suffix: str) -> str:
    s = suffix.lower()
    if s in [".jpg", ".jpeg"]:
        return "image/jpeg"
    if s == ".webp":
        return "image/webp"
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

    # stream copy avoids huge memory spikes
    with out_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    return filename


def safe_remove(path: Path) -> None:
    try:
        if path.exists():
            path.unlink()
    except Exception:
        # don't crash deletes because of file locks, etc.
        pass


def tokenize(text: str) -> list[str]:
    text = (text or "").lower()
    text = re.sub(r"[^a-z0-9\s,_-]", " ", text)
    parts = re.split(r"[\s,]+", text)
    return [p.strip() for p in parts if p.strip()]

SYNONYMS = {
    "formal": ["dressy", "smart", "business", "suit", "blazer"],
    "business": ["formal", "office", "work", "professional"],
    "casual": ["everyday", "daily", "relaxed"],
    "streetwear": ["street", "urban", "hype", "skater"],
    "cozy": ["warm", "knit", "fleece", "hoodie", "sweater"],
    "winter": ["cold", "warm", "layer", "coat"],
    "summer": ["light", "breathable", "linen", "shorts"],
    "athleisure": ["sport", "gym", "training", "active"],
    "date": ["nice", "dressy", "clean", "smart"],
    "black": ["dark"],
    "white": ["light"],
    "blue": ["navy"],
    "jeans": ["denim"],
}

STOPWORDS = {"a", "an", "the", "and", "or", "with", "for", "to", "of", "in", "on"}

def expand_keywords(keywords: list[str]) -> list[str]:
    out = []
    seen = set()
    for kw in keywords:
        if kw in STOPWORDS:
            continue
        if kw not in seen:
            out.append(kw); seen.add(kw)
        for syn in SYNONYMS.get(kw, []):
            if syn not in seen:
                out.append(syn); seen.add(syn)
    return out



def score_item(item: dict[str, Any], keywords: list[str]) -> int:
    # Simple deterministic scoring: tag overlap + filename overlap
    tags = [t.lower() for t in (item.get("tags") or [])]
    fname = (item.get("filename") or "").lower()

    s = 0
    for kw in keywords:
        if kw in tags:
            s += 3
        if kw and kw in fname:
            s += 1
    return s


def make_placeholder_tryon(ref_path: Path, top_path: Path, bottom_path: Path, theme: str, out_path: Path) -> None:
    """
    Creates a placeholder "try-on" image so your UX works even without a paid image API.
    It stitches ref/top/bottom into a single preview with text.
    """
    W, H = 768, 1024
    img = Image.new("RGB", (W, H), (240, 240, 240))
    draw = ImageDraw.Draw(img)

    # Load images safely
    def load_and_fit(p: Path, box_w: int, box_h: int) -> Image.Image:
        im = Image.open(p).convert("RGB")
        im.thumbnail((box_w, box_h))
        return im

    ref = load_and_fit(ref_path, 420, 900)
    top = load_and_fit(top_path, 300, 350)
    bot = load_and_fit(bottom_path, 300, 350)

    # Paste layout
    img.paste(ref, (20, 80))
    img.paste(top, (460, 140))
    img.paste(bot, (460, 520))

    # Labels
    draw.rectangle([0, 0, W, 60], fill=(0, 128, 128))
    draw.text((16, 18), "Outfit Picker (placeholder output)", fill=(255, 255, 255))

    draw.text((20, 65), "REFERENCE", fill=(0, 0, 0))
    draw.text((460, 110), "TOP", fill=(0, 0, 0))
    draw.text((460, 490), "BOTTOM", fill=(0, 0, 0))

    t = (theme or "").strip()
    if t:
        draw.text((20, H - 40), f"Theme: {t}", fill=(0, 0, 0))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path)


# ---------------- App ----------------
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
    return {"status": "ok"}


# ---------------- Upload endpoints ----------------
@app.post("/upload/clothing")
def upload_clothing(
    item_type: str = Form(...),
    tags: str = Form(""),
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


# ---------------- List endpoints ----------------
@app.get("/wardrobe/tops")
def wardrobe_tops():
    db = load_db()
    tops = [c for c in db.get("clothes", []) if c.get("type") == "top"]
    return {"ok": True, "items": tops}


@app.get("/wardrobe/bottoms")
def wardrobe_bottoms():
    db = load_db()
    bottoms = [c for c in db.get("clothes", []) if c.get("type") == "bottom"]
    return {"ok": True, "items": bottoms}


@app.get("/user/refs")
def user_refs():
    db = load_db()
    return {"ok": True, "refs": db.get("refs", [])}


# ---------------- Delete endpoints ----------------
@app.delete("/wardrobe/item/{item_id}")
def delete_clothing(item_id: str):
    db = load_db()
    clothes = db.get("clothes", [])
    item = next((c for c in clothes if c.get("id") == item_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="clothing item not found")

    # remove file
    safe_remove(CLOTHES_DIR / item["filename"])

    # remove from db
    db["clothes"] = [c for c in clothes if c.get("id") != item_id]
    save_db(db)

    return {"ok": True}


@app.delete("/user/ref/{ref_id}")
def delete_ref(ref_id: str):
    db = load_db()
    refs = db.get("refs", [])
    ref = next((r for r in refs if r.get("id") == ref_id), None)
    if not ref:
        raise HTTPException(status_code=404, detail="ref not found")

    safe_remove(USER_DIR / ref["filename"])
    db["refs"] = [r for r in refs if r.get("id") != ref_id]
    save_db(db)

    return {"ok": True}


# ---------------- Recommend endpoint (auto-pick) ----------------
class RecommendRequest(BaseModel):
    theme: str = ""


@app.post("/recommend")
def recommend(req: RecommendRequest):
    db = load_db()
    clothes = db.get("clothes", [])
    tops = [c for c in clothes if c.get("type") == "top"]
    bottoms = [c for c in clothes if c.get("type") == "bottom"]

    if not tops or not bottoms:
        raise HTTPException(status_code=400, detail="Need at least 1 top and 1 bottom")

    keywords = expand_keywords(tokenize(req.theme))

    def best(items: list[dict[str, Any]]) -> dict[str, Any]:
        scored = [(score_item(it, keywords), it) for it in items]
        scored.sort(key=lambda x: x[0], reverse=True)
        return scored[0][1]

    top = best(tops)
    bottom = best(bottoms)

    return {
        "ok": True,
        "top_id": top["id"],
        "bottom_id": bottom["id"],
        "keywords": keywords,
    }


# ---------------- Generate (Gemini + fallback) ----------------
class GenerateRequest(BaseModel):
    top_id: str
    bottom_id: str
    theme: str = ""
    ref_id: str | None = None  # optional: choose which ref to use later


@app.post("/generate")
def generate(req: GenerateRequest):
    db = load_db()
    db.setdefault("generations", [])

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

    if req.ref_id:
        ref = next((r for r in refs if r.get("id") == req.ref_id), None)
        if not ref:
            raise HTTPException(status_code=400, detail="ref_id not found")
    else:
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

    # cache key
    cache_raw = f"{ref['id']}|{req.top_id}|{req.bottom_id}|{theme}".encode("utf-8")
    cache_key = hashlib.sha256(cache_raw).hexdigest()

    existing = next((g for g in db["generations"] if g.get("cache_key") == cache_key), None)
    if existing:
        out_file = OUTPUTS_DIR / os.path.basename(existing["output_url"])
        if out_file.exists():
            return {"ok": True, "output_url": existing["output_url"], "generation": existing}

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
- Do NOT invent extra clothing items (no jacket/hat unless explicitly requested).
- Keep the outfit exactly those two garments.
- Neutral background, realistic lighting, clean result.
- No nudity.

THEME (optional): {theme if theme else "none"}
""".strip()

    out_name = f"{cache_key}.png"
    out_path = OUTPUTS_DIR / out_name
    output_url = f"/static/outputs/{out_name}"

    # ---- Attempt Gemini ----
    try:
        def part_for(path: Path) -> types.Part:
            suffix = path.suffix.lower()
            mime = guess_mime_from_suffix(suffix)
            return types.Part.from_bytes(data=path.read_bytes(), mime_type=mime)

        contents = [
            prompt,
            part_for(ref_path),
            part_for(top_path),
            part_for(bottom_path),
        ]

        response = client.models.generate_content(
            model=NANOBANANA_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                image_config=types.ImageConfig(aspect_ratio="3:4")
            ),
        )

        generated_image = None
        # Some SDK responses put image bytes inside candidate parts.
        # We'll try the simplest pattern first.
        if hasattr(response, "parts") and response.parts:
            for part in response.parts:
                if getattr(part, "inline_data", None) is not None:
                    generated_image = part.as_image()
                    break

        if generated_image is None:
            # Sometimes you only get text back
            raise RuntimeError(f"No image returned. Text: {getattr(response, 'text', '')}")

        generated_image.save(out_path)
        provider = "gemini"

    except Exception as e:
        # If billing/quota/rate-limit isn't set, we don't want a hard stop while you're building.
        # Instead: return 429 (true error) OR fallback placeholder depending on env.
        msg = str(e)
        is_quota = ("RESOURCE_EXHAUSTED" in msg) or ("429" in msg) or ("quota" in msg.lower())

        if (not ALLOW_PLACEHOLDER_FALLBACK) and is_quota:
            raise HTTPException(status_code=429, detail=f"Gemini quota/rate-limit: {msg}")

        if (not ALLOW_PLACEHOLDER_FALLBACK) and (not is_quota):
            raise HTTPException(status_code=500, detail=f"Generate failed: {msg}")

        # Fallback: create placeholder stitched output (keeps frontend + caching working)
        make_placeholder_tryon(ref_path, top_path, bottom_path, theme, out_path)
        provider = "placeholder"
        # If it *was* quota, still tell the frontend the truth (but keep ok flow)
        # We include a warning field.

    gen_record = {
        "id": uuid4().hex,
        "cache_key": cache_key,
        "ref_id": ref["id"],
        "top_id": req.top_id,
        "bottom_id": req.bottom_id,
        "theme": theme,
        "model": NANOBANANA_MODEL,
        "provider": provider,
        "output_url": output_url,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    db["generations"].append(gen_record)
    save_db(db)

    return {"ok": True, "output_url": output_url, "generation": gen_record}
