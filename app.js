// =========================================
// Linjebok + sträckor i hastighets-PDF
// - Endast "färdiga rutter" (korridorer)
// - Kan kedja flera korridorer via gemensamma driftplatser
// - Autosuggest
//
// Kräver data.json med:
// {
//   linjebocker: [{id,name}],
//   driftplatser: [{code,name}],
//   korridorer: [{
//     id, linjebokId, name,
//     ordning: ["Sk", "...", "G"],
//     tabellStrackor: [{name,start,end}]
//   }]
// }
// =========================================

let DATA = null;

function normalize(s) {
  return (s || "").toLowerCase().trim();
}

function escapeHtml(s) {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadData() {
  if (DATA) return DATA;
  const res = await fetch("data.json");
  DATA = await res.json();
  buildAutoSuggest(DATA);
  return DATA;
}

function buildAutoSuggest(data) {
  const list = document.getElementById("dpList");
  if (!list) return;
  list.innerHTML = "";

  const dps = data?.driftplatser || [];
  for (const dp of dps) {
    // "Skövde central (Sk)"
    const opt = document.createElement("option");
    opt.value = `${dp.name} (${dp.code})`;
    list.appendChild(opt);

    // även kod ensam
    const opt2 = document.createElement("option");
    opt2.value = dp.code;
    list.appendChild(opt2);
  }
}

function parseDriftplats(input, driftsplatser) {
  if (!input) return null;

  // "Namn (CODE)"
  const m = input.match(/\(([^)]+)\)\s*$/);
  if (m) {
    const code = normalize(m[1]);
    const dp = driftsplatser.find(d => normalize(d.code) === code);
    if (dp) return dp;
  }

  const q = normalize(input);

  // Exakt kod
  let dp = driftsplatser.find(d => normalize(d.code) === q);
  if (dp) return dp;

  // Exakt namn
  dp = driftsplatser.find(d => normalize(d.name) === q);
  if (dp) return dp;

  // Contains
  dp = driftsplatser.find(d => normalize(d.name).includes(q));
  if (dp) return dp;

  return null;
}

function setOutput(html) {
  const out = document.getElementById("output");
  if (out) out.innerHTML = html;
}

function ok(msg) { return `<div style="color:#0b6;font-weight:600;">✅ ${escapeHtml(msg)}</div>`; }
function warn(msg) { return `<div style="color:#b60;font-weight:600;">⚠️ ${escapeHtml(msg)}</div>`; }
function bad(msg) { return `<div style="color:#c00;font-weight:700;">⛔ ${escapeHtml(msg)}</div>`; }

function idxMap(arr) {
  const m = new Map();
  arr.forEach((v, i) => m.set(v, i));
  return m;
}

function overlapsInterval(aMin, aMax, bMin, bMax) {
  return !(bMax < aMin || bMin > aMax);
}

// Välj bästa enskilda korridor om start+slut finns i samma
function pickBestSingleCorridor(korridorer, startCode, endCode) {
  let best = null;
  let bestDist = Infinity;

  for (const k of korridorer) {
    const ord = k.ordning || [];
    const idx = idxMap(ord);
    if (!idx.has(startCode) || !idx.has(endCode)) continue;

    const dist = Math.abs(idx.get(startCode) - idx.get(endCode));
    if (dist < bestDist) {
      bestDist = dist;
      best = k;
    }
  }
  return best; // kan vara null
}

// Bygg index: vilka korridorer innehåller varje driftplatskod?
function buildCorridorsByCode(korridorer) {
  const map = new Map(); // code -> array of corridorIds
  for (const k of korridorer) {
    for (const c of (k.ordning || [])) {
      if (!map.has(c)) map.set(c, []);
      map.get(c).push(k.id);
    }
  }
  return map;
}

// Bygg hjälpkarta id -> korridor
function buildCorridorById(korridorer) {
  const m = new Map();
  for (const k of korridorer) m.set(k.id, k);
  return m;
}

// BFS över "korridor-noder" med transfer via gemensamma driftplatser.
// State: {corridorId, atCode} där atCode är driftplats vi befinner oss vid (start eller bytespunkt).
// Målet: hitta en state där endCode finns i corridoren (då kan sista benet gå inom korridoren till end).
function findCorridorChain({ korridorer, startCode, endCode }) {
  const byId = buildCorridorById(korridorer);
  const corridorsByCode = buildCorridorsByCode(korridorer);

  const startCorrs = corridorsByCode.get(startCode) || [];
  if (!startCorrs.length) return null;

  // queue of states
  const q = [];
  const prev = new Map(); // key -> {prevKey, viaCode} (viaCode = bytespunkt)
  // key format: "corridorId|atCode"
  function key(cid, code) { return `${cid}|${code}`; }

  for (const cid of startCorrs) {
    const k0 = key(cid, startCode);
    q.push({ corridorId: cid, atCode: startCode });
    prev.set(k0, null);
  }

  let goalKey = null;

  while (q.length) {
    const cur = q.shift();
    const kcur = byId.get(cur.corridorId);
    if (!kcur) continue;

    const ord = kcur.ordning || [];
    const idx = idxMap(ord);

    // Om slut finns i denna korridor är vi klara (vi kan färdas inom korridoren till end)
    if (idx.has(endCode)) {
      goalKey = key(cur.corridorId, cur.atCode);
      break;
    }

    // Byten: vid alla driftplatser som är gemensamma med andra korridorer
    // (dvs koden förekommer i fler än 1 korridor)
    for (const code of ord) {
      const corrsHere = corridorsByCode.get(code) || [];
      if (corrsHere.length < 2) continue; // ingen bytespunkt

      // Vi kan byta från current corridor till en annan corridor vid denna code
      for (const nextCid of corrsHere) {
        if (nextCid === cur.corridorId) continue;

        const kNext = key(nextCid, code);
        if (prev.has(kNext)) continue;

        prev.set(kNext, { prevKey: key(cur.corridorId, cur.atCode), viaCode: code });
        q.push({ corridorId: nextCid, atCode: code });
      }
    }
  }

  if (!goalKey) return null;

  // Rekonstruera kedja av corridor-states
  const states = [];
  let curKey = goalKey;
  while (curKey) {
    const [cid, atCode] = curKey.split("|");
    states.push({ corridorId: cid, atCode });
    const p = prev.get(curKey);
    curKey = p?.prevKey || null;
  }
  states.reverse();

  // Bygg legs:
  // First leg: startCode -> first transferCode (om byte sker), inom states[0].corridorId
  // Each transition has viaCode in prev map of the "to" state.
  // We'll reconstruct transfer points by re-walking states with prev map.
  const legs = [];
  if (states.length === 1) {
    legs.push({ corridorId: states[0].corridorId, from: startCode, to: endCode });
    return legs;
  }

  // Re-walk forward using prev to find via codes for each next state
  let currentFrom = startCode;
  for (let i = 1; i < states.length; i++) {
    const toState = states[i];
    const toKey = `${toState.corridorId}|${toState.atCode}`;
    const p = prev.get(toKey);
    const via = p?.viaCode; // bytespunkt
    const fromCorridorId = states[i - 1].corridorId;

    legs.push({ corridorId: fromCorridorId, from: currentFrom, to: via });
    currentFrom = via;
  }
  // Last leg within last corridor
  legs.push({ corridorId: states[states.length - 1].corridorId, from: currentFrom, to: endCode });

  // Rensa ev. tomma legs (om samma from/to)
  return legs.filter(l => l.from && l.to && l.from !== l.to);
}

// Matcha vilka tabell-sträckor i en korridor som överlappar benet from->to (inom korridorordningen)
function matchTabellStrackorForLeg(korridor, fromCode, toCode) {
  const ord = korridor.ordning || [];
  const idx = idxMap(ord);
  if (!idx.has(fromCode) || !idx.has(toCode)) return [];

  const a = idx.get(fromCode);
  const b = idx.get(toCode);
  const tripMin = Math.min(a, b);
  const tripMax = Math.max(a, b);

  const used = [];
  for (const s of (korridor.tabellStrackor || [])) {
    const si = idx.get(s.start);
    const ei = idx.get(s.end);
    if (si === undefined || ei === undefined) continue;

    const secMin = Math.min(si, ei);
    const secMax = Math.max(si, ei);

    if (overlapsInterval(tripMin, tripMax, secMin, secMax)) {
      used.push(s);
    }
  }

  // Sortera i banans ordning
  used.sort((x, y) => {
    const xi = Math.min(idx.get(x.start), idx.get(x.end));
    const yi = Math.min(idx.get(y.start), idx.get(y.end));
    return xi - yi;
  });

  // Dedupe på name+start+end
  const seen = new Set();
  return used.filter(s => {
    const k = `${s.name}|${s.start}|${s.end}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Gruppresultat per linjebokId och unika sträckor
function groupResults({ legs, corridorById, linjebokById }) {
  const grouped = new Map(); // linjebokId -> {linjebok, strackor:Set(key)->obj}
  for (const leg of legs) {
    const k = corridorById.get(leg.corridorId);
    if (!k) continue;

    const lb = linjebokById.get(k.linjebokId) || { id: k.linjebokId, name: "" };
    if (!grouped.has(lb.id)) grouped.set(lb.id, { linjebok: lb, strackor: new Map() });

    const used = matchTabellStrackorForLeg(k, leg.from, leg.to);
    for (const s of used) {
      const key = `${s.name}|${s.start}|${s.end}`;
      grouped.get(lb.id).strackor.set(key, s);
    }
  }

  // Till array i stabil ordning (som data.linjebocker)
  const out = [];
  for (const [lbId, pack] of grouped.entries()) {
    out.push({
      linjebok: pack.linjebok,
      strackor: Array.from(pack.strackor.values())
    });
  }
  return out;
}

function render({ start, end, grouped, legsUsed }) {
  if (!grouped.length) {
    setOutput(
      `${bad("Ingen matchande 'färdig rutt' hittades.")}` +
      `<div style="opacity:.8;margin-top:6px;">` +
      `Det betyder att start/slut inte ligger i samma korridor, och det finns ingen kedja av korridorer som kan kopplas via gemensamma driftplatser i din data.` +
      `</div>`
    );
    return;
  }

  const header =
    `<div style="padding:10px 0;border-bottom:1px solid #ddd;">` +
    `<div><strong>${escapeHtml(start.name)} (${escapeHtml(start.code)})</strong> → <strong>${escapeHtml(end.name)} (${escapeHtml(end.code)})</strong></div>` +
    `</div>`;

  const legsHtml = legsUsed && legsUsed.length
    ? `<div style="opacity:.8;margin:10px 0;">Rutt (korridorben): ${legsUsed.map(l => `${escapeHtml(l.from)}→${escapeHtml(l.to)}`).join(" | ")}</div>`
    : "";

  const blocks = grouped.map(g => {
    const lb = g.linjebok;
    const str = g.strackor;

    const strHtml = str.length
      ? str.map(s => `<div style="padding:8px 0;border-bottom:1px solid #eee;"><strong>${escapeHtml(s.name)}</strong></div>`).join("")
      : `<div style="padding:8px 0;">${warn("Inga tabell-sträckor hittades för den delen.")}</div>`;

    return (
      `<div style="margin-top:12px;padding:12px;background:#fff;border-radius:10px;">` +
      `<div style="padding-bottom:8px;border-bottom:1px solid #eee;"><strong>Linjebok:</strong> ${escapeHtml(lb.id)}${lb.name ? ` – ${escapeHtml(lb.name)}` : ""}</div>` +
      `<div style="margin-top:8px;"><strong>Sträckor i hastighets-PDF att slå upp:</strong></div>` +
      `${strHtml}` +
      `</div>`
    );
  }).join("");

  setOutput(header + legsHtml + blocks);
}

async function searchRoute() {
  const data = await loadData();

  const startInput = document.getElementById("start").value;
  const endInput = document.getElementById("slut").value;

  const dps = data.driftplatser || [];
  const start = parseDriftplats(startInput, dps);
  const end = parseDriftplats(endInput, dps);

  if (!start || !end) {
    setOutput(
      `${bad("Kunde inte hitta start/slut.")}` +
      `<div style="opacity:.8;margin-top:6px;">Välj från listan eller skriv driftplatskod.</div>`
    );
    return;
  }

  const korridorer = data.korridorer || [];
  if (!korridorer.length) {
    setOutput(bad("Inga korridorer finns i data.json."));
    return;
  }

  const linjebokById = new Map((data.linjebocker || []).map(lb => [lb.id, lb]));
  const corridorById = new Map(korridorer.map(k => [k.id, k]));

  // 1) Försök en-korridor-lösning
  const single = pickBestSingleCorridor(korridorer, start.code, end.code);
  let legs = null;

  if (single) {
    legs = [{ corridorId: single.id, from: start.code, to: end.code }];
  } else {
    // 2) Kedja korridorer via gemensamma driftplatser (endast "färdiga rutter")
    legs = findCorridorChain({ korridorer, startCode: start.code, endCode: end.code });
  }

  if (!legs) {
    render({ start, end, grouped: [], legsUsed: null });
    return;
  }

  const grouped = groupResults({ legs, corridorById, linjebokById });
  render({ start, end, grouped, legsUsed: legs });
}

// Exponera till HTML
window.searchRoute = searchRoute;

// Om din HTML har gamla admin-knappar: gör dem ofarliga
window.requestAdmin = () => alert("Adminläge är avstängt i denna version. All data ligger i data.json.");
window.undoLastSave = () => alert("Ingen lokal redigering i denna version. Ändra data.json i repot istället.");
window.resetToDefault = () => alert("Ingen lokal redigering i denna version. Ändra data.json i repot istället.");

// Init
loadData();

