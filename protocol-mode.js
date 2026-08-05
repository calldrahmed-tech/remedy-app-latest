/* ============================================================
   PROTOCOL MODE — UI layer only. All scoring/data logic (scoreProtocolMatch,
   generateProtocolCards, buildTierBProtocol, CHIEF_SYMPTOM_TAGS, DB) lives in
   script.js and is reused here as-is. This file never touches the Classical
   engine's own rendering (#results) — Protocol Mode renders into #protocolResults.
   ============================================================ */

const INTENSITY_CYCLE = ["+", "++", "+++", "++++"];
let selectedSymptoms = []; // [{ tag: {id,label,section,rubric}, intensity }]
let protocolDataReady = false;

const pEl = (id) => document.getElementById(id);
const protocolChipsEl = pEl("protocolChips");
const protocolSearchEl = pEl("protocolTagSearch");
const protocolSuggestionsEl = pEl("protocolSuggestions");
const getProtocolBtn = pEl("getProtocolBtn");
const protocolResultsEl = pEl("protocolResults");
const classicalResultsEl = pEl("results");

/* ---------- mode switching ---------- */
function setMode(mode) {
  const isProtocol = mode === "protocol";
  document.querySelectorAll(".mode-tab").forEach(btn => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  pEl("protocolModeInput").style.display = isProtocol ? "" : "none";
  pEl("classicalModeInput").style.display = isProtocol ? "none" : "";
  pEl("protocolSamplesBar").style.display = isProtocol ? "" : "none";
  pEl("classicalSamplesBar").style.display = isProtocol ? "none" : "";
  protocolResultsEl.style.display = isProtocol ? "" : "none";
  classicalResultsEl.style.display = isProtocol ? "none" : "";
}
document.querySelectorAll(".mode-tab").forEach(btn => {
  btn.addEventListener("click", () => setMode(btn.dataset.mode));
});

/* ---------- data readiness ---------- */
let TAG_SEARCH_TEXT = {}; // tag.id -> lowercase "label rubric trigger1 trigger2 ..." haystack
document.addEventListener("smartRemedyDataReady", () => {
  protocolDataReady = true;
  // Build each tag's search haystack from its own trigger phrases too, not just its
  // (often differently-worded) label/rubric text — e.g. the rubric displays as
  // "Wrinkled, old-looking face with emaciation" but a doctor searching "looking old"
  // (reversed word order from "old-looking") would never match a plain substring check
  // against that label. The underlying rubric's triggers array already has the phrase
  // "looking old" verbatim; the tag search just wasn't looking at it.
  // Also index the rubric's SECTION name (Fever, Skin, Mind, Stool, ...) — a doctor typing
  // a broad category word like "fever" expects every fever-related rubric to surface, not
  // just the ones that happen to spell out the literal word "fever" in their own text (e.g.
  // "Chilly patient, generally cold, wants warmth" is filed under Fever but never says the
  // word "fever" anywhere in its label, rubric, or triggers).
  const rubricLookup = {};
  (REPERTORY || []).forEach(r => { rubricLookup[r.section + "||" + r.rubric] = r; });
  TAG_SEARCH_TEXT = {};
  CHIEF_SYMPTOM_TAGS.forEach(t => {
    const r = rubricLookup[t.section + "||" + t.rubric];
    const triggerText = r && r.triggers ? r.triggers.join(" ") : "";
    TAG_SEARCH_TEXT[t.id] = (t.label + " " + t.rubric + " " + t.section + " " + triggerText).toLowerCase();
  });
  updateGetProtocolBtnState();
});
function updateGetProtocolBtnState() {
  getProtocolBtn.disabled = !protocolDataReady || selectedSymptoms.length === 0;
}

/* ---------- tag search / chip management ---------- */
function renderChips() {
  protocolChipsEl.innerHTML = selectedSymptoms.map((sel, i) => `
    <span class="protocol-chip">
      <span class="chip-label">${esc(sel.tag.label)}</span>
      <button type="button" class="chip-intensity" data-idx="${i}" title="Tap to change importance">${esc(sel.intensity)}</button>
      <button type="button" class="chip-remove" data-idx="${i}" title="Remove">✕</button>
    </span>
  `).join("");
  protocolChipsEl.querySelectorAll(".chip-intensity").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.idx);
      const cur = INTENSITY_CYCLE.indexOf(selectedSymptoms[i].intensity);
      selectedSymptoms[i].intensity = INTENSITY_CYCLE[(cur + 1) % INTENSITY_CYCLE.length];
      renderChips();
    });
  });
  protocolChipsEl.querySelectorAll(".chip-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedSymptoms.splice(Number(btn.dataset.idx), 1);
      renderChips();
      updateGetProtocolBtnState();
    });
  });
}

function addSymptom(tag) {
  if (selectedSymptoms.some(s => s.tag.id === tag.id)) return;
  selectedSymptoms.push({ tag, intensity: "++" });
  renderChips();
  updateGetProtocolBtnState();
  protocolSearchEl.value = "";
  protocolSuggestionsEl.style.display = "none";
  protocolSearchEl.focus();
}

function renderSuggestions(query) {
  if (!protocolDataReady || !query.trim()) { protocolSuggestionsEl.style.display = "none"; return; }
  const q = query.trim().toLowerCase();
  const selectedIds = new Set(selectedSymptoms.map(s => s.tag.id));
  // Match every word of the query (in any order) against each tag's full haystack —
  // label + rubric + all of that rubric's own trigger phrases. Plain single-substring
  // matching on just the label missed real matches two different ways: (1) a keyword like
  // "stammering" can sit past the label's 52-char truncation point, and (2) word order in
  // the query often does not match the label's word order (a doctor searching "looking old"
  // won't match a label written as "old-looking face" even though they mean the same thing).
  const qWords = q.split(/\s+/).filter(Boolean);
  const allHits = CHIEF_SYMPTOM_TAGS.filter(t => {
    const hay = TAG_SEARCH_TEXT[t.id] || t.label.toLowerCase();
    return qWords.every(w => hay.includes(w));
  });
  const matches = allHits.filter(t => !selectedIds.has(t.id)).slice(0, 8);
  if (!matches.length) {
    // Distinguish "you already added the only match" (not an error) from "this symptom
    // is not in the repertory yet" (a real coverage gap) — showing the same generic
    // message for both made an already-selected symptom look like a broken search.
    const msg = allHits.length ? "Already added" : "No matching symptom — try a different word";
    protocolSuggestionsEl.innerHTML = `<div class="protocol-suggestion-empty">${msg}</div>`;
    protocolSuggestionsEl.style.display = "block";
    return;
  }
  protocolSuggestionsEl.innerHTML = matches.map(t => `<button type="button" class="protocol-suggestion-item" data-id="${esc(t.id)}">${esc(t.label)}</button>`).join("");
  protocolSuggestionsEl.querySelectorAll(".protocol-suggestion-item").forEach(btn => {
    btn.addEventListener("click", () => {
      const tag = CHIEF_SYMPTOM_TAGS.find(t => t.id === btn.dataset.id);
      if (tag) addSymptom(tag);
    });
  });
  protocolSuggestionsEl.style.display = "block";
}
protocolSearchEl.addEventListener("input", () => renderSuggestions(protocolSearchEl.value));
protocolSearchEl.addEventListener("focus", () => renderSuggestions(protocolSearchEl.value));
document.addEventListener("click", (e) => {
  if (!e.target.closest(".protocol-search-row") && !e.target.closest("#protocolSuggestions")) {
    protocolSuggestionsEl.style.display = "none";
  }
});

/* ---------- sample button (the worked example from the product spec) ---------- */
pEl("protocolSampleFever").addEventListener("click", () => {
  if (!protocolDataReady) return;
  const wanted = [
    ["sym_chill_predominant_chill_with_fever_restlessness_du", "++++"],
    ["sym_restless_anxiety_must_get_up_and_walk_worse_after_", "+++"],
    ["sym_thirst_for_small_sips_frequently", "++"]
  ];
  selectedSymptoms = wanted
    .map(([id, intensity]) => {
      const tag = CHIEF_SYMPTOM_TAGS.find(t => t.id === id);
      return tag ? { tag, intensity } : null;
    })
    .filter(Boolean);
  renderChips();
  updateGetProtocolBtnState();
  runProtocolSearch();
});

/* ---------- protocol card rendering ---------- */
function doseLine(dose) {
  const remedy = DB.remedies.find(r => r.id === dose.remedy);
  const name = remedy ? remedy.name : (dose.remedyNameRaw || dose.remedy);
  const timingText = dose.timing && dose.timing !== "as needed" ? ` (${esc(dose.timing)})` : "";
  return `<div class="rc-dose-line"><b>${esc(name)}</b> ${esc(dose.potency)}${timingText} — ${esc(dose.schedule)}</div>`;
}

function protocolFieldRow(label, value) {
  if (!value) return "";
  return `<div class="rc-field"><span class="rc-field-label">${esc(label)}:</span> ${esc(value)}</div>`;
}

function relatedProtocolNote(card) {
  if (!card.relatedDiseaseProtocols || !card.relatedDiseaseProtocols.length) return "";
  return card.relatedDiseaseProtocols.map(rp => `
    <details class="rc-related">
      <summary>📋 FYI — ${esc(card.remedy.name)} is also separately used for <b>${esc(rp.name)}</b> (not related to this case, shown for reference only)</summary>
      <div class="rc-related-body">
        ${rp.protocols.map(proto => `
          ${proto.doses.map(doseLine).join("")}
          ${proto.note ? `<div class="rc-field">${esc(proto.note)}</div>` : ""}
        `).join("<hr class=\"rc-related-divider\">")}
      </div>
    </details>
  `).join("");
}

function renderProtocolCard(card, colorClass, headerLabel) {
  const p = card.protocol;
  return `
    <div class="remedy-card ${colorClass}">
      <div class="rc-head">
        <div class="rc-eyebrow">${esc(headerLabel)}</div>
        <div class="rc-name">${esc(card.remedy.name)}</div>
        ${typeof card.percent === "number" ? `<div class="rc-potency">${card.percent}% match</div>` : ""}
      </div>
      <div class="rc-body">
        ${p.doses.map(doseLine).join("")}
        ${p.biochemicSupport ? `<div class="rc-dose-line">+ Biochemic support: ${esc(p.biochemicSupport.text)}</div>` : ""}
        ${protocolFieldRow("Duration", p.duration)}
        ${protocolFieldRow("Review", p.review)}
        ${protocolFieldRow("Expected response", p.expectedResponse)}
        ${protocolFieldRow("Tip", p.tip)}
        ${p.note ? `<div class="rc-field">${esc(p.note)}</div>` : ""}
        ${relatedProtocolNote(card)}
      </div>
    </div>`;
}

function renderCombinationCard(card) {
  const p = card.protocol;
  return `
    <div class="remedy-card gold">
      <div class="rc-head">
        <div class="rc-eyebrow">Protocol 3 · Banerji-style combination</div>
        <div class="rc-name">${esc(card.diseaseContext)}</div>
      </div>
      <div class="rc-body">
        ${p.doses.map(doseLine).join("")}
        ${p.biochemicSupport ? `<div class="rc-dose-line">+ Biochemic support: ${esc(p.biochemicSupport.text)}</div>` : ""}
        ${p.note ? `<div class="rc-field">${esc(p.note)}</div>` : ""}
        <div class="rc-field rc-related-disclosure">Sourced from the curated protocol on file for ${esc(card.diseaseContext)} — confirm it fits before using, this combination was authored for that named condition, not derived from the symptoms entered above.</div>
      </div>
    </div>`;
}

/* ---------- Nosode / Supportive Care (reuses the same helpers Classical mode uses) ---------- */
function renderNosodeSection(ranked) {
  const nosodeRemedy = protocolNosodeSuggestion(ranked) || DB.remedies.find(r => r.id === "psor");
  if (!nosodeRemedy) return "";
  return `<div class="collapsible-section neutral">
    <button class="collapsible-toggle" onclick="toggleSection('protocol-nosode-section')">
      <span>🧬 Nosode Support (For Chronic Cases)</span>
      <span class="ct-link"><span id="protocol-nosode-section-arrow">▶</span> View nosode option</span>
    </button>
    <div id="protocol-nosode-section" class="collapsible-content" style="display:none;">
      <div class="alt-remedy-name display">${esc(nosodeRemedy.name)} ${esc(nosodeRemedy.potency && nosodeRemedy.potency.chronic !== "-" ? nosodeRemedy.potency.chronic.split(",")[0] : "1M")}</div>
      <ul class="alt-reasons">
        <li>Often used once-weekly or once-monthly alongside the main remedy in deep-seated or recurring cases</li>
        <li>Best selected and dosed under full case-taking, not as a standalone acute remedy</li>
      </ul>
    </div>
  </div>`;
}

function renderSupportiveCare(topRemedy) {
  const biochemicPair = fallbackBiochemicFor(topRemedy).slice(0, 2);
  const advice = fallbackAdvice(topRemedy);
  return `<div class="support-section-small">
    <div class="support-title">Supportive Care</div>
    <div class="support-line"><b>Biochemic:</b> ${biochemicPair.map(b => esc(b.abbr)).join(", ")}</div>
    <div class="support-line"><b>Diet:</b> Avoid ${esc((advice.diet.avoid || [])[0] || "trigger foods")}</div>
    <div class="support-line"><b>Tests:</b> ${esc((advice.tests || [])[0] || "Clinical evaluation")}</div>
  </div>`;
}

/* ---------- main entry point ---------- */
function runProtocolSearch() {
  if (!protocolDataReady) { protocolResultsEl.innerHTML = `<div class="msg">Database still loading — try again in a moment.</div>`; return; }
  if (!selectedSymptoms.length) { protocolResultsEl.innerHTML = `<div class="msg">Add at least one chief symptom to get a protocol.</div>`; return; }

  const ranked = scoreProtocolMatch(selectedSymptoms);
  const cards = generateProtocolCards(selectedSymptoms);

  if (!cards.length) {
    protocolResultsEl.innerHTML = `<div class="msg">No confident protocol match for this combination — try adding a more specific chief symptom, or switch to Classical mode for full-text case-taking.</div>`;
    return;
  }

  let html = "";
  cards.forEach(card => {
    if (card.tier === "primary") html += renderProtocolCard(card, "green", "Protocol 1 · Primary");
    else if (card.tier === "alternative") html += renderProtocolCard(card, "blue", "Protocol 2 · Alternative");
    else if (card.tier === "combination") html += renderCombinationCard(card);
  });

  html += renderNosodeSection(ranked);
  html += renderSupportiveCare(ranked[0].remedy);
  html += `<div class="caution">⚠ Protocol Mode gives a fast, symptom-merit-based suggestion from chief complaints only — it is not a substitute for full case-taking. Switch to Classical mode for a complete repertorized analysis.</div>`;

  protocolResultsEl.innerHTML = html;
}
getProtocolBtn.addEventListener("click", runProtocolSearch);
