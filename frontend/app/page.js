"use client";

import { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export default function Home() {
  // backend + data
  const [health, setHealth] = useState("loading...");
  const [tops, setTops] = useState([]);
  const [bottoms, setBottoms] = useState([]);
  const [refs, setRefs] = useState([]);

  // upload form state
  const [clothingType, setClothingType] = useState("top"); // "top" | "bottom"
  const [clothingTags, setClothingTags] = useState("");
  const [status, setStatus] = useState("");

  // carousel state (Phase 3)
  const [topIndex, setTopIndex] = useState(0);
  const [bottomIndex, setBottomIndex] = useState(0);
  // reference carousel
  const [refIndex, setRefIndex] = useState(0);
  const selectedRef = refs.length > 0 ? refs[refIndex] : null;

  // try-on inputs
  const [theme, setTheme] = useState("");

  const selectedTop = tops.length > 0 ? tops[topIndex] : null;
  const selectedBottom = bottoms.length > 0 ? bottoms[bottomIndex] : null;

  // generate ai
  const [outputUrl, setOutputUrl] = useState("");
  const [genError, setGenError] = useState("");

  async function refreshAll() {
    const h = await fetch(`${API_BASE}/health`).then((r) => r.json());
    setHealth(JSON.stringify(h));

    const topsRes = await fetch(`${API_BASE}/wardrobe/tops`).then((r) => r.json());
    const newTops = topsRes.items ?? [];
    setTops(newTops);

    const bottomsRes = await fetch(`${API_BASE}/wardrobe/bottoms`).then((r) => r.json());
    const newBottoms = bottomsRes.items ?? [];
    setBottoms(newBottoms);

    const refsRes = await fetch(`${API_BASE}/user/refs`).then((r) => r.json());
const newRefs = refsRes.refs ?? [];
setRefs(newRefs);
setRefIndex((i) => (newRefs.length === 0 ? 0 : Math.min(i, newRefs.length - 1)));


    // Keep indices valid if list sizes changed
    // (e.g., first upload, or you later add delete)
    setTopIndex((i) => (newTops.length === 0 ? 0 : Math.min(i, newTops.length - 1)));
    setBottomIndex((i) =>
      newBottoms.length === 0 ? 0 : Math.min(i, newBottoms.length - 1)
    );
  }

  useEffect(() => {
    refreshAll().catch((e) => setHealth("error: " + String(e)));
  }, []);

  async function uploadClothing(file) {
    setStatus("Uploading clothing...");
    const fd = new FormData();
    fd.append("item_type", clothingType);
    fd.append("tags", clothingTags);
    fd.append("file", file);

    const res = await fetch(`${API_BASE}/upload/clothing`, {
      method: "POST",
      body: fd,
    }).then((r) => r.json());

    if (!res.ok) {
      setStatus(`Upload failed: ${res.error ?? "unknown error"}`);
      return;
    }
    setStatus("Clothing uploaded.");
    await refreshAll();
  }

  async function uploadReference(file) {
    setStatus("Uploading reference...");
    const fd = new FormData();
    fd.append("file", file);

    const res = await fetch(`${API_BASE}/upload/reference`, {
      method: "POST",
      body: fd,
    }).then((r) => r.json());

    if (!res.ok) {
      setStatus(`Upload failed: ${res.error ?? "unknown error"}`);
      return;
    }
    setStatus("Reference uploaded.");
    await refreshAll();
  }

async function deleteClothing(itemId) {
  setStatus("Deleting clothing...");
  setGenError("");

  const res = await fetch(`${API_BASE}/wardrobe/item/${itemId}`, {
    method: "DELETE",
  });

  let data = {};
  try { data = await res.json(); } catch {}

  if (!res.ok || !data.ok) {
    setGenError(data.detail || data.error || "Delete clothing failed");
    setStatus("");
    return;
  }

  setStatus("Clothing deleted.");
  await refreshAll();
}


async function deleteRef(refId) {
  setStatus("Deleting reference...");
  setGenError("");

  const res = await fetch(`${API_BASE}/user/ref/${refId}`, { method: "DELETE" });

  let data = {};
  try { data = await res.json(); } catch {}

  if (!res.ok || !data.ok) {
    setGenError(data.detail || data.error || "Delete ref failed");
    setStatus("");
    return;
  }

  setStatus("Reference deleted.");
  await refreshAll();
}



  function prevIndex(current, length) {
    if (length === 0) return 0;
    return (current - 1 + length) % length;
  }

  function nextIndex(current, length) {
    if (length === 0) return 0;
    return (current + 1) % length;
  }

  async function handleGenerate() {
    setGenError("");
    setOutputUrl("");
    setStatus("Generating...");

    if (!selectedTop || !selectedBottom) {
      setGenError("Upload at least one top and one bottom first.");
      setStatus("");
      return;
    }

    let res;
    try {
      res = await fetch(`${API_BASE}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          top_id: selectedTop.id,
          bottom_id: selectedBottom.id,
          theme: theme,
          ref_id: selectedRef ? selectedRef.id : null,
        }),
      });
    } catch (e) {
      setGenError("Network error: " + String(e));
      setStatus("");
      return;
    }

    let data = {};
    try {
      data = await res.json();
    } catch {
      // If backend didn't return JSON
    }

    if (!res.ok || !data.ok) {
      const msg = data.detail || data.error || `Generate failed (HTTP ${res.status})`;
      setGenError(msg);
      setStatus("");
      return;
    }

    setOutputUrl(data.output_url);

    // If backend fell back (quota/billing issue), show that in status
    if (data.fallback) {
      setStatus("Generated (fallback stub — quota/billing issue).");
    } else if (data.cached) {
      setStatus("Generated (cached).");
    } else {
      setStatus("Generated.");
    }
  }
async function handleAutoPick() {
  setGenError("");
  setStatus("Auto-picking...");

  try {
    const res = await fetch(`${API_BASE}/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme }),
    });
    const data = await res.json();

    if (!res.ok || !data.ok) {
      setGenError(data.detail || data.error || "Auto-pick failed");
      setStatus("");
      return;
    }

    const topId = data.top_id;
    const bottomId = data.bottom_id;

    const newTopIndex = tops.findIndex((t) => t.id === topId);
    const newBottomIndex = bottoms.findIndex((b) => b.id === bottomId);

    if (newTopIndex >= 0) setTopIndex(newTopIndex);
    if (newBottomIndex >= 0) setBottomIndex(newBottomIndex);

    setStatus("Auto-pick complete.");
  } catch (e) {
    setGenError("Auto-pick error: " + String(e));
    setStatus("");
  }
}


  return (
  <div className="win-split">
    {/* LEFT WINDOW */}
    <div className="window win-pane">
      <div className="title-bar">
        <div className="title-bar-text">Outfit Picker</div>
        <div className="title-bar-controls">
          <button aria-label="Minimize" />
          <button aria-label="Maximize" />
          <button aria-label="Close" />
        </div>
      </div>

      <div className="window-body win-scroll">

        <fieldset>
          <legend>Reference Photo (You)</legend>

          <div className="field-row-stacked">
            <label>Upload a photo of yourself</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                if (f) uploadReference(f);
              }}
            />
          </div>

          <br />
      {refs.length > 0 && (
        <>
          <div className="field-row">
            <button
              onClick={() => setRefIndex((i) => prevIndex(i, refs.length))}
              disabled={refs.length === 0}
            >
              ◀ Prev
            </button>
            <button
              onClick={() => setRefIndex((i) => nextIndex(i, refs.length))}
              disabled={refs.length === 0}
            >
              Next ▶
            </button>
          </div>

    <p>
      Using ref {refIndex + 1}/{refs.length} — id: <code>{selectedRef?.id}</code>
    </p>

    {selectedRef && (
      <img src={`${API_BASE}${selectedRef.url}`} alt="selected ref" width={160} />
    )}
  </>
)}

          {refs.length === 0 ? (
            <p>No reference photos yet.</p>
          ) : (
            
            <ul>
              {refs.map((r) => (
                <li key={r.id}>
                  <div>
                    <strong>{r.filename}</strong>
                  </div>
                  <img src={`${API_BASE}${r.url}`} alt="ref" width={140} />
                  <div className="field-row" style={{ marginTop: 6 }}>
                    <button onClick={() => deleteRef(r.id)}>Delete Reference Photo</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        <br />

        <fieldset>
          <legend>Upload Clothing</legend>

          <div className="field-row">
            <label htmlFor="clothingType">Type</label>
            <select
              id="clothingType"
              value={clothingType}
              onChange={(e) => setClothingType(e.target.value)}
            >
              <option value="top">top</option>
              <option value="bottom">bottom</option>
            </select>
          </div>

          <div className="field-row-stacked">
            <label>Tags (comma separated)</label>
            <input
              value={clothingTags}
              onChange={(e) => setClothingTags(e.target.value)}
              placeholder="streetwear, black, summer"
            />
          </div>

          <div className="field-row-stacked">
            <label>Image file</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                if (f) uploadClothing(f);
              }}
            />
          </div>
        </fieldset>

        <br />

        <fieldset>
          <legend>Tops</legend>

          <div className="field-row">
            <button
              onClick={() => setTopIndex((i) => prevIndex(i, tops.length))}
              disabled={tops.length === 0}
            >
              ◀ Prev
            </button>
            <button
              onClick={() => setTopIndex((i) => nextIndex(i, tops.length))}
              disabled={tops.length === 0}
            >
              Next ▶
            </button>
          </div>

          {selectedTop ? (
            <>
              <p>
                <strong>{selectedTop.filename}</strong>
                <br />
                tags: {(selectedTop.tags || []).join(", ")}
                <br />
                id: <code>{selectedTop.id}</code>
              </p>
              <img
                src={`${API_BASE}${selectedTop.url}`}
                alt="selected top"
                width={240}
              />
              <div className="field-row" style={{ marginTop: 6 }}>
                <button onClick={() => deleteClothing(selectedTop.id)}>
                  Delete this top
                </button>
              </div>
            </>
          ) : (
            <p>No tops uploaded yet.</p>
          )}
        </fieldset>

        <br />

        <fieldset>
          <legend>Bottoms</legend>

          <div className="field-row">
            <button
              onClick={() => setBottomIndex((i) => prevIndex(i, bottoms.length))}
              disabled={bottoms.length === 0}
            >
              ◀ Prev
            </button>
            <button
              onClick={() => setBottomIndex((i) => nextIndex(i, bottoms.length))}
              disabled={bottoms.length === 0}
            >
              Next ▶
            </button>
          </div>

          {selectedBottom ? (
            <>
              <p>
                <strong>{selectedBottom.filename}</strong>
                <br />
                tags: {(selectedBottom.tags || []).join(", ")}
                <br />
                id: <code>{selectedBottom.id}</code>
              </p>
              <img
                src={`${API_BASE}${selectedBottom.url}`}
                alt="selected bottom"
                width={240}
              />
              <div className="field-row" style={{ marginTop: 6 }}>
                <button onClick={() => deleteClothing(selectedBottom.id)}>
                  Delete this bottom
                </button>
              </div>
            </>
          ) : (
            <p>No bottoms uploaded yet.</p>
          )}
        </fieldset>

        <br />

        <fieldset>
          <legend>Theme + Generate</legend>

          <div className="field-row-stacked">
            <label>Theme/prompt</label>
            <input
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="streetwear, formal, cozy winter..."
            />
          </div>

          <div className="field-row" style={{ marginTop: 6 }}>
  <button onClick={handleAutoPick} disabled={!theme.trim()}>
    Auto-pick from theme
  </button>
  <button onClick={handleGenerate} disabled={!selectedTop || !selectedBottom}>
    Generate
  </button>
</div>

          {genError && (
            <p style={{ marginTop: 8 }}>
              <strong>Error:</strong> {genError}
            </p>
          )}
        </fieldset>
      </div>
    </div>

    {/* RIGHT WINDOW */}
    <div className="window win-pane">
      <div className="title-bar">
        <div className="title-bar-text">Generated Output</div>
        <div className="title-bar-controls">
          <button aria-label="Minimize" />
          <button aria-label="Maximize" />
          <button aria-label="Close" />
        </div>
      </div>

      <div className="window-body win-preview">
        {outputUrl ? (
          <img src={`${API_BASE}${outputUrl}`} alt="generated" />
        ) : (
          <p>Your generated image will appear here.</p>
        )}
      </div>
    </div>
  </div>
);


}
