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
    setRefs(refsRes.refs ?? []);

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


  return (
    <main>
      <h1>Outfit Picker</h1>

      <p>
        Backend health: <code>{health}</code>
      </p>
      <p>
        API_BASE: <code>{API_BASE}</code>
      </p>

      <hr />

      {/* Phase 2: Uploads (keep barebones) */}
      <section>
        <h2>Wardrobe (Uploads)</h2>

        <div>
          <h3>Upload reference photo (you)</h3>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files && e.target.files[0];
              if (f) uploadReference(f);
            }}
          />
        </div>

        <div>
          <h3>Upload clothing</h3>

          <label>
            Type:{" "}
            <select
              value={clothingType}
              onChange={(e) => setClothingType(e.target.value)}
            >
              <option value="top">top</option>
              <option value="bottom">bottom</option>
            </select>
          </label>

          <br />

          <label>
            Tags (comma separated):{" "}
            <input
              value={clothingTags}
              onChange={(e) => setClothingTags(e.target.value)}
              placeholder="streetwear, black, summer"
            />
          </label>

          <br />

          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files && e.target.files[0];
              if (f) uploadClothing(f);
            }}
          />
        </div>

        <p>Status: {status}</p>
      </section>

      <hr />

      {/* Phase 3: TWO carousels (tops + bottoms) */}
      <section>
        <h2>Try-on (Two Carousels)</h2>

        <div>
          <h3>Tops Carousel</h3>
          <button
            onClick={() => setTopIndex((i) => prevIndex(i, tops.length))}
            disabled={tops.length === 0}
          >
            ← Prev
          </button>{" "}
          <button
            onClick={() => setTopIndex((i) => nextIndex(i, tops.length))}
            disabled={tops.length === 0}
          >
            Next →
          </button>

          <p>
            {tops.length === 0 ? (
              <em>No tops uploaded yet.</em>
            ) : (
              <>
                Showing {topIndex + 1} / {tops.length} — id:{" "}
                <code>{selectedTop?.id}</code>
              </>
            )}
          </p>

          {selectedTop && (
            <div>
              <div>
                <strong>{selectedTop.filename}</strong>
              </div>
              <div>tags: {(selectedTop.tags || []).join(", ")}</div>
              <img
                src={`${API_BASE}${selectedTop.url}`}
                alt="selected top"
                width={220}
              />
            </div>
          )}
        </div>

        <hr />

        <div>
          <h3>Bottoms Carousel</h3>
          <button
            onClick={() => setBottomIndex((i) => prevIndex(i, bottoms.length))}
            disabled={bottoms.length === 0}
          >
            ← Prev
          </button>{" "}
          <button
            onClick={() => setBottomIndex((i) => nextIndex(i, bottoms.length))}
            disabled={bottoms.length === 0}
          >
            Next →
          </button>

          <p>
            {bottoms.length === 0 ? (
              <em>No bottoms uploaded yet.</em>
            ) : (
              <>
                Showing {bottomIndex + 1} / {bottoms.length} — id:{" "}
                <code>{selectedBottom?.id}</code>
              </>
            )}
          </p>

          {selectedBottom && (
            <div>
              <div>
                <strong>{selectedBottom.filename}</strong>
              </div>
              <div>tags: {(selectedBottom.tags || []).join(", ")}</div>
              <img
                src={`${API_BASE}${selectedBottom.url}`}
                alt="selected bottom"
                width={220}
              />
            </div>
          )}
        </div>

        <hr />

        <div>
          <h3>Theme + Generate</h3>
          <label>
            Theme/prompt:{" "}
            <input
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="streetwear, formal, cozy winter..."
            />
          </label>
          <br />
          <button onClick={handleGenerate} disabled={!selectedTop || !selectedBottom}>
            Generate
          </button>
          {genError && <p>Error: {genError}</p>}

          {outputUrl && (
            <div>
              <h4>Output</h4>
              <img src={`${API_BASE}${outputUrl}`} alt="generated" width={320} />
              <div>
                <code>{outputUrl}</code>
              </div>
            </div>
          )}

          <p>
            Selected Top ID: <code>{selectedTop?.id ?? "none"}</code>
            <br />
            Selected Bottom ID: <code>{selectedBottom?.id ?? "none"}</code>
          </p>

        </div>
      </section>

      <hr />

      {/* Keep these lists for debugging; delete later if you want */}
      <section>
        <h2>Debug Lists (Optional)</h2>

        <h3>Reference photos</h3>
        <ul>
          {refs.map((r) => (
            <li key={r.id}>
              <div>{r.filename}</div>
              <img src={`${API_BASE}${r.url}`} alt="ref" width={120} />
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
