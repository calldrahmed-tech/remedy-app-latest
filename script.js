/* ============================================================
   SMART REMEDY AI — engine
   Loads remedies.json (remedies, biochemics, diseaseProtocols)
   and produces: Primary remedy, Alternatives, Dual-Remedy Regimen,
   Biochemic support, Suggested tests, Diet & lifestyle advice.
   ============================================================ */

let DB = null;        // { remedies, biochemics, diseaseProtocols }
let REPERTORY = null; // { repertory: [ {section, rubric, triggers, remedies:[{id,grade}]} ] }

const el = (id) => document.getElementById(id);
const inputEl = el("symptomInput");
const resultBtn = el("resultBtn");
const resultsEl = el("results");
const statusEl = el("statusMsg");

/* ---------- load data ----------
   remedies.json (materia medica keynotes) and repertory.json (graded rubric->remedy
   mappings) are loaded together. The repertory is the PRIMARY driver of remedy ranking —
   materia medica keynote matching only confirms/supports a repertory-driven pick, per the
   clinical reasoning that curated rubric-remedy relationships are far more reliable than
   incidental prose word-overlap. */
Promise.all([
  fetch("remedies.json").then(r => {
    if (!r.ok) throw new Error("Could not load remedies.json (status " + r.status + ")");
    return r.json();
  }),
  fetch("repertory.json").then(r => {
    if (!r.ok) throw new Error("Could not load repertory.json (status " + r.status + ")");
    return r.json();
  })
])
  .then(([remediesJson, repertoryJson]) => {
    DB = remediesJson;
    REPERTORY = repertoryJson.repertory;
    buildWordDict();
    statusEl.textContent = "";
    resultBtn.disabled = false;
  })
  .catch(err => {
    statusEl.textContent = "Data failed to load: " + err.message + ". Make sure remedies.json and repertory.json are both in the same folder as index.html, and you're viewing this through a local server or GitHub Pages (not a raw double-clicked file).";
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
  "least","slightest","any","every","all","most","more","less","much",
  // "worse"/"better" are treated as optional here: a doctor typing "pain with motion" clearly
  // means the same clinical fact as "worse from motion" even without the polarity word — the
  // actual content word (motion, eating, touch, etc.) is what should drive the match. The full
  // keynote text (including "worse"/"better") still displays correctly in the results either way.
  "worse", "better"]);

// Lightweight stemming: "tonsils" and "tonsillitis" are different words (too far apart for
// typo-correction), but share a root a doctor would recognize as the same concept. Words of
// 5+ letters that share their first 5 characters are treated as the same word for matching —
// this catches plurals and common medical suffixes (-itis, -osis, -al, -ic) without a full
// stemming library.
function wordsMatch(a, b) {
  if (a === b) return true;
  if (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5)) return true;
  return false;
}
function countHits(kWords, inputWords) {
  return kWords.reduce((c, kw) => c + (inputWords.some(iw => wordsMatch(kw, iw)) ? 1 : 0), 0);
}

/* ---------- repertory scoring (PRIMARY driver of remedy ranking) ----------
   For each rubric, check whether any of its trigger phrases appear in the input text
   (substring match on the normalized text — rubric triggers are short curated phrases,
   not single generic words, so simple substring matching is reliable here without the
   partial-word-ratio machinery the materia medica matcher needs). For every rubric that
   fires, every remedy listed under it gets its grade added to a running total. A remedy
   matching multiple DIFFERENT rubrics (e.g. both "thirstless" AND "worse from heat")
   accumulates evidence across distinct clinical facts — this is literally how real
   repertorization combines symptoms, and is far more reliable than prose keyword overlap. */
function scoreRepertory(inputText) {
  const t = " " + inputText.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ") + " ";
  const remedyScores = {};      // id -> accumulated grade total
  const remedyRubrics = {};     // id -> [ "Section: rubric text", ... ] (for display)
  if (!REPERTORY) return { remedyScores, remedyRubrics, firedRubrics: [] };

  const firedRubrics = [];
  REPERTORY.forEach(rubric => {
    const fired = rubric.triggers.some(trigger => t.includes(" " + trigger.toLowerCase() + " ") || t.includes(trigger.toLowerCase()));
    if (!fired) return;
    firedRubrics.push(`${rubric.section}: ${rubric.rubric}`);
    rubric.remedies.forEach(r => {
      remedyScores[r.id] = (remedyScores[r.id] || 0) + r.grade;
      remedyRubrics[r.id] = remedyRubrics[r.id] || [];
      remedyRubrics[r.id].push(`${rubric.section}: ${rubric.rubric}`);
    });
  });
  return { remedyScores, remedyRubrics, firedRubrics };
}

function scoreRemedies(inputText, diseaseProtocol) {
  const rawWords = inputText.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const corrected = rawWords.map(fuzzyCorrect);
  const inputWords = [...new Set(corrected)];

  const boostIds = diseaseProtocol ? new Set(diseaseProtocol.primaryRemedies) : new Set();

  // Repertory score is the PRIMARY signal: curated rubric->remedy grades, combined across
  // every rubric the case matches. Materia medica keynote matching (below) only adds a
  // smaller CONFIRMATORY amount on top — it can support or nudge a repertory-driven pick,
  // but can't manufacture a top result out of prose overlap alone the way it used to.
  const { remedyScores: repScores, remedyRubrics } = scoreRepertory(inputText);
  const REP_WEIGHT = 1.4;     // multiplier per repertory grade point
  const MM_WEIGHT = 0.35;     // multiplier applied to the materia medica confirmation score

  const results = [];
  const TOP_N = 6; // only the strongest few materia-medica matches count toward confirmation
                    // & display — stops a remedy with dozens of keynotes that each weakly
                    // share a generic word (e.g. "right", "side", "pain" scattered across
                    // unrelated body systems) from out-accumulating a genuinely strong match.
  DB.remedies.forEach(r => {
    const candidates = [];
    r.keynotes.forEach(k => {
      // split on ANY non-letter (matches how input text is tokenized) — splitting only
      // on whitespace was merging slash/hyphen-joined words like "tonsillitis/quinsy"
      // into one unmatchable glued token ("tonsillitisquinsy").
      const kWords = k.t.toLowerCase().split(/[^a-z]+/).filter(w => w && !STOPWORDS.has(w));
      if (!kWords.length) return;
      const hitCount = countHits(kWords, inputWords);
      const ratio = hitCount / kWords.length;
      if (ratio > 0) candidates.push({ t: k.t, strength: k.w * ratio });
    });
    candidates.sort((a, b) => b.strength - a.strength);
    const top = candidates.slice(0, TOP_N);
    const mmScore = top.reduce((s, c) => s + c.strength, 0);
    const matched = top.map(c => c.t);

    const repScore = repScores[r.id] || 0;
    let score = repScore * REP_WEIGHT + mmScore * MM_WEIGHT;

    // NOTE: a generic disease-tag boost used to live here (any input word matching the
    // first word of any diseaseTag added a flat +0.5). Removed — it was too crude: e.g.
    // Belladonna's "fever" tag matched the word "fever" in ANY query mentioning fever at
    // all, awarding a boost with zero actual symptom evidence behind it. The repertory
    // system and materia medica confirmation now carry all the real evidence.
    if (boostIds.has(r.id)) score += 0.4; // curated protocol boost — small nudge only; must not
                                            // be able to override a genuine multi-rubric
                                            // repertory match (e.g. a disease-protocol remedy
                                            // shouldn't beat a constitutional remedy that fits
                                            // the actual case better just because the disease
                                            // name was also mentioned in the same sentence)

    if (score > 0) {
      // percent is on a fixed absolute scale, not relative to this remedy's own total
      // keynote count — otherwise enriching a remedy with more real keynotes (which is
      // exactly what makes matching better) would perversely make its displayed
      // confidence go DOWN. ~4 raw-score points reads as a strong, high-confidence match.
      const percent = Math.round(Math.min(100, (score / 4) * 100));
      results.push({
        remedy: r, rawScore: score, percent, matched,
        repertoryRubrics: remedyRubrics[r.id] || [],
        fromRepertory: repScore > 0
      });
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
  const inputWords = [...new Set(corrected)];
  const results = [];
  DB.biochemics.forEach(b => {
    let score = 0;
    b.keynotes.forEach(k => {
      const kWords = k.t.toLowerCase().split(/[^a-z]+/).filter(w => w && !STOPWORDS.has(w));
      if (!kWords.length) return;
      const hitCount = countHits(kWords, inputWords);
      const ratio = hitCount / kWords.length;
      if (ratio > 0) score += k.w * ratio;
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

/* When no biochemic keynote specifically matches the free text, still surface 1-2 sensible
   general-support tissue salts by system affinity, so biochemic support is never empty —
   per "include 1-2 biochemic remedies for every condition". These are clearly labelled as
   general support rather than symptom-matched. */
const BIOCHEMIC_SYSTEM_FALLBACK = {
  gut: ["nat-phos", "kali-mur"],
  respiratory: ["ferrum-phos", "kali-mur"],
  nerves: ["kali-phos-bc", "mag-phos"],
  skin: ["calc-sulph", "silicea-bc"],
  joints: ["calc-fluor", "mag-phos"],
  liver: ["nat-sulph-bc", "nat-phos"],
  default: ["kali-phos-bc", "nat-mur-bc"]
};
function fallbackBiochemicFor(topRemedy) {
  const sys = topRemedy ? (topRemedy.system || [])[0] : null;
  const ids = BIOCHEMIC_SYSTEM_FALLBACK[sys] || BIOCHEMIC_SYSTEM_FALLBACK.default;
  return ids.map(id => DB.biochemics.find(b => b.id === id)).filter(Boolean).slice(0, 2);
}

/* ---------- rendering ---------- */
function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; }

const CHRONICITY_WORDS = ["chronic", "recurrent", "recurring", "for years", "since childhood",
  "longstanding", "long standing", "repeated", "keeps coming back", "keeps returning",
  "for months", "since birth", "lifelong"];
function isChronicContext(text) {
  const t = text.toLowerCase();
  return CHRONICITY_WORDS.some(w => t.includes(w));
}

/* Materia medica note: a short, general descriptive snapshot of the remedy (its own top
   keynotes by weight) shown for every displayed remedy — independent of which specific
   words matched this query. This is "for confirmation" context, not the match evidence. */
function materiaMedicaNote(remedy) {
  const sorted = [...remedy.keynotes].sort((a, b) => b.w - a.w);
  return sorted.slice(0, 3).map(k => k.t).join("; ");
}

function runSearch() {
  const text = inputEl.value.trim();
  if (!DB) { resultsEl.innerHTML = `<div class="msg">Database still loading — try again in a moment.</div>`; return; }
  if (!text) { resultsEl.innerHTML = `<div class="msg">Enter a symptom description or disease name first.</div>`; return; }

  ensureMaxScores();
  const diseaseProtocol = detectDiseaseProtocol(text);
  let remedyResults = scoreRemedies(text, diseaseProtocol);
  const biochemicResults = scoreBiochemics(text);

  // Nosodes only surface in chronic or clearly-indicated cases — a nosode showing up on a
  // simple acute query (with no chronicity language and no strong disease-protocol reason)
  // is more likely to alarm a patient than help, and nosode prescribing genuinely warrants
  // a deliberate, chronic-case decision rather than falling out of ordinary symptom matching.
  const chronic = isChronicContext(text);
  const diseaseProtocolIndicatesNosode = diseaseProtocol && (diseaseProtocol.primaryRemedies || []).some(id => {
    const rem = DB.remedies.find(r => r.id === id);
    return rem && rem.nosode;
  });
  if (!chronic && !diseaseProtocolIndicatesNosode) {
    remedyResults = remedyResults.filter(r => !r.remedy.nosode);
  }

  if (!remedyResults.length && !diseaseProtocol) {
    resultsEl.innerHTML = `<div class="msg">No confident match found. Try adding a modality (worse/better from what), the mind state, or the single most peculiar symptom — these score highest.</div>`;
    return;
  }

  const top = remedyResults[0];
  const secondary = remedyResults.slice(1, 3);       // 2 secondary remedies
  const supportive = remedyResults.slice(3, 8);      // 3-5 supportive remedies

  let html = "";
  let n = 1;

  /* Top remedy, with potency suggestion front and centre */
  html += section(n++, "Top Remedy", top ? remedyCard(top, "red", "Most probable") : `<div class="msg">No strong classical match from symptoms alone — relying on the matched disease protocol below.</div>`);

  /* Secondary remedies — the next-strongest, genuinely competitive picks */
  if (secondary.length) {
    html += section(n++, "Secondary Remedies", secondary.map(a => remedyCard(a, "green", "Secondary")).join(""));
  }

  /* Supportive remedies — broader list worth keeping in view, not ruled out */
  if (supportive.length) {
    html += section(n++, "Supportive Remedies", supportive.map(a => remedyCard(a, "blue", "Supportive")).join(""));
  }

  /* Dual-remedy regimen (an AM/PM combination approach) */
  let regimen;
  if (diseaseProtocol) {
    regimen = diseaseProtocol.banerji;
  } else if (top && secondary.length) {
    regimen = { morning: `${top.remedy.name} ${top.remedy.potency.acute !== "-" ? top.remedy.potency.acute.split(",")[0] : "30C"}`,
                evening: `${secondary[0].remedy.name} ${secondary[0].remedy.potency.acute !== "-" ? secondary[0].remedy.potency.acute.split(",")[0] : "30C"}`,
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

  /* Biochemic support — always shows 1-2, falling back to a system-affinity default when
     nothing in the free text specifically matches a tissue salt keynote, per "include 1-2
     biochemic remedies for every condition". */
  let biochemicHtml = "";
  if (diseaseProtocol && diseaseProtocol.biochemic) {
    biochemicHtml = `<div class="biochemic-item"><b>${esc(diseaseProtocol.biochemic)}</b></div>`;
  } else if (biochemicResults.length) {
    biochemicHtml = biochemicResults.slice(0, 2).map(b =>
      `<div class="biochemic-item"><b>${esc(b.biochemic.name)} (${esc(b.biochemic.abbr)})</b> — ${esc(b.biochemic.potency)}</div>`).join("");
  } else {
    const fallbackBiochemics = fallbackBiochemicFor(top ? top.remedy : null);
    biochemicHtml = fallbackBiochemics.map(b =>
      `<div class="biochemic-item"><b>${esc(b.name)} (${esc(b.abbr)})</b> — ${esc(b.potency)} <span class="note">(general support — no specific tissue-salt symptom detected)</span></div>`).join("");
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
                         secondary.some(a => a.remedy.category === "constitutional" || a.remedy.nosode) ||
                         supportive.some(a => a.remedy.category === "constitutional" || a.remedy.nosode);
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
  const rubrics = r.repertoryRubrics || [];
  return `<div class="remedy ${isPrimary ? "top red" : color === "green" ? "support" : "diff"}">
    <div class="remedy-row">
      <div><div class="remedy-name ${isPrimary ? "" : "sm"}">${esc(rem.name)}</div><div class="latin">${esc(rem.abbr)}</div></div>
      <div class="badges">
        <span class="badge ${color}">${esc(label)}</span>
        ${rem.nosode ? '<span class="badge yellow">Nosode</span>' : ""}
      </div>
    </div>
    ${rubrics.length ? `<div class="why"><b>Repertory match</b> (${rubrics.length} rubric${rubrics.length > 1 ? "s" : ""}): ${rubrics.map(esc).join("; ")}</div>` : ""}
    ${r.matched.length ? `<div class="why">${rubrics.length ? "Materia medica confirmation" : "Matched"}: ${r.matched.slice(0, 3).map(esc).join("; ")} (${r.percent}% confidence)</div>` : ""}
    <div class="mm-note"><b>About ${esc(rem.name)}:</b> ${esc(materiaMedicaNote(rem))}</div>
    <div class="potency-row">
      ${isPrimary && rem.potency.acute !== "-" ? `<span class="pot pot-primary">Suggested potency (acute): <b>${esc(rem.potency.acute)}</b></span>` : rem.potency.acute !== "-" ? `<span class="pot">Acute: <b>${esc(rem.potency.acute)}</b></span>` : ""}
      ${rem.potency.chronic !== "-" ? `<span class="pot">Chronic: <b>${esc(rem.potency.chronic)}</b></span>` : ""}
    </div>
  </div>`;
}


resultBtn.addEventListener("click", runSearch);
inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) runSearch(); });

document.querySelectorAll(".sample-chip").forEach(chip => {
  chip.addEventListener("click", () => { inputEl.value = chip.dataset.sample; runSearch(); });
});
