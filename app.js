// =========================
//  Linjebok + Hastighetssträcka (superenkel)
//  - Ingen server
//  - Autosuggest
//  - Admin: klistra in data, spara i localStorage
// =========================

const LS_KEY = "lokapp_dataset_v1";
let DATA = null;

async function loadDefaultData() {
  const res = await fetch("data.json");
  return await res.json();
}

function normalize(s) {
  return (s || "").toLowerCase().trim();
}

function setMsg(elId, msg) {
  const el = document.getElementById(elId);
  if (el) el.textContent = msg || "";
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

  // Om användaren valde "Namn (CODE)"
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

  // "contains" i namn
  dp = driftsplatser.find(d => normalize(d.name).includes(q));
  if (dp) return dp;

  return null;
}

function getIndexMap(orderedCodes) {
  const idx = new Map();
  orderedCodes.forEach((c, i) => idx.set(c, i));
  return idx;
}

function overlapsInterval(aMin, aMax, bMin, bMax) {
  return !(bMax < aMin || bMin > aMax);
}

// Matcha vilka sträckor i hastighets-PDF som överlappar resan
function matchHastighetsStrackor(orderedCodes, hastighetsStrackor, startCode, endCode) {
  const idx = getIndexMap(orderedCodes);
  const a = idx.get(startCode);
  const b = idx.get(endCode);
  if (a === undefined || b === undefined) return [];

  const tripMin = Math.min(a, b);
  const tripMax = Math.max(a, b);

  const used = [];
  for (const hs of (hastighetsStrackor || [])) {
    const s = idx.get(hs.start);
    const t = idx.get(hs.end);
    if (s === undefined || t === undefined) continue;

    const secMin = Math.min(s, t);
    const secMax = Math.max(s, t);

    if (overlapsInterval(tripMin, tripMax, secMin, secMax)) used.push(hs);
  }

  // sortera i ordning längs banan
  used.sort((x, y) => {
    const xi = Math.min(idx.get(x.start), idx.get(x.end));
    const yi = Math.min(idx.get(y.start), idx.get(y.end));
    return xi - yi;
  });

  // dedupe på id (om du råkar klistra in dubbelt)
  const seen = new Set();
  return used.filter(u => (seen.has(u.id) ? false : (seen.add(u.id), true)));
}

function renderOutput({ start, end, linjebok, usedStrackor }) {
  const out = document.getElementById("output");
  const strackorHtml = usedStrackor.length
    ? usedStrackor.map(s => `<div class="line"><strong>${escapeHtml(s.name)}</strong></div>`).join("")
    : `<div class="line">Ingen träff. (Kontrollera att start/slut ligger i samma dataset och att sträckorna är inlagda.)</div>`;

  out.innerHTML = `
    <div class="line">
      <div><strong>${escapeHtml(start.name)} (${escapeHtml(start.code)})</strong> → <strong>${escapeHtml(end.name)} (${escapeHtml(end.code)})</strong></div>
    </div>

    <div class="line">
      <div><strong>1) Linjebok</strong></div>
      <div>${escapeHtml(linjebok.id)}: ${escapeHtml(linjebok.name)}</div>
    </div>

    <div>
      <div><strong>2) Sträcka i hastighets-PDF</strong></div>
      ${strackorHtml}
    </div>
  `;
}

function escapeHtml(s) {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function getData() {
  if (DATA) return DATA;

  // 1) Försök läsa från localStorage
  const raw = localStorage.getItem(LS_KEY);
  if (raw) {
    try {
      DATA = JSON.parse(raw);
      buildAutoSuggest(DATA);
      return DATA;
    } catch (e) {
      // fall back till default
      console.warn("Kunde inte läsa localStorage dataset:", e);
    }
  }

  // 2) Annars default från data.json
  DATA = await loadDefaultData();
  buildAutoSuggest(DATA);
  return DATA;
}

async function searchRoute() {
  const data = await getData();

  const startInput = document.getElementById("start").value;
  const endInput = document.getElementById("slut").value;

  const dps = data.driftplatser || [];
  const start = parseDriftplats(startInput, dps);
  const end = parseDriftplats(endInput, dps);

  if (!start || !end) {
    document.getElementById("output").innerHTML =
      "Kunde inte hitta start/slut. Välj från listan eller skriv driftplatskod.";
    return;
  }

  // Vi jobbar med "ordnad lista" av driftplatskoder (enkelast möjliga modell)
  const orderedCodes = (data.ordning || []).slice();
  const idx = getIndexMap(orderedCodes);

  if (!idx.has(start.code) || !idx.has(end.code)) {
    document.getElementById("output").innerHTML =
      "Start/slut finns inte i den inlagda driftplatsordningen. Öppna 'Redigera data' och kontrollera att båda finns med.";
    return;
  }

  const used = matchHastighetsStrackor(
    orderedCodes,
    data.hastighetsStrackor || [],
    start.code,
    end.code
  );

  renderOutput({
    start,
    end,
    linjebok: data.linjebok,
    usedStrackor: used
  });
}

// ===== Admin UI =====

function toggleAdmin() {
  const el = document.getElementById("admin");
  if (!el) return;
  if (el.style.display === "block") hideAdmin();
  else showAdmin();
}

function showAdmin() {
  const el = document.getElementById("admin");
  if (!el) return;
  el.style.display = "block";
  hydrateAdminFromData();
  setMsg("adminMsg", "");
}

function hideAdmin() {
  const el = document.getElementById("admin");
  if (!el) return;
  el.style.display = "none";
  setMsg("adminMsg", "");
}

function parseDpLines(text) {
  const lines = (text || "").split("\n").map(l => l.trim()).filter(Boolean);
  const driftplatser = [];
  const ordning = [];

  for (const line of lines) {
    const parts = line.split(";");
    if (parts.length < 2) continue;
    const code = parts[0].trim();
    const name = parts.slice(1).join(";").trim();
    if (!code || !name) continue;
    driftplatser.push({ code, name });
    ordning.push(code);
  }
  return { driftplatser, ordning };
}

function parseHsLines(text) {
  const lines = (text || "").split("\n").map(l => l.trim()).filter(Boolean);
  const hastighetsStrackor = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parts = line.split("|").map(x => x.trim());
    if (parts.length < 3) continue;

    const name = parts[0];
    const start = parts[1];
    const end = parts[2];
    if (!name || !start || !end) continue;

    hastighetsStrackor.push({
      id: `HS_${i + 1}_${start}_${end}`,
      name,
      start,
      end
    });
  }
  return hastighetsStrackor;
}

async function hydrateAdminFromData() {
  const data = await getData();

  document.getElementById("lbId").value = data.linjebok?.id || "";
  document.getElementById("lbName").value = data.linjebok?.name || "";

  // driftplatser i ordning
  const codeToName = new Map((data.driftplatser || []).map(d => [d.code, d.name]));
  const dpLines = (data.ordning || []).map(code => `${code};${codeToName.get(code) || ""}`).join("\n");
  document.getElementById("dpText").value = dpLines;

  // hastighetssträckor
  const hsLines = (data.hastighetsStrackor || []).map(h => `${h.name}|${h.start}|${h.end}`).join("\n");
  document.getElementById("hsText").value = hsLines;
}

async function saveAdmin() {
  const lbId = document.getElementById("lbId").value.trim();
  const lbName = document.getElementById("lbName").value.trim();
  const dpText = document.getElementById("dpText").value;
  const hsText = document.getElementById("hsText").value;

  if (!lbId || !lbName) {
    setMsg("adminMsg", "Fyll i linjebok ID och namn.");
    return;
  }

  const { driftplatser, ordning } = parseDpLines(dpText);
  if (driftplatser.length < 2) {
    setMsg("adminMsg", "Du behöver minst 2 driftplatser i ordning (KOD;Namn).");
    return;
  }

  const hastighetsStrackor = parseHsLines(hsText);

  // validera att HS-koder finns i ordningen
  const ordSet = new Set(ordning);
  const bad = hastighetsStrackor.filter(h => !ordSet.has(h.start) || !ordSet.has(h.end));
  if (bad.length) {
    setMsg("adminMsg", "Några sträckor använder koder som inte finns i driftplatslistan. Kontrollera START/SLUT-koder.");
    return;
  }

  const dataset = {
    linjebok: { id: lbId, name: lbName },
    driftplatser,
    ordning,
    hastighetsStrackor
  };

  localStorage.setItem(LS_KEY, JSON.stringify(dataset));
  DATA = dataset;

  buildAutoSuggest(DATA);
  setMsg("adminMsg", "Sparat! Du kan stänga och söka direkt.");

  // uppdatera output så man ser att allt funkar
  document.getElementById("output").innerHTML = "Sparat. Gör en sökning ovan för att testa.";
}

async function resetToDefault() {
  localStorage.removeItem(LS_KEY);
  DATA = await loadDefaultData();
  buildAutoSuggest(DATA);
  hideAdmin();
  document.getElementById("output").innerHTML = "Återställt till standarddata. Testa en sökning.";
}

// Init
getData();

