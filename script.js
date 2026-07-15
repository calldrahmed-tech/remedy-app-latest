/* ============================================================
   SMART REMEDY AI — engine
   Loads remedies.json (remedies, biochemics, diseaseProtocols)
   and produces: Primary remedy, Alternatives, Dual-Remedy Regimen,
   Biochemic support, Suggested tests, Diet & lifestyle advice.
   ============================================================ */

let DB = null; // { remedies, biochemics, diseaseProtocols }

const el = (id) => document.getElementById(id);
const inputEl = el("symptomInput");
const resultBtn = el("resultBtn");
const resultsEl = el("results");
const statusEl = el("statusMsg");

/* ---------- load data ---------- */
fetch("remedies.json")
  .then(r => {
    if (!r.ok) throw new Error("Could not load remedies.json (status " + r.status + ")");
    return r.json();
  })
  .then(json => {
    DB = json;
    buildWordDict();
    statusEl.textContent = "";
    resultBtn.disabled = false;
  })
  .catch(err => {
    statusEl.textContent = "Data failed to load: " + err.message + ". Make sure remedies.json is in the same folder as index.html and you're viewing this through a local server or GitHub Pages (not a raw double-clicked file).";
    resultBtn.disabled = true;
  });

resultBtn.disabled = true;
statusEl.textContent = "Loading remedy database…";

/* ---------- Levenshtein fuzzy match (handles typos in symptom text) ---------- */
function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[n];
}

let WORD_DICT = new Set();
let DISEASE_NAME_ENTRIES = []; // { name, protocol }
function buildWordDict() {
  WORD_DICT = new Set();
  DB.remedies.forEach(r => {
    r.keynotes.forEach(k => k.t.split(/\s+/).forEach(w => WORD_DICT.add(w.replace(/[^a-z]/g, ""))));
    (r.diseaseTags || []).forEach(t => t.split(/\s+/).forEach(w => WORD_DICT.add(w.replace(/[^a-z]/g, ""))));
  });
  DB.biochemics.forEach(b => b.keynotes.forEach(k => k.t.split(/\s+/).forEach(w => WORD_DICT.add(w.replace(/[^a-z]/g, "")))));

  DISEASE_NAME_ENTRIES = [];
  DB.diseaseProtocols.forEach(p => {
    p.synonyms.forEach(s => DISEASE_NAME_ENTRIES.push({ name: s, protocol: p, generic: false }));
    (p.genericSynonyms || []).forEach(s => DISEASE_NAME_ENTRIES.push({ name: s, protocol: p, generic: true }));
  });
}

function fuzzyCorrect(word) {
  word = word.toLowerCase().replace(/[^a-z]/g, "");
  if (word.length < 4) return word;
  if (WORD_DICT.has(word)) return word;
  let best = word, bestDist = 3;
  for (const dw of WORD_DICT) {
    if (Math.abs(dw.length - word.length) > 2) continue;
    const d = levenshtein(word, dw);
    if (d < bestDist) { bestDist = d; best = dw; }
  }
  return best;
}

/* ---------- disease-name detection ---------- */
/* Checks whether the raw input text closely matches a known disease/synonym.
   This is checked BEFORE symptom scoring, because a doctor typing "GERD" or
   "H pylori" wants the curated clinical protocol, not just keyword overlap. */
function wordBoundaryMatch(text, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("\\b" + escaped.replace(/\s+/g, "\\s+") + "\\b", "i");
  return re.test(text);
}
function detectDiseaseProtocol(rawText) {
  const t = rawText.toLowerCase().trim();
  // Tier 1: specific disease names / acronyms (e.g. "ibs", "gerd", "chronic constipation").
  // These take priority so a named diagnosis is never overridden by a generic symptom word
  // that happens to also appear in the same sentence.
  let best = null, bestScore = 0;
  DISEASE_NAME_ENTRIES.filter(e => !e.generic).forEach(entry => {
    const name = entry.name.toLowerCase();
    if (wordBoundaryMatch(t, name)) {
      const score = name.length;
      if (score > bestScore) { bestScore = score; best = entry.protocol; }
    }
  });
  if (best) return best;
  // Tier 2: only fall back to generic single-word synonyms if no specific name was found.
  DISEASE_NAME_ENTRIES.filter(e => e.generic).forEach(entry => {
    const name = entry.name.toLowerCase();
    if (wordBoundaryMatch(t, name)) {
      const score = name.length;
      if (score > bestScore) { bestScore = score; best = entry.protocol; }
    }
  });
  return best;
}

/* ---------- symptom-based scoring engine ----------
   Weighted keynote matching normalized by each remedy's own max score.
   A remedy's confidence is judged relative to how much of ITS OWN picture
   was confirmed — this is what stops a common polychrest from dominating
   every unrelated query while still letting it be reached on its own
   peculiar symptoms. */
const STOPWORDS = new Set(["a","an","the","and","or","but","with","without","who","that","which","this",
  "these","those","is","are","was","were","be","been","of","in","on","to","as","from","or","for","at",
  "by","dont","cannot","cant","its","it","especially","very","also","not","no","during","after","before",
  "least","slightest","any","every","all","most","more","less","much"]);

function scoreRemedies(inputText, diseaseProtocol) {
  const rawWords = inputText.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const corrected = rawWords.map(fuzzyCorrect);
  const inputSet = new Set(corrected);

  const boostIds = diseaseProtocol ? new Set(diseaseProtocol.primaryRemedies) : new Set();

  const results = [];
  DB.remedies.forEach(r => {
    let score = 0;
    const matched = [];
    r.keynotes.forEach(k => {
      // split on ANY non-letter (matches how input text is tokenized) — splitting only
      // on whitespace was merging slash/hyphen-joined words like "tonsillitis/quinsy"
      // into one unmatchable glued token ("tonsillitisquinsy").
      const kWords = k.t.toLowerCase().split(/[^a-z]+/).filter(w => w && !STOPWORDS.has(w));
      if (!kWords.length) return;
      const hitCount = kWords.reduce((c, w) => c + (inputSet.has(w) ? 1 : 0), 0);
      const ratio = hitCount / kWords.length;
      // short keynotes need a stricter match: a 2-word phrase matching on just 1 word
      // is often coincidental overlap of unrelated concepts (e.g. "loss of memory" vs
      // "weight loss" both contain "loss" but mean nothing alike) — require a fuller
      // match the shorter the keynote is.
      const minRatio = kWords.length <= 2 ? 1.0 : (kWords.length <= 4 ? 0.66 : 0.5);
      if (ratio >= minRatio) {
        score += k.w * ratio;
        matched.push(k.t);
      }
    });
    // small disease-tag boost so relevant remedies surface even with sparse free text
    if ((r.diseaseTags || []).some(tag => inputSet.has(tag.split(" ")[0]))) score += 0.5;
    if (boostIds.has(r.id)) score += 1.5; // curated protocol boost

    if (score > 0) {
      // percent is on a fixed absolute scale, not relative to this remedy's own total
      // keynote count — otherwise enriching a remedy with more real keynotes (which is
      // exactly what makes matching better) would perversely make its displayed
      // confidence go DOWN. ~4 raw-score points (roughly 2 solid symptom matches) reads
      // as a strong, high-confidence match.
      const percent = Math.round(Math.min(100, (score / 4) * 100));
      results.push({ remedy: r, rawScore: score, percent, matched });
    }
  });
  results.sort((a, b) => b.rawScore - a.rawScore);
  return results;
}

/* precompute maxScore per remedy once DB loads is handled lazily on first score call */
function ensureMaxScores() {
  DB.remedies.forEach(r => { if (r.maxScore === undefined) r.maxScore = r.keynotes.reduce((s, k) => s + k.w, 0); });
}

/* ---------- biochemic scoring (independent pool) ---------- */
function scoreBiochemics(inputText) {
  const rawWords = inputText.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const corrected = rawWords.map(fuzzyCorrect);
  const inputSet = new Set(corrected);
  const results = [];
  DB.biochemics.forEach(b => {
    let score = 0;
    b.keynotes.forEach(k => {
      const kWords = k.t.toLowerCase().split(/[^a-z]+/).filter(w => w && !STOPWORDS.has(w));
      if (!kWords.length) return;
      const hitCount = kWords.reduce((c, w) => c + (inputSet.has(w) ? 1 : 0), 0);
      const ratio = hitCount / kWords.length;
      const minRatio = kWords.length <= 2 ? 1.0 : (kWords.length <= 4 ? 0.66 : 0.5);
      if (ratio >= minRatio) score += k.w * ratio;
    });
    if (score > 0) results.push({ biochemic: b, score });
  });
  results.sort((a, b) => b.score - a.score);
  return results;
}

/* ---------- fallback Dual-Remedy Regimen / tests / diet when no curated disease protocol matched ---------- */
const SYSTEM_FALLBACK = {
  gut: {
    tests: ["Stool routine and microscopy", "Abdominal ultrasound if pain persists", "CBC and inflammatory markers if chronic"],
    diet: { eat: ["Small frequent easily-digestible meals", "Warm fluids, soluble fiber"], avoid: ["Spicy fried food", "Carbonated drinks", "Irregular meal timing"] }
  },
  respiratory: {
    tests: ["Chest examination / X-ray if persistent", "Peak flow / spirometry if recurrent wheeze", "CBC"],
    diet: { eat: ["Warm fluids, steam inhalation", "Vitamin C rich fruits"], avoid: ["Cold drinks", "Dust and smoke exposure"] }
  },
  nerves: {
    tests: ["Thyroid profile (TSH)", "Vitamin B12 and D levels", "Blood pressure check"],
    diet: { eat: ["Regular sleep schedule", "Magnesium-rich foods"], avoid: ["Excess caffeine", "Screen time before bed"] }
  },
  skin: {
    tests: ["Allergy panel (IgE) if suspected trigger", "Skin scraping if fungal suspected"],
    diet: { eat: ["Omega-3 rich foods", "Adequate hydration"], avoid: ["Known food allergens", "Harsh soaps"] }
  },
  joints: {
    tests: ["ESR / CRP if inflammatory picture", "Uric acid if gout suspected", "X-ray of affected joint"],
    diet: { eat: ["Anti-inflammatory foods - turmeric, ginger", "Adequate hydration"], avoid: ["Excess purine-rich food (red meat, organ meat)", "Prolonged inactivity"] }
  },
  liver: {
    tests: ["Liver function test (LFT)", "Abdominal ultrasound"],
    diet: { eat: ["Light, low-fat meals", "Bitter greens"], avoid: ["Alcohol", "Fried and fatty food"] }
  },
  default: {
    tests: ["General physical examination", "CBC and basic metabolic panel if symptoms persist beyond a week"],
    diet: { eat: ["Balanced light diet", "Adequate hydration and rest"], avoid: ["Irregular meals", "Self-medication beyond a few days without review"] }
  }
};

function fallbackAdvice(topRemedy) {
  const sys = topRemedy ? (topRemedy.system || [])[0] : null;
  return SYSTEM_FALLBACK[sys] || SYSTEM_FALLBACK.default;
}

/* ---------- rendering ---------- */
function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; }

function runSearch() {
  const text = inputEl.value.trim();
  if (!DB) { resultsEl.innerHTML = `<div class="msg">Database still loading — try again in a moment.</div>`; return; }
  if (!text) { resultsEl.innerHTML = `<div class="msg">Enter a symptom description or disease name first.</div>`; return; }

  ensureMaxScores();
  const diseaseProtocol = detectDiseaseProtocol(text);
  const remedyResults = scoreRemedies(text, diseaseProtocol);
  const biochemicResults = scoreBiochemics(text);

  if (!remedyResults.length && !diseaseProtocol) {
    resultsEl.innerHTML = `<div class="msg">No confident match found. Try adding a modality (worse/better from what), the mind state, or the single most peculiar symptom — these score highest.</div>`;
    return;
  }

  const top = remedyResults[0];
  const alternatives = remedyResults.slice(1, 3);

  let html = "";
  let n = 1;

  /* Primary remedy */
  html += section(n++, "Primary Remedy", top ? remedyCard(top, "red", "Most probable") : `<div class="msg">No strong classical match from symptoms alone — relying on the matched disease protocol below.</div>`);

  /* Alternatives — colour-coded by how strong the match is: green = strong support,
     blue = worth weighing as a differential */
  if (alternatives.length) {
    html += section(n++, "Alternative Remedies", alternatives.map(a => {
      const color = a.percent >= 60 ? "green" : "blue";
      const label = a.percent >= 60 ? "Strong support" : "Consider";
      return remedyCard(a, color, label);
    }).join(""));
  }

  /* Dual-remedy regimen (an AM/PM combination approach) */
  let regimen;
  if (diseaseProtocol) {
    regimen = diseaseProtocol.banerji;
  } else if (top && alternatives.length) {
    regimen = { morning: `${top.remedy.name} ${top.remedy.potency.acute !== "-" ? top.remedy.potency.acute.split(",")[0] : "30C"}`,
                evening: `${alternatives[0].remedy.name} ${alternatives[0].remedy.potency.acute !== "-" ? alternatives[0].remedy.potency.acute.split(",")[0] : "30C"}`,
                note: "Derived pairing based on top two symptom matches — confirm against the full case before continuing beyond a few days." };
  } else {
    regimen = null;
  }
  if (regimen) {
    html += section(n++, "Dual-Remedy Regimen", `
      <div class="dual">
        <div class="plan">
          ${regimen.morning && regimen.morning !== "-" ? `<span>🌅 Morning: ${esc(regimen.morning)}</span>` : ""}
          ${regimen.evening && regimen.evening !== "-" ? `<span>🌙 Evening: ${esc(regimen.evening)}</span>` : ""}
        </div>
        ${regimen.note ? `<div class="note">${esc(regimen.note)}</div>` : ""}
      </div>`);
  }

  /* Biochemic support */
  let biochemicHtml = "";
  if (diseaseProtocol && diseaseProtocol.biochemic) {
    biochemicHtml = `<div class="biochemic-item"><b>${esc(diseaseProtocol.biochemic)}</b></div>`;
  } else if (biochemicResults.length) {
    biochemicHtml = biochemicResults.slice(0, 2).map(b =>
      `<div class="biochemic-item"><b>${esc(b.biochemic.name)} (${esc(b.biochemic.abbr)})</b> — ${esc(b.biochemic.potency)}</div>`).join("");
  } else {
    biochemicHtml = `<div class="msg">No specific tissue salt indicated from this input — biochemics work best matched to a clear physical picture.</div>`;
  }
  html += section(n++, "Biochemic Support", biochemicHtml);

  /* Tests + Diet — test items shown as yellow dots (caution / needs confirmation) */
  const advice = diseaseProtocol ? { tests: diseaseProtocol.tests, diet: diseaseProtocol.diet } : fallbackAdvice(top ? top.remedy : null);
  html += section(n++, "Suggested Tests", `<div class="list">${advice.tests.map(t => `<div class="item"><span class="dot yellow"></span><div>${esc(t)}</div></div>`).join("")}</div>`);
  html += section(n++, "Diet & Lifestyle Advice", `
    <div class="diet-grid">
      <div class="diet-col eat"><h4>Helpful</h4><ul>${(advice.diet.eat || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>
      <div class="diet-col avoid"><h4>Avoid</h4><ul>${(advice.diet.avoid || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>
    </div>`);

  /* caution for constitutional / nosode remedies */
  const cautionNeeded = (top && (top.remedy.category === "constitutional" || top.remedy.nosode)) ||
                         alternatives.some(a => a.remedy.category === "constitutional" || a.remedy.nosode);
  if (cautionNeeded) {
    html += `<div class="caution">One or more suggested remedies is a deep-acting constitutional or nosode remedy. Repetition and potency changes are best guided by a full case-taking and professional supervision.</div>`;
  }

  resultsEl.innerHTML = html;
}

function section(num, title, bodyHtml) {
  return `<div class="section"><div class="section-head"><span class="n">${num}</span>${esc(title)}</div>${bodyHtml}</div>`;
}

function remedyCard(r, color, label) {
  const rem = r.remedy;
  const isPrimary = color === "red";
  return `<div class="remedy ${isPrimary ? "top red" : color === "green" ? "support" : "diff"}">
    <div class="remedy-row">
      <div><div class="remedy-name ${isPrimary ? "" : "sm"}">${esc(rem.name)}</div><div class="latin">${esc(rem.abbr)}</div></div>
      <div class="badges">
        <span class="badge ${color}">${esc(label)}</span>
        ${rem.nosode ? '<span class="badge yellow">Nosode</span>' : ""}
      </div>
    </div>
    ${r.matched.length ? `<div class="why">Matched: ${r.matched.map(esc).join("; ")} (${r.percent}% confidence)</div>` : ""}
    <div class="potency-row">
      ${rem.potency.acute !== "-" ? `<span class="pot">Acute: <b>${esc(rem.potency.acute)}</b></span>` : ""}
      ${rem.potency.chronic !== "-" ? `<span class="pot">Chronic: <b>${esc(rem.potency.chronic)}</b></span>` : ""}
    </div>
  </div>`;
}


resultBtn.addEventListener("click", runSearch);
inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) runSearch(); });

document.querySelectorAll(".sample-chip").forEach(chip => {
  chip.addEventListener("click", () => { inputEl.value = chip.dataset.sample; runSearch(); });
});
