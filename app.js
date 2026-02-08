let DATA = null;

async function loadData() {
  if (DATA) return DATA;
  DATA = await fetch("data.json").then(r => r.json());
  return DATA;
}

function normalize(s) {
  return (s || "").toLowerCase().trim();
}

function findDriftplats(input, driftsplatser) {
  const q = normalize(input);
  if (!q) return null;

  // 1) exakt kodmatch
  const exactCode = driftsplatser.find(d => normalize(d.code) === q);
  if (exactCode) return exactCode;

  // 2) exakt namnmatch
  const exactName = driftsplatser.find(d => normalize(d.name) === q);
  if (exactName) return exactName;

  // 3) "contains" i namn
  const contains = driftsplatser.find(d => normalize(d.name).includes(q));
  if (contains) return contains;

  return null;
}

function buildGraph(edges) {
  // undirected graph (om du behöver riktning senare kan vi göra directed)
  const g = new Map();
  for (const e of edges) {
    if (!g.has(e.from)) g.set(e.from, []);
    if (!g.has(e.to)) g.set(e.to, []);
    g.get(e.from).push(e);
    g.get(e.to).push({ ...e, from: e.to, to: e.from }); // spegel för BFS
  }
  return g;
}

function bfsPath(graph, startCode, endCode) {
  const queue = [startCode];
  const prev = new Map(); // node -> {node: prevNode, edge: edgeUsed}
  prev.set(startCode, null);

  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === endCode) break;

    const neighbors = graph.get(cur) || [];
    for (const edge of neighbors) {
      const nxt = edge.to;
      if (prev.has(nxt)) continue;
      prev.set(nxt, { node: cur, edge });
      queue.push(nxt);
    }
  }

  if (!prev.has(endCode)) return null;

  // rebuild edges from end -> start
  const pathEdges = [];
  let cur = endCode;
  while (cur !== startCode) {
    const p = prev.get(cur);
    pathEdges.push(p.edge);
    cur = p.node;
  }
  pathEdges.reverse();
  return pathEdges;
}

function unique(arr) {
  return [...new Set(arr)];
}

function renderResult({ start, end, pathEdges, data }) {
  const output = document.getElementById("output");

  const lbById = new Map(data.linjebocker.map(lb => [lb.id, lb]));
  const allLB = unique(pathEdges.flatMap(e => e.linjebocker || []));

  const segmentsHtml = pathEdges.map((e, i) => {
    const lbs = (e.linjebocker || []).map(id => lbById.get(id)?.name || id).join(", ");
    return `
      <div style="padding:8px 0;border-bottom:1px solid #ddd;">
        <div><strong>${i + 1}.</strong> ${e.from} → ${e.to}</div>
        <div>Bandel: ${e.bandel || "?"}</div>
        <div>Linjebok: ${lbs || "?"}</div>
      </div>
    `;
  }).join("");

  const linjebockerHtml = allLB.map(id => {
    const lb = lbById.get(id);
    return lb ? `${lb.id}: ${lb.name}` : id;
  }).join("<br>");

  output.innerHTML = `
    <div><strong>Start:</strong> ${start.name} (${start.code})</div>
    <div><strong>Slut:</strong> ${end.name} (${end.code})</div>
    <br>
    <div><strong>Linjeböcker som behövs:</strong><br>${linjebockerHtml || "—"}</div>
    <br>
    <div><strong>Delsträckor (i ordning):</strong></div>
    ${segmentsHtml || "—"}
  `;
}

async function searchRoute() {
  const data = await loadData();

  const startInput = document.getElementById("start").value;
  const endInput = document.getElementById("slut").value;
  const output = document.getElementById("output");

  const start = findDriftplats(startInput, data.driftplatser);
  const end = findDriftplats(endInput, data.driftplatser);

  if (!start || !end) {
    output.innerHTML = "Kunde inte hitta start och/eller slut. Testa driftplatskod eller en del av namnet.";
    return;
  }

  const graph = buildGraph(data.edges || []);
  const pathEdges = bfsPath(graph, start.code, end.code);

  if (!pathEdges) {
    output.innerHTML = "Ingen rutt hittades i din data. (Det betyder oftast att du saknar en länk/edge i data.json.)";
    return;
  }

  renderResult({ start, end, pathEdges, data });
}
