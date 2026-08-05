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
  ],
  // Chilly/restless fever picture — the classic Arsenicum-type triad of chill, restlessness,
  // and small-sip thirst tends to be described together.
  "sym_chill_predominant_chill_with_fever_restlessness_du": [
    "sym_restless_anxiety_must_get_up_and_walk_worse_after_",
    "sym_thirst_for_small_sips_frequently",
    "sym_anxiety_with_restlessness_fear_of_death"
  ],
  // Dry night cough often rides with the same fever/thirst pattern, or leaves the voice hoarse.
  "sym_dry_spasmodic_cough_worse_at_night": [
    "sym_fever_with_thirst",
    "sym_hoarseness_worse_in_the_evening"
  ],
  "sym_loose_rattling_cough_with_difficulty_expectorating": [
    "sym_loud_rattling_mucus_in_the_chest_with_little_expec",
    "sym_chilly_patient_generally_cold_wants_warmth"
  ],
  "sym_spasmodic_dry_barking_cough_worse_after_midnight": [
    "sym_hoarseness_worse_in_the_evening",
    "sym_fever_with_thirst"
  ],
  "sym_croupy_dry_barking_cough_worse_before_midnight": [
    "sym_chill_predominant_chill_with_fever_restlessness_du",
    "sym_hoarseness_worse_in_the_evening"
  ],
  // Profuse watery diarrhea commonly comes with marked thirst and, in severe cases, collapse —
  // the classic acute-gastroenteritis triad.
  "sym_diarrhoea_watery_profuse": [
    "sym_extreme_thirst_large_quantities_at_a_time",
    "sym_faintness_or_collapse_with_cold_clammy_sweat_worse",
    "sym_acute_gastroenteritis_fever_chills_vomiting_diarrh"
  ],
  "sym_sudden_forceful_diarrhea_immediately_after_eating_": [
    "sym_nausea_and_vomiting_with_clean_tongue",
    "sym_vomiting_of_food_immediately_after_eating_or_drink"
  ],
  // Bryonia's classic constipation picture: hard dry stool with marked thirst for large
  // quantities, worse from any motion.
  "sym_constipation_hard_dry_stool": [
    "sym_extreme_thirst_large_quantities_at_a_time",
    "sym_worse_on_first_beginning_to_move_better_with_conti"
  ],
  // Sudden, violent-onset headache with a flushed face often tracks with the same abrupt,
  // high-fever picture.
  "sym_throbbing_headache_with_red_face_relieved_suddenly": [
    "sym_sudden_high_fever_violent_onset_no_chill_stage"
  ],
  "sym_headache_worse_4_8pm_irritable_and_angry_sour_belc": [
    "sym_irritability_easily_angered_impatient",
    "sym_worse_from_eating"
  ],
  "sym_migraine_with_visual_aura_zigzag_lines_blur_before": [
    "sym_nausea_and_vomiting_with_clean_tongue"
  ],
  "sym_nausea_and_vomiting_with_clean_tongue": [
    "sym_motion_sickness_nausea_vomiting_from_travel_better",
    "sym_thirst_for_cold_water_drinks"
  ],
  "sym_vomiting_of_food_immediately_after_eating_or_drink": [
    "sym_extreme_exhaustion_sleepy_all_day_yet_cannot_sleep"
  ],
  // The classic Arsenicum anxiety-restlessness-chill triad, and its overlap with sleeplessness
  // from an overactive/worried mind.
  "sym_anxiety_with_restlessness_fear_of_death": [
    "sym_chill_predominant_chill_with_fever_restlessness_du",
    "sym_restless_anxiety_must_get_up_and_walk_worse_after_",
    "sym_thirst_for_small_sips_frequently"
  ],
  "sym_restless_anxiety_must_get_up_and_walk_worse_after_": [
    "sym_anxiety_with_restlessness_fear_of_death",
    "sym_sleeplessness_from_an_overactive_mind_cannot_stop_"
  ],
  "sym_itching_worse_from_warmth_or_scratching": [
    "sym_itching_worse_from_the_warmth_of_the_bed",
    "sym_unhealthy_skin_every_small_injury_tends_to_suppura"
  ],
  "sym_acne_with_pus_slow_to_heal_scarring_tendency": [
    "sym_unhealthy_skin_every_small_injury_tends_to_suppura",
    "sym_chronic_recurrent_boils_or_skin_eruptions_craves_s"
  ],
  // Hepar's classic splinter-in-tonsil throat pain is intensely chilly and prone to suppuration
  // — both very commonly reported alongside it.
  "sym_sharp_splinter_or_needle_sensation_in_tonsil_radia": [
    "sym_chilly_patient_generally_cold_wants_warmth",
    "sym_every_minor_wound_or_cut_suppurates_festers_or_hea"
  ],
  "sym_ear_pain_worse_swallowing_or_cold_drafts_weepy_and": [
    "sym_fever_with_thirst"
  ],
  "sym_menses_too_late_scanty_or_suppressed": [
    "sym_bearing_down_sensation_in_pelvis_as_if_organs_will"
  ],
  "sym_menses_too_early_and_profuse": [
    "sym_bearing_down_sensation_in_the_pelvis_as_if_everyth"
  ],
  // Classic Iodum-type hyperthyroid picture: rapid weight loss with restlessness/anxiety and
  // marked weakness/trembling.
  "sym_rapid_weight_loss_despite_increased_appetite_heat_": [
    "sym_restless_anxiety_must_get_up_and_walk_worse_after_",
    "sym_great_weakness_and_trembling_from_the_slightest_ex"
  ],
  "sym_sleeplessness_from_an_overactive_mind_cannot_stop_": [
    "sym_restless_anxiety_must_get_up_and_walk_worse_after_"
  ],
  "sym_ailments_from_grief_sorrow_or_bereavement": [
    "sym_silent_grief_dwells_on_past_hurts_cannot_cry",
    "sym_weeps_easily_wants_sympathy_and_consolation"
  ],
  "sym_vertigo_worse_from_looking_up_better_from_pressure": [
    "sym_nausea_and_vomiting_with_clean_tongue"
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

// biochemicSupport is 0-2 curated {id, name, dose, justification} entries — never padded to a
// fixed count, and rendered with its one-sentence justification so it reads as a deliberate
// clinical choice rather than a generic filler line. An empty/missing array (no tissue salt
// with a strong classical indication for this condition) renders nothing at all.
function renderBiochemicBlock(biochemicSupport) {
  if (!biochemicSupport || !biochemicSupport.length) return "";
  return biochemicSupport.map(b => `
    <div class="rc-biochemic">
      <div class="rc-dose-line">+ Biochemic: <b>${esc(b.name)}</b> ${esc(b.dose)}</div>
      <div class="rc-biochemic-why">${esc(b.justification)}</div>
    </div>
  `).join("");
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
        ${renderBiochemicBlock(p.biochemicSupport)}
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
        <div class="rc-eyebrow">Expert Protocol 3 · Combination Regimen</div>
        <div class="rc-name">${esc(card.diseaseContext)}</div>
      </div>
      <div class="rc-body">
        ${p.doses.map(doseLine).join("")}
        ${renderBiochemicBlock(p.biochemicSupport)}
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
        ${renderBiochemicBlock(p.biochemicSupport)}
        ${protocolFieldRow("Duration", p.duration)}
        ${protocolFieldRow("Review", p.review)}
        ${protocolFieldRow("Expected response", p.expectedResponse)}
        ${protocolFieldRow("Tip", p.tip)}
        ${p.note ? `<div class="rc-field">${esc(p.note)}</div>` : ""}
      </div>
    </div>`;
}

// MATERIA-MEDICA FALLBACK — Expert Protocol's rubric-grade scoring (scoreProtocolMatch) can come
// back thin when a doctor has only picked one or two generic tags: the rubric arithmetic has
// no confirmatory signal to fall back on the way Classical mode's scoreRemedies() does (its
// REP_WEIGHT + MM_WEIGHT_CONFIRM/PRIMARY blend). Rather than duplicate that whole two-signal
// engine a second time here, this reuses it as-is: it turns the doctor's selected tags into a
// short synthetic case description ("<label>. <rubric>. <label>. <rubric>...", each symptom its
// own clause so they can't spuriously bridge into one another) and runs it through the exact
// same scoreRemedies() Classical mode calls. This is ONLY shown when the pure rubric-grade path
// was empty or low-confidence, and always clearly labelled as a broader, less-verified read —
// it supplements Expert Protocol's normal output, never replaces it.
function buildMateriaMedicaFallbackCard(selections) {
  if (!selections.length) return null;
  const searchText = selections.map(s => s.tag.label + ". " + s.tag.rubric).join(". ");
  const ranked = scoreRemedies(searchText, null);
  if (!ranked.length) return null;
  const top = ranked[0];
  return { remedy: top.remedy, percent: top.percent, protocol: buildTierBProtocol(top.remedy) };
}

function renderMmFallbackCard(card) {
  const p = card.protocol;
  return `
    <div class="remedy-card blue">
      <div class="rc-head">
        <div class="rc-eyebrow">Broader match · materia medica read</div>
        <div class="rc-name">${esc(card.remedy.name)}</div>
        ${typeof card.percent === "number" ? `<div class="rc-potency">${card.percent}% match</div>` : ""}
      </div>
      <div class="rc-body">
        ${p.doses.map(doseLine).join("")}
        ${renderBiochemicBlock(p.biochemicSupport)}
        ${protocolFieldRow("Duration", p.duration)}
        ${protocolFieldRow("Review", p.review)}
        <div class="rc-field rc-related-disclosure">Rubric matching was thin for the symptoms selected, so this reads them against remedy keynote text more broadly instead — treat it as a secondary lead worth considering, not a confirmed pick the way the rubric-based results above are.</div>
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

// biochemicSalts: the curated {id, name, dose, justification} array from the selected disease
// (when one was picked), or null. There is no generic organ-system fallback guess anymore — a
// pure granular-symptom result (no named condition selected) has no genuinely disease-specific
// biochemic signal available in Protocol Mode's architecture, so per spec that line is omitted
// entirely here rather than padded with an unjustified system-category pick.
// tests: the curated {name, reason} array from the selected disease's own clinically-indicated
// investigations, or null. Same principle as biochemicSalts above — a pure granular-symptom
// result has no disease-specific "what to investigate" signal, so the Suggested Tests line is
// omitted entirely rather than defaulting to a routine "Clinical evaluation" placeholder.
function renderSupportiveCare(topRemedy, biochemicSalts, tests) {
  const advice = fallbackAdvice(topRemedy);
  const biochemicLine = biochemicSalts && biochemicSalts.length
    ? `<div class="support-line"><b>Biochemic:</b> ${biochemicSalts.map(b => esc(b.name) + " (" + esc(b.dose) + ")").join(", ")}</div>`
    : "";
  const testsLine = tests && tests.length
    ? `<div class="support-line"><b>Suggested Tests:</b> ${tests.map(t => `${esc(t.name)} — ${esc(t.reason)}`).join("; ")}</div>`
    : "";
  return `<div class="support-section-small">
    <div class="support-title">Supportive Care</div>
    ${biochemicLine}
    <div class="support-line"><b>Diet:</b> Avoid ${esc((advice.diet.avoid || [])[0] || "trigger foods")}</div>
    ${testsLine}
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
  let supportiveBiochemicSalts = null; // only ever populated from a selected disease's own
                                        // curated biochemicSalts — never a generic guess
  let supportiveTests = null; // only ever populated from a selected disease's own curated
                               // tests — never a generic "Clinical evaluation" placeholder

  // Disease shortcuts render their own authored protocols[] directly — no symptom scoring
  // involved, since the doctor explicitly named the condition rather than describing symptoms.
  // Selecting two-plus UNRELATED named conditions together (e.g. Alopecia + Migraine +
  // Constipation) does NOT get synthesized into one combined remedy — each is its own fixed,
  // independently-authored lookup, since "blend two unrelated diseases into one remedy" isn't
  // a real clinical operation. Flag that plainly rather than let the doctor assume the separate
  // cards below represent one unified read of a single patient.
  if (selectedDiseaseShortcuts.length > 1) {
    html += `<div class="msg protocol-shortcut-note">⚠️ Each condition below has its own separate protocol — they are not blended into one remedy. Want a single combined remedy instead? Remove these condition names and add the patient's individual symptoms with + marks.</div>`;
  }
  selectedDiseaseShortcuts.forEach(d => {
    const disease = (DB.diseaseProtocols || []).find(p => p.id === d.diseaseId);
    if (!disease || !disease.protocols || !disease.protocols.length) return;
    if (!supportiveRemedy && disease.primaryRemedies && disease.primaryRemedies.length) {
      supportiveRemedy = DB.remedies.find(r => r.id === disease.primaryRemedies[0]) || null;
      if (disease.biochemicSalts && disease.biochemicSalts.length) {
        supportiveBiochemicSalts = disease.biochemicSalts.map(s => {
          const b = DB.biochemics.find(bc => bc.id === s.id);
          return { name: b ? b.abbr : s.id, dose: s.dose, justification: s.justification };
        });
      }
      if (disease.tests && disease.tests.length) supportiveTests = disease.tests;
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
        if (card.tier === "primary") html += renderProtocolCard(card, "green", "Expert Protocol 1 · Primary");
        else if (card.tier === "alternative") html += renderProtocolCard(card, "blue", "Expert Protocol 2 · Alternative");
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
    // Rubric-grade matching came back empty or thin (top pick under 40%) — rather than leave
    // the doctor with nothing (or a low-confidence pick with no second opinion), read the
    // selected symptoms against remedy keynote text more broadly, the same way Classical mode
    // does. Always additional, always clearly labelled as the less-verified read — never
    // replaces or gets ranked above the rubric-based cards above.
    if (!cards.length || ranked[0].percent < 40) {
      const mmCard = buildMateriaMedicaFallbackCard(selectedSymptoms);
      if (mmCard && (!cards.length || mmCard.remedy.id !== ranked[0].remedy.id)) {
        html += renderMmFallbackCard(mmCard);
        if (!supportiveRemedy) supportiveRemedy = mmCard.remedy;
      }
    }
  }

  if (!html) {
    protocolResultsEl.innerHTML = `<div class="msg">No confident protocol match for this combination — try adding a more specific chief symptom, or switch to Full Repertory mode for full-text case-taking.</div>`;
    return;
  }

  if (supportiveRemedy) html += renderSupportiveCare(supportiveRemedy, supportiveBiochemicSalts, supportiveTests);
  html += `<div class="caution">⚠ Expert Protocol gives a fast, symptom-merit-based suggestion from chief complaints only — it is not a substitute for full case-taking. Switch to Full Repertory mode for a complete repertorized analysis.</div>`;

  protocolResultsEl.innerHTML = html;
}
getProtocolBtn.addEventListener("click", runProtocolSearch);
