"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [health, setHealth] = useState<string>("loading...");

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";
    fetch(`${process.env.NEXT_PUBLIC_API_BASE}/health`)
      .then((r) => r.json())
      .then((data) => setHealth(JSON.stringify(data)))
      .catch((e) => setHealth("error: " + String(e)));
  }, []);

  return (
    <main>
      <h1>Outfit Picker</h1>

      <p>
        Backend health: <code>{health}</code>
      </p>

      <hr />

      <section>
        <h2>Wardrobe</h2>
        <p>Upload tops/bottoms and your reference photos here.</p>
        <p>(Phase 2: add upload UI + list wardrobe items)</p>
      </section>

      <hr />

      <section>
        <h2>Try-on</h2>
        <p>Select a top and bottom, add a theme, and generate an image.</p>
        <p>(Phase 3: add carousel selection + generate button)</p>
      </section>
    </main>
  );
}
