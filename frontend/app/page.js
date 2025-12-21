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
    <main className="h-screen bg-neutral-50">
      <div className="mx-auto flex h-full max-w-6xl gap-4 p-4">
        {/* LEFT HALF */}
        <div className="w-full overflow-y-auto rounded-2xl border bg-white p-4 lg:w-1/2">
          <div className="mb-4">
            <h1 className="text-2xl font-semibold">Outfit Picker</h1>
            <p className="mt-1 text-sm text-neutral-600">
              Backend health: <code className="rounded bg-neutral-100 px-1">{health}</code>
            </p>
            <p className="mt-1 text-sm text-neutral-600">
              API_BASE: <code className="rounded bg-neutral-100 px-1">{API_BASE}</code>
            </p>
            <p className="mt-2 text-sm">
              Status: <span className="text-neutral-700">{status || "idle"}</span>
            </p>
          </div>

          {/* Upload reference */}
          <section className="mb-4 rounded-xl border p-4">
            <h2 className="text-lg font-medium">Reference Photo (You)</h2>
            <p className="mt-1 text-sm text-neutral-600">Upload a photo of yourself.</p>
            <input
              className="mt-3 block w-full text-sm"
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                if (f) uploadReference(f);
              }}
            />
          </section>

          {/* Upload clothing */}
          <section className="mb-4 rounded-xl border p-4">
            <h2 className="text-lg font-medium">Upload Clothing</h2>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="text-sm text-neutral-700">
                Type:{" "}
                <select
                  className="ml-2 rounded-lg border px-2 py-1 text-sm"
                  value={clothingType}
                  onChange={(e) => setClothingType(e.target.value)}
                >
                  <option value="top">top</option>
                  <option value="bottom">bottom</option>
                </select>
              </label>

              <input
                className="flex-1 min-w-[220px] rounded-lg border px-3 py-2 text-sm"
                value={clothingTags}
                onChange={(e) => setClothingTags(e.target.value)}
                placeholder="tags: streetwear, black, summer"
              />
            </div>

            <input
              className="mt-3 block w-full text-sm"
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                if (f) uploadClothing(f);
              }}
            />
          </section>

          {/* Tops carousel */}
          <section className="mb-4 rounded-xl border p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-medium">Tops</h2>
              <div className="flex gap-2">
                <button
                  className="rounded-lg border bg-white px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
                  onClick={() => setTopIndex((i) => prevIndex(i, tops.length))}
                  disabled={tops.length === 0}
                >
                  ← Prev
                </button>
                <button
                  className="rounded-lg border bg-white px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
                  onClick={() => setTopIndex((i) => nextIndex(i, tops.length))}
                  disabled={tops.length === 0}
                >
                  Next →
                </button>
              </div>
            </div>

            {selectedTop ? (
              <div className="mt-3">
                <p className="text-sm text-neutral-700">
                  <span className="font-medium">{selectedTop.filename}</span>
                </p>
                <p className="text-xs text-neutral-500">
                  tags: {(selectedTop.tags || []).join(", ")}
                </p>
                <img
                  className="mt-3 w-full max-w-sm rounded-xl border object-contain"
                  src={`${API_BASE}${selectedTop.url}`}
                  alt="selected top"
                />
                <p className="mt-2 text-xs text-neutral-500">
                  id: <code className="rounded bg-neutral-100 px-1">{selectedTop.id}</code>
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-neutral-600">No tops uploaded yet.</p>
            )}
          </section>

          {/* Bottoms carousel */}
          <section className="mb-4 rounded-xl border p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-medium">Bottoms</h2>
              <div className="flex gap-2">
                <button
                  className="rounded-lg border bg-white px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
                  onClick={() => setBottomIndex((i) => prevIndex(i, bottoms.length))}
                  disabled={bottoms.length === 0}
                >
                  ← Prev
                </button>
                <button
                  className="rounded-lg border bg-white px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
                  onClick={() => setBottomIndex((i) => nextIndex(i, bottoms.length))}
                  disabled={bottoms.length === 0}
                >
                  Next →
                </button>
              </div>
            </div>

            {selectedBottom ? (
              <div className="mt-3">
                <p className="text-sm text-neutral-700">
                  <span className="font-medium">{selectedBottom.filename}</span>
                </p>
                <p className="text-xs text-neutral-500">
                  tags: {(selectedBottom.tags || []).join(", ")}
                </p>
                <img
                  className="mt-3 w-full max-w-sm rounded-xl border object-contain"
                  src={`${API_BASE}${selectedBottom.url}`}
                  alt="selected bottom"
                />
                <p className="mt-2 text-xs text-neutral-500">
                  id: <code className="rounded bg-neutral-100 px-1">{selectedBottom.id}</code>
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-neutral-600">No bottoms uploaded yet.</p>
            )}
          </section>

          {/* Theme + Generate */}
          <section className="rounded-xl border p-4">
            <h2 className="text-lg font-medium">Theme + Generate</h2>

            <input
              className="mt-3 w-full rounded-lg border px-3 py-2 text-sm"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="theme: streetwear, formal, cozy winter..."
            />

            <button
              className="mt-3 w-full rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              onClick={handleGenerate}
              disabled={!selectedTop || !selectedBottom}
            >
              Generate
            </button>

            {genError && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700">
                {genError}
              </p>
            )}
          </section>
        </div>

        {/* RIGHT HALF */}
        <div className="w-full overflow-hidden rounded-2xl border bg-white p-4 lg:w-1/2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-medium">Generated Output</h2>
            {outputUrl && (
              <code className="truncate rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-700">
                {outputUrl}
              </code>
            )}
          </div>

          <div className="flex h-[calc(100%-48px)] items-center justify-center rounded-xl border border-dashed bg-neutral-50 p-3">
            {outputUrl ? (
              <img
                className="max-h-full max-w-full rounded-xl border object-contain"
                src={`${API_BASE}${outputUrl}`}
                alt="generated"
              />
            ) : (
              <p className="text-sm text-neutral-600">
                Your generated image will appear here.
              </p>
            )}
          </div>
        </div>
      </div>
    </main>
  );

}
