import React, { useEffect, useMemo, useState } from "react";

/**
 * App.js
 * - Laddar data.json från GitHub Pages utan cache (v=timestamp).
 * - Autosuggest för driftplatser (datalist).
 * - Hittar väg över flera korridorer (kortaste i antal steg) med BFS i en graf.
 * - Komprimerar vägen till "korridor-segment" i ordning.
 *
 * Förväntar data.json-format:
 * {
 *   "linjebocker":[{id,name}],
 *   "driftplatser":[{code,name}],
 *   "korridorer":[{id,linjebokId,name,ordning:[codes],tabellStrackor:[{name,start,end}]}]
 * }
 */

export default function App() {
  const [data, setData] = useState(null);
  const [loadErr, setLoadErr] = useState("");

  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  const [result, setResult] = useState(null);
  const [solveErr, setSolveErr] = useState("");

  // 1) Ladda data.json med cache-bust + rätt base-path för GitHub Pages
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoadErr("");
        const url = `${import.meta.env.BASE_URL}data.json?v=${Date.now()}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`Kunde inte hämta data.json (${res.status})`);
        const json = await res.json();

        // Grundvalidering (snäll)
        if (!json || !Array.isArray(json.driftplatser) || !Array.isArray(json.korridorer)) {
          throw new Error("Fel format i data.json: saknar driftplatser/korridorer.");
        }

        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setLoadErr(String(e?.message || e));
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const dpByCode = useMemo(() => {
    const map = new Map();
    if (!data?.driftplatser) return map;

    for (const dp of data.driftplatser) {
      if (!dp?.code) continue;
      // Om dubbla koder råkar finnas: behåll första (eller den med name)
      if (!map.has(dp.code)) map.set(dp.code, dp);
    }
    return map;
  }, [data]);

  const dpOptions = useMemo(() => {
    if (!data?.driftplatser) return [];
    // Sortera snyggt på namn
    const uniq = [];
    const seen = new Set();
    for (const dp of data.driftplatser) {
      if (!dp?.code || seen.has(dp.code)) continue;
      seen.add(dp.code);
      uniq.push(dp);
    }
    uniq.sort((a, b) => (a.name || "").localeCompare(b.name || "sv"));
    return uniq;
  }, [data]);

  const linjebokById = useMemo(() => {
    const map = new Map();
    for (const lb of data?.linjebocker || []) map.set(lb.id, lb);
    return map;
  }, [data]);

  // 2) Bygg graf av alla korridorer: varje intilliggande par i ordning är en kant
  //    Vi tillåter båda riktningar (fram/back) automatiskt.
  const graph = useMemo(() => {
    const adj = new Map(); // code -> [{to, corridorId}]
    const corridorById = new Map();

    if (!data?.korridorer) return { adj, corridorById };

    for (const c of data.korridorer) {
      if (!c?.id || !Array.isArray(c.ordning) || c.ordning.length < 2) continue;
      corridorById.set(c.id, c);

      const ord = c.ordning;
      for (let i = 0; i < ord.length - 1; i++) {
        const a = ord[i];
        const b = ord[i + 1];
        if (!a || !b) continue;

        if (!adj.has(a)) adj.set(a, []);
        if (!adj.has(b)) adj.set(b, []);

        // Båda riktningar
        adj.get(a).push({ to: b, corridorId: c.id });
        adj.get(b).push({ to: a, corridorId: c.id });
      }
    }

    return { adj, corridorById };
  }, [data]);

  function normalizeInputToCode(value) {
    // Tillåter:
    // - "Sk" (kod)
    // - "Skövde central (Sk)" (autosuggest)
    // - "Skövde central" (match på namn)
    const v = (value || "").trim();
    if (!v) return "";

    // Matchar "... (CODE)"
    const m = v.match(/\(([^)]+)\)\s*$/);
    if (m && m[1]) return m[1].trim();

    // Om exakt kod finns
    if (dpByCode.has(v)) return v;

    // Matcha på namn (case-insensitivt)
    const lower = v.toLowerCase();
    for (const dp of dpOptions) {
      if ((dp.name || "").toLowerCase() === lower) return dp.code;
    }

    // Som sista utväg: returnera tomt (så vi kan visa fel)
    return "";
  }

  function formatDp(code) {
    const dp = dpByCode.get(code);
    if (!dp) return code;
    return `${dp.name} (${dp.code})`;
  }

  function corridorDirection(corridor, fromCode, toCode) {
    // avgör om segmentet går i ordning (fram) eller bak (reverse)
    const ord = corridor?.ordning || [];
    const i1 = ord.indexOf(fromCode);
    const i2 = ord.indexOf(toCode);
    if (i1 === -1 || i2 === -1) return "okänd";
    return i2 > i1 ? "fram" : "bak";
  }

  function bfsShortestPath(start, goal) {
    // BFS över noder (driftplats-koder). Vi sparar föregående för att återskapa väg.
    // prevMap: node -> { prevNode, viaCorridorId }
    const { adj } = graph;
    if (!adj.has(start) || !adj.has(goal)) return null;

    const q = [];
    const visited = new Set();
    const prev = new Map();

    q.push(start);
    visited.add(start);

    while (q.length) {
      const cur = q.shift();
      if (cur === goal) break;

      const edges = adj.get(cur) || [];
      for (const e of edges) {
        if (!e?.to) continue;
        if (visited.has(e.to)) continue;
        visited.add(e.to);
        prev.set(e.to, { prevNode: cur, viaCorridorId: e.corridorId });
        q.push(e.to);
      }
    }

    if (!visited.has(goal)) return null;

    // Återskapa nodväg: [start ... goal]
    const nodes = [];
    const corridors = []; // parallellt: corridor used to step into nodes[i]
    let cur = goal;

    while (cur !== start) {
      const p = prev.get(cur);
      if (!p) return null; // borde ej hända
      nodes.push(cur);
      corridors.push(p.viaCorridorId);
      cur = p.prevNode;
    }
    nodes.push(start);
    nodes.reverse();
    corridors.reverse(); // nu corridors[i] = corridor used from nodes[i] -> nodes[i+1]

    return { nodes, corridors };
  }

  function compressToCorridorSegments(path) {
    // path.nodes = [A,B,C,...], path.corridors = [c1,c2,...] for each edge
    // Vi gör segment där samma corridorId körs flera steg i rad.
    const nodes = path.nodes;
    const corrs = path.corridors;

    const segments = [];
    let i = 0;
    while (i < corrs.length) {
      const corridorId = corrs[i];
      let startNode = nodes[i];
      let j = i;

      while (j < corrs.length && corrs[j] === corridorId) j++;

      let endNode = nodes[j]; // eftersom j steg fram
      segments.push({
        corridorId,
        from: startNode,
        to: endNode,
        // vi kan också spara mellan-noder för segmentet om du vill visa dem senare
      });

      i = j;
    }

    return segments;
  }

  function handleSolve() {
    if (!data) return;
    setSolveErr("");
    setResult(null);

    const fromCode = normalizeInputToCode(fromInput);
    const toCode = normalizeInputToCode(toInput);

    if (!fromCode) return setSolveErr("Start driftplats kunde inte tolkas. Välj från listan eller skriv en giltig kod.");
    if (!toCode) return setSolveErr("Slut driftplats kunde inte tolkas. Välj från listan eller skriv en giltig kod.");
    if (fromCode === toCode) return setSolveErr("Start och slut är samma. Välj två olika driftplatser.");

    const path = bfsShortestPath(fromCode, toCode);
    if (!path) {
      return setSolveErr("Hittar ingen väg i din data mellan dessa driftplatser. (Saknas korridorer som kopplar ihop?)");
    }

    const segments = compressToCorridorSegments(path).map((seg) => {
      const corridor = graph.corridorById.get(seg.corridorId);
      const lb = corridor ? linjebokById.get(corridor.linjebokId) : null;

      return {
        linjebokId: corridor?.linjebokId || "",
        linjebokName: lb?.name || corridor?.linjebokId || "(okänd linjebok)",
        corridorId: seg.corridorId,
        corridorName: corridor?.name || seg.corridorId,
        direction: corridor ? corridorDirection(corridor, seg.from, seg.to) : "okänd",
        from: seg.from,
        to: seg.to
      };
    });

    setResult({
      fromCode,
      toCode,
      nodes: path.nodes,
      segments
    });
  }

  const dataUrl = useMemo(() => `${import.meta.env.BASE_URL}data.json`, []);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 16, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
      <h1 style={{ margin: "8px 0 4px" }}>Linjeboken – hitta rätt linjebok & fast sträcka</h1>
      <div style={{ opacity: 0.8, marginBottom: 14 }}>
        Skriv start och slut (namn eller kod). Appen listar vilka korridorer (“fasta sträckor”) du behöver slå upp.
      </div>

      {!data && !loadErr && <div>Laddar data…</div>}
      {loadErr && (
        <div style={{ padding: 12, border: "1px solid #f00", borderRadius: 8, marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Kunde inte ladda data.json</div>
          <div style={{ marginBottom: 10 }}>{loadErr}</div>
          <div style={{ fontSize: 13, opacity: 0.85 }}>
            Kontrollera att den finns på: <a href={dataUrl} target="_blank" rel="noreferrer">{dataUrl}</a>
          </div>
        </div>
      )}

      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 12, alignItems: "end" }}>
            <div>
              <label style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>Start</label>
              <input
                list="dpList"
                value={fromInput}
                onChange={(e) => setFromInput(e.target.value)}
                placeholder="t.ex. Skövde central (Sk) eller Sk"
                style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>Slut</label>
              <input
                list="dpList"
                value={toInput}
                onChange={(e) => setToInput(e.target.value)}
                placeholder="t.ex. Göteborgs central (G) eller G"
                style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
              />
            </div>

            <button
              onClick={handleSolve}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #111",
                background: "#111",
                color: "#fff",
                fontWeight: 700,
                cursor: "pointer"
              }}
            >
              Hitta sträcka
            </button>

            <datalist id="dpList">
              {dpOptions.map((dp) => (
                <option key={dp.code} value={`${dp.name} (${dp.code})`} />
              ))}
            </datalist>
          </div>

          {solveErr && (
            <div style={{ marginTop: 12, padding: 12, border: "1px solid #f00", borderRadius: 8 }}>
              {solveErr}
            </div>
          )}

          {result && (
            <div style={{ marginTop: 16, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>
                Resultat: {formatDp(result.fromCode)} → {formatDp(result.toCode)}
              </div>

              <div style={{ marginBottom: 12, opacity: 0.85 }}>
                Hittade {result.segments.length} korridor(er) i kedja.
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                {result.segments.map((s, idx) => (
                  <div key={`${s.corridorId}_${idx}`} style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
                    <div style={{ fontWeight: 800, marginBottom: 6 }}>
                      {idx + 1}. Linjebok: {s.linjebokName}
                    </div>
                    <div style={{ marginBottom: 6 }}>
                      <span style={{ fontWeight: 700 }}>Fast sträcka:</span> {s.corridorName}
                    </div>
                    <div style={{ fontSize: 13, opacity: 0.9 }}>
                      <span style={{ fontWeight: 700 }}>Del av rutt:</span> {formatDp(s.from)} → {formatDp(s.to)}{" "}
                      <span style={{ marginLeft: 8, padding: "2px 8px", borderRadius: 999, border: "1px solid #ccc" }}>
                        riktning: {s.direction}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <details style={{ marginTop: 14 }}>
                <summary style={{ cursor: "pointer", fontWeight: 700 }}>Visa hela kedjan av driftplatser</summary>
                <div style={{ marginTop: 10, lineHeight: 1.7 }}>
                  {result.nodes.map((c, i) => (
                    <span key={`${c}_${i}`}>
                      {formatDp(c)}
                      {i < result.nodes.length - 1 ? " → " : ""}
                    </span>
                  ))}
                </div>
              </details>
            </div>
          )}

          <div style={{ marginTop: 14, fontSize: 13, opacity: 0.75 }}>
            Tips: Om sidan “fastnar” på gammal data, öppna <code>/data.json?v=1</code> och uppdatera sedan sidan.
          </div>
        </>
      )}
    </div>
  );
}


