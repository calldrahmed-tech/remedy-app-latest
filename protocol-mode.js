/* ============================================================
   PROTOCOL MODE — UI layer only. All scoring/data logic (scoreProtocolMatch,
   generateProtocolCards, buildTierBProtocol, CHIEF_SYMPTOM_TAGS, DB) lives in
   script.js and is reused here as-is. This file never touches the Classical
   engine's own rendering (#results) — Protocol Mode renders into #protocolResults.
   ============================================================ */

const INTENSITY_CYCLE = ["+", "++", "+++", "++++"];
let selectedSymptoms = []; // [{ tag: {id,label,section,rubric}, intensity }]
let selectedDiseaseShortcuts = []; // [{id, label, diseaseId}] — direct picks of a named
                                    // curated condition (e.g. "Abscess (acute, painful)"),
                                    // kept separate from selectedSymptoms since they have no
                                    // intensity and are scored completely differently: their
                                    // own authored protocols[] are shown directly rather than
                                    // going through scoreProtocolMatch's tag-grade arithmetic.
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
  getProtocolBtn.disabled = !protocolDataReady || (selectedSymptoms.length === 0 && selectedDiseaseShortcuts.length === 0);
}

/* ---------- related-symptom suggestions ----------
   Curated, hand-picked clinical associations — NOT auto-derived from text similarity and
   NOT new repertory rubrics (adding remedies to REPERTORY risks the kind of invisible
   Classical-mode scoring shift discovered with the "Fever, general/unspecified" rubric,
   since idfFactor() discounts a remedy globally based on how many rubrics list it, whether
   or not those rubrics ever fire). This map only points to symptom TAGS THAT ALREADY EXIST,
   so it changes zero scoring behavior anywhere — it just saves a doctor from having to think
   of and re-search for the obvious companion symptoms one at a time. Deliberately small and
   meant to grow the same incremental way the repertory itself has: only add a link here when
   the clinical association is well-established, not just plausible. */
const RELATED_SYMPTOM_MAP = {
  // Boils/abscesses are acute local infections — fever (usually with its own chill/thirst
  // pattern) is one of the most common systemic symptoms riding along with them.
  "sym_boils_or_abscesses_acutely_very_sensitive_to_touch": [
    "sym_sudden_high_fever_violent_onset_no_chill_stage",
    "sym_chill_predominant_chill_with_fever_restlessness_du",
    "sym_fever_with_thirst"
  ]
};

function renderRelatedSuggestions() {
  const relatedTagsEl = pEl("protocolRelatedSuggestions");
  const selectedIds = new Set(selectedSymptoms.map(s => s.tag.id));
  const relatedIds = [];
  selectedSymptoms.forEach(s => {
    (RELATED_SYMPTOM_MAP[s.tag.id] || []).forEach(id => {
      if (!selectedIds.has(id) && !relatedIds.includes(id)) relatedIds.push(id);
    });
  });
  if (!relatedIds.length) { relatedTagsEl.style.display = "none"; relatedTagsEl.innerHTML = ""; return; }
  const tags = relatedIds.map(id => CHIEF_SYMPTOM_TAGS.find(t => t.id === id)).filter(Boolean);
  relatedTagsEl.innerHTML = `<span class="related-suggestions-label">Often seen together — tap to add:</span>` +
    tags.map(t => `<button type="button" class="related-suggestion-item" data-id="${esc(t.id)}">+ ${esc(t.label)}</button>`).join("");
  relatedTagsEl.querySelectorAll(".related-suggestion-item").forEach(btn => {
    btn.addEventListener("click", () => {
      const tag = CHIEF_SYMPTOM_TAGS.find(t => t.id === btn.dataset.id);
      if (tag) addSymptom(tag);
    });
  });
  relatedTagsEl.style.display = "block";
}

/* ---------- tag search / chip management ---------- */
function renderChips() {
  const symptomChips = selectedSymptoms.map((sel, i) => `
    <span class="protocol-chip">
      <span class="chip-label">${esc(sel.tag.label)}</span>
      <button type="button" class="chip-intensity" data-idx="${i}" title="Tap to change importance">${esc(sel.intensity)}</button>
      <button type="button" class="chip-remove" data-idx="${i}" title="Remove">✕</button>
    </span>
  `).join("");
  // Disease-shortcut chips look distinct (gold border, 🏷 icon, no intensity control — a
  // named condition isn't "how strong," it's just selected or not) so a doctor can tell at a
  // glance which chips are individual symptoms versus a direct jump to a curated condition.
  const diseaseChips = selectedDiseaseShortcuts.map((d, i) => `
    <span class="protocol-chip disease-shortcut-chip">
      <span class="chip-label">🏷️ ${esc(d.label)}</span>
      <button type="button" class="disease-chip-remove" data-idx="${i}" title="Remove">✕</button>
    </span>
  `).join("");
  protocolChipsEl.innerHTML = diseaseChips + symptomChips;
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
  protocolChipsEl.querySelectorAll(".disease-chip-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedDiseaseShortcuts.splice(Number(btn.dataset.idx), 1);
      renderChips();
      updateGetProtocolBtnState();
    });
  });
  renderRelatedSuggestions();
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

function addDiseaseShortcut(tag) {
  if (selectedDiseaseShortcuts.some(d => d.id === tag.id)) return;
  selectedDiseaseShortcuts.push(tag);
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
  const selectedDiseaseIds = new Set(selectedDiseaseShortcuts.map(d => d.id));
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
  // Disease shortcuts (the 117 curated named conditions) are searched separately and shown
  // ABOVE the granular symptom matches — a doctor typing "abscess" almost certainly wants the
  // one-tap curated Abscess protocol, not to be buried under individual symptom rubrics.
  const diseaseHits = (DISEASE_SHORTCUT_TAGS || []).filter(d => qWords.every(w => d.searchText.includes(w)));
  const matches = allHits.filter(t => !selectedIds.has(t.id)).slice(0, 8);
  const diseaseMatches = diseaseHits.filter(d => !selectedDiseaseIds.has(d.id)).slice(0, 5);
  if (!matches.length && !diseaseMatches.length) {
    // Distinguish "you already added the only match" (not an error) from "this symptom
    // is not in the repertory yet" (a real coverage gap) — showing the same generic
    // message for both made an already-selected symptom look like a broken search.
    const msg = (allHits.length || diseaseHits.length) ? "Already added" : "No matching symptom — try a different word";
    protocolSuggestionsEl.innerHTML = `<div class="protocol-suggestion-empty">${msg}</div>`;
    protocolSuggestionsEl.style.display = "block";
    return;
  }
  protocolSuggestionsEl.innerHTML =
    diseaseMatches.map(d => `<button type="button" class="protocol-suggestion-item disease-suggestion-item" data-disease-id="${esc(d.id)}">🏷️ ${esc(d.label)} <span class="suggestion-tag-hint">curated protocol</span></button>`).join("") +
    matches.map(t => `<button type="button" class="protocol-suggestion-item" data-id="${esc(t.id)}">${esc(t.label)}</button>`).join("");
  protocolSuggestionsEl.querySelectorAll(".disease-suggestion-item").forEach(btn => {
    btn.addEventListener("click", () => {
      const tag = DISEASE_SHORTCUT_TAGS.find(d => d.id === btn.dataset.diseaseId);
      if (tag) addDiseaseShortcut(tag);
    });
  });
  protocolSuggestionsEl.querySelectorAll(".protocol-suggestion-item:not(.disease-suggestion-item)").forEach(btn => {
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

// STOP words filtered out of a disease name before checking overlap — generic qualifiers
// like "General" or "Adjunct" would otherwise "match" almost any case and defeat the point.
const DISEASE_NAME_STOPWORDS = new Set(["general", "unspecified", "adjunct", "acute", "chronic", "with", "from", "type", "disorder", "syndrome"]);
function diseaseRelatesToSelection(diseaseName) {
  // A disease name like "Alopecia (hair loss)" carries its real informative words inside
  // the parenthetical — strip the parens (not the words in them) before splitting, so both
  // "Alopecia" and "hair"/"loss" get checked against what the doctor actually selected.
  const selText = selectedSymptoms.map(s => s.tag.label + " " + s.tag.rubric).join(" ").toLowerCase();
  const words = diseaseName.toLowerCase().replace(/[()]/g, " ").split(/[\s,/-]+/).filter(w => w.length > 3 && !DISEASE_NAME_STOPWORDS.has(w));
  return words.some(w => selText.includes(w));
}

function relatedProtocolNote(card) {
  if (!card.relatedDiseaseProtocols || !card.relatedDiseaseProtocols.length) return "";
  // Only surface this note when the disease actually shares real wording with what's
  // currently selected (e.g. the case IS "hair loss" and the disease is "Alopecia (hair
  // loss)"). A disclaimed "also used for Pneumonia — not related to this case" note is still
  // noise even collapsed — a doctor scanning past it gets nothing from being told to ignore
  // it, so an unrelated disease is dropped entirely rather than shown with an apology.
  return card.relatedDiseaseProtocols
    .filter(rp => diseaseRelatesToSelection(rp.name))
    .map(rp => `
    <details class="rc-related">
      <summary>📋 ${esc(card.remedy.name)} also has a curated protocol on file for <b>${esc(rp.name)}</b> — may be worth reviewing</summary>
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

function renderDiseaseShortcutCard(disease, p, headerLabel) {
  return `
    <div class="remedy-card gold">
      <div class="rc-head">
        <div class="rc-eyebrow">${esc(headerLabel)} · Curated protocol</div>
        <div class="rc-name">${esc(disease.name)}</div>
      </div>
      <div class="rc-body">
        ${p.doses.map(doseLine).join("")}
        ${p.biochemicSupport ? `<div class="rc-dose-line">+ Biochemic support: ${esc(p.biochemicSupport.text)}</div>` : ""}
        ${protocolFieldRow("Duration", p.duration)}
        ${protocolFieldRow("Review", p.review)}
        ${protocolFieldRow("Expected response", p.expectedResponse)}
        ${protocolFieldRow("Tip", p.tip)}
        ${p.note ? `<div class="rc-field">${esc(p.note)}</div>` : ""}
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
  if (!selectedSymptoms.length && !selectedDiseaseShortcuts.length) { protocolResultsEl.innerHTML = `<div class="msg">Add at least one chief symptom or a curated condition to get a protocol.</div>`; return; }

  let html = "";
  let supportiveRemedy = null; // whichever path runs first supplies the remedy used for the
                                // Supportive Care section below, so it always reflects something
                                // actually shown on screen rather than an arbitrary default

  // Disease shortcuts render their own authored protocols[] directly — no symptom scoring
  // involved, since the doctor explicitly named the condition rather than describing symptoms.
  selectedDiseaseShortcuts.forEach(d => {
    const disease = (DB.diseaseProtocols || []).find(p => p.id === d.diseaseId);
    if (!disease || !disease.protocols || !disease.protocols.length) return;
    if (!supportiveRemedy && disease.primaryRemedies && disease.primaryRemedies.length) {
      supportiveRemedy = DB.remedies.find(r => r.id === disease.primaryRemedies[0]) || null;
    }
    disease.protocols.forEach(p => {
      const label = p.tier === "primary" ? "Primary" : p.tier === "secondary" ? "Secondary" : (p.label || "Curated");
      html += renderDiseaseShortcutCard(disease, p, label);
    });
  });

  // Granular chief-symptom scoring runs independently and appends below, clearly separated,
  // if the doctor also picked individual symptoms alongside (or instead of) a disease shortcut.
  if (selectedSymptoms.length) {
    const ranked = scoreProtocolMatch(selectedSymptoms);
    const cards = generateProtocolCards(selectedSymptoms);
    if (cards.length) {
      if (selectedDiseaseShortcuts.length) html += `<div class="protocol-section-divider">Based on the individual symptoms you also selected:</div>`;
      cards.forEach(card => {
        if (card.tier === "primary") html += renderProtocolCard(card, "green", "Protocol 1 · Primary");
        else if (card.tier === "alternative") html += renderProtocolCard(card, "blue", "Protocol 2 · Alternative");
        // Only surface the full Banerji-style combination card — a complete separate dosing
        // protocol, shown with equal visual weight to the actual matches — when the disease it
        // was authored for genuinely overlaps with what the doctor selected. An unrelated
        // disease's full protocol (e.g. "Depression" surfacing on a hair-loss case just because
        // the same remedy happens to treat both) is real noise, not a helpful cross-reference —
        // that lighter-weight case belongs in the collapsed per-remedy FYI note, not a top-level card.
        else if (card.tier === "combination" && diseaseRelatesToSelection(card.diseaseContext)) html += renderCombinationCard(card);
      });
      html += renderNosodeSection(ranked);
      if (!supportiveRemedy) supportiveRemedy = ranked[0].remedy;
    }
  }

  if (!html) {
    protocolResultsEl.innerHTML = `<div class="msg">No confident protocol match for this combination — try adding a more specific chief symptom, or switch to Classical mode for full-text case-taking.</div>`;
    return;
  }

  if (supportiveRemedy) html += renderSupportiveCare(supportiveRemedy);
  html += `<div class="caution">⚠ Protocol Mode gives a fast, symptom-merit-based suggestion from chief complaints only — it is not a substitute for full case-taking. Switch to Classical mode for a complete repertorized analysis.</div>`;

  protocolResultsEl.innerHTML = html;
}
getProtocolBtn.addEventListener("click", runProtocolSearch);
