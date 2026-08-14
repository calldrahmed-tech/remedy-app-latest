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
const comboChipsEl = pEl("comboChips");
const comboSearchEl = pEl("comboTagSearch");
const comboSuggestionsEl = pEl("comboSuggestions");
const getComboBtn = pEl("getComboBtn");
const protocolResultsEl = pEl("protocolResults");
const classicalResultsEl = pEl("results");

/* ---------- mode switching ----------
   Three tabs, each doing exactly one thing: "protocol" picks a named-condition (gold)
   shortcut only, "combo" picks individual symptom chips only, "classical" is free-text
   case-taking. Named-condition picks and symptom picks used to share one search box and
   one results view, which meant a doctor mixing a gold pick with a plain symptom got two
   separate result cards with no way to tell in advance — this split makes that impossible:
   each tab has its own chip list and search box, and switching tabs clears whichever of
   selectedDiseaseShortcuts/selectedSymptoms belongs to the tab being left, so a stale pick
   from one tab can never leak into the other tab's result. */
function setMode(mode) {
  document.querySelectorAll(".mode-tab").forEach(btn => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  pEl("protocolModeInput").style.display = mode === "protocol" ? "" : "none";
  pEl("comboModeInput").style.display = mode === "combo" ? "" : "none";
  pEl("classicalModeInput").style.display = mode === "classical" ? "" : "none";
  pEl("protocolSamplesBar").style.display = mode === "protocol" ? "" : "none";
  pEl("comboSamplesBar").style.display = mode === "combo" ? "" : "none";
  pEl("classicalSamplesBar").style.display = mode === "classical" ? "" : "none";
  protocolResultsEl.style.display = (mode === "protocol" || mode === "combo") ? "" : "none";
  classicalResultsEl.style.display = mode === "classical" ? "" : "none";

  if (mode !== "protocol" && selectedDiseaseShortcuts.length) { selectedDiseaseShortcuts = []; renderDiseaseChips(); }
  if (mode !== "combo" && selectedSymptoms.length) { selectedSymptoms = []; renderSymptomChips(); }
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
  updateGetComboBtnState();
});
function updateGetProtocolBtnState() {
  getProtocolBtn.disabled = !protocolDataReady || selectedDiseaseShortcuts.length === 0;
}
function updateGetComboBtnState() {
  getComboBtn.disabled = !protocolDataReady || selectedSymptoms.length === 0;
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

// QUICK_SYMPTOM_INDEX — a small, hand-picked set of common plain-language chief complaints
// mapped to the SPECIFIC chief-symptom tags that already cover them. This adds no new rubric
// or remedy content — every id here already exists in CHIEF_SYMPTOM_TAGS and was already
// reachable by typing the full sentence. It only changes how the FIRST screen of a common
// search looks: a doctor typing one of these plain words sees one clean collapsed group
// instead of every matching long sentence dumped at once, and opens it to see the specific
// patterns underneath. Deliberately small and meant to grow the same incremental way
// RELATED_SYMPTOM_MAP above has — each entry was checked by hand against its real candidate
// matches (a raw keyword search pulls in false positives, e.g. "gas" also matching "gasping"
// in an unrelated cough rubric, so terms without a clean set of matches were left out rather
// than forced in).
const QUICK_SYMPTOM_INDEX = {
  "fever": ["sym_fever_general_unspecified", "sym_delirium_or_hallucinations_with_high_fever_dilated", "sym_extremely_chilly_cannot_bear_uncovering_oversensit", "sym_fever_recurring_at_the_same_time_daily_craves_cold", "sym_acute_gastroenteritis_fever_chills_vomiting_diarrh"],
  "chilly": ["sym_extremely_chilly_cannot_bear_uncovering_oversensit", "sym_chilly_sluggish_fair_fat_flabby_constitution_crave", "sym_chilly_patient_generally_cold_wants_warmth", "sym_chilly_patient_very_sensitive_to_cold_better_wrapp", "sym_chilly_patient_who_nonetheless_craves_fresh_open_air"],
  "cough": ["sym_dry_spasmodic_cough_worse_at_night", "sym_loose_rattling_cough_with_difficulty_expectorating", "sym_dry_cough_like_a_saw_through_wood_worse_cold_drink", "sym_coughing_fits_in_rapid_succession_hardly_time_to_b", "sym_presses_hands_against_chest_to_support_it_during_c"],
  "headache": ["sym_headache_or_complaints_from_sun_exposure_or_heat_o", "sym_headache_worse_4_8pm_irritable_and_angry_sour_belc", "sym_headache_from_cold_draft_to_head_better_from_wrapp", "sym_headache_from_occiput_settling_over_the_left_eye_b", "sym_periodic_sick_headache_with_visual_disturbance_bef"],
  "vomiting": ["sym_nausea_and_vomiting_with_clean_tongue", "sym_infant_vomits_curdled_milk_in_large_lumps_falls_in", "sym_motion_sickness_nausea_vomiting_from_travel_better", "sym_acute_gastroenteritis_fever_chills_vomiting_diarrh", "sym_vomiting_of_food_immediately_after_eating_or_drink"],
  "nausea": ["sym_nausea_and_vomiting_with_clean_tongue", "sym_motion_sickness_nausea_vomiting_from_travel_better", "sym_aversion_to_food_nausea_at_sight_or_smell_of_food"],
  "diarrhea": ["sym_diarrhea_or_trembling_weakness_from_anticipatory_a", "sym_acute_gastroenteritis_fever_chills_vomiting_diarrh", "sym_anticipatory_diarrhea_before_important_events_desp", "sym_sudden_forceful_diarrhea_immediately_after_eating_", "sym_diarrhea_that_drives_the_patient_out_of_bed_early_"],
  "constipation": ["sym_constipation_general_unspecified", "sym_constipation_hard_dry_stool", "sym_constipation_ineffectual_urging", "sym_constipation_no_urge_inactive_rectum"],
  "weakness": ["sym_heavy_muscular_weakness_like_lead_drooping_eyelids", "sym_extreme_exhaustion_sleepy_all_day_yet_cannot_sleep", "sym_leg_pain_weakness_dragging_sensation"],
  "sleeplessness": ["sym_sleeplessness_from_an_overactive_mind_cannot_stop_", "sym_sleeplessness_from_a_mind_too_active_with_plans_and_ideas_at"],
  "insomnia": ["sym_insomnia_from_worry_overwork_or_mental_strain", "sym_insomnia_specifically_the_first_night_in_an_unfamiliar_bed_o", "sym_insomnia_specifically_from_overexcitement_after_good_news_or"],
  "anxiety": ["sym_anxiety_with_restlessness_fear_of_death", "sym_anticipatory_anxiety_before_an_event", "sym_profound_anxiety_before_events_requiring_coordinat", "sym_anxiety_about_health_with_palpitation_from_the_sli"],
  "itching": ["sym_itching_worse_from_warmth_or_scratching", "sym_vesicular_itching_rash_from_plant_or_chemical_cont", "sym_cannot_bear_warmth_of_bed_throws_off_covers_itchin", "sym_hives_with_intolerable_itching_puffy_edematous_swe", "sym_sudden_hives_urticaria_burning_and_stinging_rather"],
  "swelling": ["sym_hives_with_intolerable_itching_puffy_edematous_swe", "sym_stony_hard_glandular_swellings_no_suppuration_indu", "sym_chronic_glandular_swelling_hard_nodules_slow_to_su", "sym_swelling_of_glands_that_comes_on_rapidly_with_acute_inflamma", "sym_marked_swelling_of_the_whole_body_dropsy_with_intense_thirst"],
  "bleeding": ["sym_bleeding_gums", "sym_bleeding_brought_on_by_overexertion_or_straining_b", "sym_tendency_to_hemorrhage_bleeding_that_is_dark_and_does_not_cl"],
  "vertigo": ["sym_vertigo_worse_from_looking_up_better_from_pressure", "sym_vertigo_worse_from_closing_the_eyes_or_turning_in_", "sym_fear_of_downward_motion_vertigo_on_looking_down_or", "sym_nausea_or_vertigo_brought_on_by_loss_of_sleep_from_watching_"],
  "dizziness": ["sym_vertigo_worse_from_looking_up_better_from_pressure", "sym_vertigo_worse_from_closing_the_eyes_or_turning_in_", "sym_fear_of_downward_motion_vertigo_on_looking_down_or"],
  "sore throat": ["sym_sore_throat_markedly_worse_from_empty_swallowing_better_from", "sym_rapidly_spreading_membranous_sore_throat_with_marked_prostra", "sym_sore_throat_that_is_distinctly_worse_on_the_left_side_with_a", "sym_sore_throat_that_is_distinctly_worse_on_the_right_side_aggra", "sym_common_mild_sore_throat_from_a_cold_without_fever_resolves_i"],
  "joint pain": ["sym_wandering_shifting_joint_pains_that_move_from_join", "sym_wandering_erratic_joint_pains_that_shift_location_every_few_", "sym_pain_in_the_great_toe_joint_worse_from_the_slightest_touch_o", "sym_cracking_of_the_joints_on_motion_audible_but_painless"],
  "back pain": ["sym_common_muscular_back_pain_from_lifting_something_heavy_or_fr", "sym_low_back_pain_that_is_markedly_better_lying_on_something_har", "sym_back_pain_that_is_worse_on_first_rising_from_a_seated_positi", "sym_sudden_sharp_catching_pain_in_the_lower_back_that_takes_the_", "sym_back_pain_that_is_markedly_better_from_firm_pressure_or_lean"],
  "palpitation": ["sym_anxiety_about_health_with_palpitation_from_the_sli", "sym_palpitations_that_come_on_suddenly_with_anxiety_heart_pounds", "sym_palpitations_that_are_worse_specifically_lying_on_the_left_s", "sym_palpitations_noticed_mainly_while_lying_down_at_night_calm_d"],
  "thirst": ["sym_extreme_dryness_of_mucous_membranes_thirstless_con", "sym_thirstless_no_thirst_even_with_fever", "sym_extreme_thirst_large_quantities_at_a_time", "sym_thirst_for_small_sips_frequently", "sym_thirst_for_cold_water_drinks", "sym_thirst_for_warm_drinks"],
  "sweating": ["sym_better_from_sweating_symptoms_return_as_soon_as_sweat_stops", "sym_one_sided_sweating_sweat_only_on_one_half_of_the_body", "sym_profuse_sweating_over_the_whole_body_except_the_head_which_r", "sym_offensive_excessive_sweating_of_the_feet_that_the_patient_is"],
  "bloating": ["sym_abdominal_bloating_that_is_worse_in_the_evening_and_better_i", "sym_bloating_that_develops_immediately_after_eating_even_a_small", "sym_ordinary_gas_and_bloating_after_meals_common_and_recurring_n"],
  "rash": ["sym_vesicular_itching_rash_from_plant_or_chemical_cont", "sym_ordinary_heat_rash_or_prickly_heat_in_hot_humid_weather_comm", "sym_chronic_itching_of_the_skin_worse_specifically_in_the_evenin"],
  "boils": ["sym_boils_or_abscesses_acutely_very_sensitive_to_touch", "sym_chronic_recurrent_boils_or_skin_eruptions_craves_s", "sym_recurrent_boils_or_abscesses_near_a_gland_that_keep_coming_b", "sym_boils_or_abscesses_with_redness_swelling_throbbing_pain_and_", "sym_recurring_styes_boils_or_pimples_that_keep_appearing_in_diff", "sym_carbuncle_a_cluster_of_connected_boils_with_multiple_opening"],
  "ear pain": ["sym_ear_pain_worse_swallowing_or_cold_drafts_weepy_and", "sym_sharp_stabbing_bursting_ear_pain_red_and_hot_worse", "sym_throat_pain_that_extends_to_the_ear_on_swallowing_one_sided"],
  "toothache": ["sym_acute_toothache_with_throbbing_or_sharp_pain_worse_from_cold"],
  "burning urination": ["sym_acute_urinary_tract_infection_with_burning_frequency_fever_a", "sym_burning_in_the_urethra_that_continues_after_urination_has_fi", "sym_common_mild_burning_during_urination_in_a_woman_without_feve", "sym_gonorrhea_acute_urethral_discharge_with_burning_on_urination"],
  "urine burning": ["sym_acute_urinary_tract_infection_with_burning_frequency_fever_a", "sym_burning_in_the_urethra_that_continues_after_urination_has_fi", "sym_common_mild_burning_during_urination_in_a_woman_without_feve"],
  "burning urine": ["sym_acute_urinary_tract_infection_with_burning_frequency_fever_a", "sym_burning_in_the_urethra_that_continues_after_urination_has_fi", "sym_common_mild_burning_during_urination_in_a_woman_without_feve"],
  "irritable": ["sym_headache_worse_4_8pm_irritable_and_angry_sour_belc", "sym_extremely_low_despondent_mood_that_alternates_with_irritable", "sym_aversion_to_consolation_becomes_worse_or_more_irritable_when"],
  "restless": ["sym_restless_sleep_grinding_teeth_talks_or_starts_duri", "sym_anxiety_with_restlessness_fear_of_death", "sym_restless_anxiety_must_get_up_and_walk_worse_after_", "sym_chill_predominant_chill_with_fever_restlessness_du"],
  "discharge": ["sym_chronic_catarrh_with_thin_yellow_or_greenish_disch", "sym_thin_watery_acrid_nasal_discharge_that_excoriates_", "sym_hot_burning_acrid_tears_that_scald_the_cheeks_blan"],
  "weight loss": ["sym_rapid_weight_loss_despite_increased_appetite_heat_", "sym_emaciation_weight_loss_despite_good_appetite", "sym_sudden_and_unexplained_weight_loss_despite_no_change_in_appe"],
  "appetite": ["sym_ravenous_increased_hunger", "sym_decreased_appetite_anorexia", "sym_capricious_appetite_changeable", "sym_must_eat_frequently_hunger_soon_after_eating_faint"],
  "indigestion": ["sym_ordinary_indigestion_with_fullness_and_discomfort_after_a_no", "sym_nervous_indigestion_dyspepsia_brought_on_or_markedly_worse_f"],
  "grief": ["sym_silent_grief_dwells_on_past_hurts_cannot_cry", "sym_recent_grief_with_alternating_laughing_weeping_pul", "sym_ailments_from_grief_sorrow_or_bereavement", "sym_ailments_from_prolonged_unresolved_grief_unable_to"],
  "urine": ["sym_acute_urinary_tract_infection_with_burning_frequency_fever_a", "sym_urine_smells_like_violets_burning_in_kidneys_and_u", "sym_urine_strong_smelling_ammonia_like_odor", "sym_urine_that_deposits_a_thick_brick_dust_red_sediment_on_stand"],
  "skin dry": ["sym_dryness_of_mouth_mucous_membranes_or_skin", "sym_skin_dry_rough_and_cracked_especially_in_cold_weat", "sym_dry_scaly_patches_of_skin_that_worsen_specifically_in_cold_w"]
};

function renderRelatedSuggestions() {
  const relatedTagsEl = pEl("comboRelatedSuggestions");
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
function renderSymptomChips() {
  comboChipsEl.innerHTML = selectedSymptoms.map((sel, i) => `
    <span class="protocol-chip">
      <span class="chip-label">${esc(sel.tag.label)}</span>
      <button type="button" class="chip-intensity" data-idx="${i}" title="Tap to change importance">${esc(sel.intensity)}</button>
      <button type="button" class="chip-remove" data-idx="${i}" title="Remove">✕</button>
    </span>
  `).join("");
  comboChipsEl.querySelectorAll(".chip-intensity").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.idx);
      const cur = INTENSITY_CYCLE.indexOf(selectedSymptoms[i].intensity);
      selectedSymptoms[i].intensity = INTENSITY_CYCLE[(cur + 1) % INTENSITY_CYCLE.length];
      renderSymptomChips();
    });
  });
  comboChipsEl.querySelectorAll(".chip-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedSymptoms.splice(Number(btn.dataset.idx), 1);
      renderSymptomChips();
      updateGetComboBtnState();
    });
  });
  renderRelatedSuggestions();
}

// Disease-shortcut chips look distinct (gold border, 🏷 icon, no intensity control — a named
// condition isn't "how strong," it's just selected or not) and live in their own tab now, so
// there's no individual-symptom chip they could ever be confused with.
function renderDiseaseChips() {
  protocolChipsEl.innerHTML = selectedDiseaseShortcuts.map((d, i) => `
    <span class="protocol-chip disease-shortcut-chip">
      <span class="chip-label">🏷️ ${esc(d.label)}</span>
      <button type="button" class="disease-chip-remove" data-idx="${i}" title="Remove">✕</button>
    </span>
  `).join("");
  protocolChipsEl.querySelectorAll(".disease-chip-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedDiseaseShortcuts.splice(Number(btn.dataset.idx), 1);
      renderDiseaseChips();
      updateGetProtocolBtnState();
    });
  });
}

function addSymptom(tag) {
  if (selectedSymptoms.some(s => s.tag.id === tag.id)) return;
  selectedSymptoms.push({ tag, intensity: "++" });
  renderSymptomChips();
  updateGetComboBtnState();
  comboSearchEl.value = "";
  comboSuggestionsEl.style.display = "none";
  comboSearchEl.focus();
}

function addDiseaseShortcut(tag) {
  if (selectedDiseaseShortcuts.some(d => d.id === tag.id)) return;
  selectedDiseaseShortcuts.push(tag);
  renderDiseaseChips();
  updateGetProtocolBtnState();
  protocolSearchEl.value = "";
  protocolSuggestionsEl.style.display = "none";
  protocolSearchEl.focus();
}

// Match every word of a search TERM (in any order) against each tag's full haystack — label +
// rubric + all of that rubric's own trigger phrases. Plain single-substring matching on just
// the label missed real matches two different ways: (1) a keyword like "stammering" can sit
// past the label's 52-char truncation point, and (2) word order in the query often does not
// match the label's word order (a doctor searching "looking old" won't match a label written
// as "old-looking face" even though they mean the same thing).
function matchesForTerm(term, selectedIds, selectedDiseaseIds) {
  const qWords = term.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!qWords.length) return { matches: [], diseaseMatches: [], anyHits: false };
  const allHits = CHIEF_SYMPTOM_TAGS.filter(t => {
    const hay = TAG_SEARCH_TEXT[t.id] || t.label.toLowerCase();
    return qWords.every(w => hay.includes(w));
  });
  // Disease shortcuts (the 117 curated named conditions) are searched separately and shown
  // ABOVE the granular symptom matches — a doctor typing "abscess" almost certainly wants the
  // one-tap curated Abscess protocol, not to be buried under individual symptom rubrics.
  const diseaseHits = (DISEASE_SHORTCUT_TAGS || []).filter(d => qWords.every(w => d.searchText.includes(w)));
  return {
    matches: allHits.filter(t => !selectedIds.has(t.id)).slice(0, 50),
    diseaseMatches: diseaseHits.filter(d => !selectedDiseaseIds.has(d.id)).slice(0, 15),
    anyHits: allHits.length > 0 || diseaseHits.length > 0
  };
}
// wantDisease/wantSymptoms let each tab's search box show ONLY its own kind of chip —
// the Expert Protocol (named-condition) box only ever offers diseaseMatches, the Combine
// Symptoms box only ever offers matches. This is what makes a wrong tap structurally
// impossible: neither box can ever put the other tab's kind of chip in front of a doctor.
function suggestionButtonsHTML(diseaseMatches, matches, wantDisease, wantSymptoms) {
  return (wantDisease ? diseaseMatches.map(d => `<button type="button" class="protocol-suggestion-item disease-suggestion-item" data-disease-id="${esc(d.id)}">🏷️ ${esc(d.label)} <span class="suggestion-tag-hint">curated protocol</span></button>`).join("") : "") +
    (wantSymptoms ? matches.map(t => `<button type="button" class="protocol-suggestion-item" data-id="${esc(t.id)}">${esc(t.label)}</button>`).join("") : "");
}
function wireSuggestionButtons(container) {
  container.querySelectorAll(".disease-suggestion-item").forEach(btn => {
    btn.addEventListener("click", () => {
      const tag = DISEASE_SHORTCUT_TAGS.find(d => d.id === btn.dataset.diseaseId);
      if (tag) addDiseaseShortcut(tag);
    });
  });
  container.querySelectorAll(".protocol-suggestion-item:not(.disease-suggestion-item)").forEach(btn => {
    btn.addEventListener("click", () => {
      const tag = CHIEF_SYMPTOM_TAGS.find(t => t.id === btn.dataset.id);
      if (tag) addSymptom(tag);
    });
  });
}
// A plain word/phrase that has a hand-curated QUICK_SYMPTOM_INDEX entry gets ONE collapsed
// group instead of its full detailed match list — this is what actually makes the Combine
// Symptoms box feel simple rather than like Expert Repertory: the first thing a doctor sees
// for "fever" is one word, not five long sentences. Only used in the symptom (combo) box —
// the named-condition box's disease list is already short and doesn't need this.
function quickIndexGroupHTML(term, selectedIds) {
  const q = term.trim().toLowerCase();
  if (!q) return null;
  const qWords = q.split(/\s+/);
  // A multi-word query must match a key EXACTLY — otherwise a two-word search like "urine
  // burning" gets swallowed by the shorter single-word "urine" entry (since it technically
  // starts with "urine"), hiding the more specific burning-urination group entirely. Prefix
  // tolerance (for mid-typing, e.g. "feve" while typing "fever") only makes sense when both
  // the query and the key are a single word.
  const key = Object.keys(QUICK_SYMPTOM_INDEX).find(k => {
    if (q === k) return true;
    return qWords.length === 1 && k.split(/\s+/).length === 1 && (q.startsWith(k) || k.startsWith(q));
  });
  if (!key) return null;
  const ids = QUICK_SYMPTOM_INDEX[key].filter(id => !selectedIds.has(id));
  if (!ids.length) return null;
  const tags = ids.map(id => CHIEF_SYMPTOM_TAGS.find(t => t.id === id)).filter(Boolean);
  const label = key.charAt(0).toUpperCase() + key.slice(1);
  return `<details class="quick-symptom-group">
    <summary>${esc(label)}</summary>
    ${tags.map(t => `<button type="button" class="protocol-suggestion-item" data-id="${esc(t.id)}">${esc(t.label)}</button>`).join("")}
  </details>`;
}
function renderSuggestionsInto(targetEl, query, wantDisease, wantSymptoms) {
  if (!protocolDataReady || !query.trim()) { targetEl.style.display = "none"; return; }
  const selectedIds = new Set(selectedSymptoms.map(s => s.tag.id));
  const selectedDiseaseIds = new Set(selectedDiseaseShortcuts.map(d => d.id));

  // Comma-separated batch search: "fever, chill, weak" — each term needs its OWN match pass
  // (the old single-pass search required every word of the WHOLE query in one tag's haystack,
  // so a comma list never matched anything at all). Suggestions are grouped under each term so
  // a doctor can tap-add the right chip for each symptom without clearing and retyping between
  // them — this is the actual gap; the free-text Expert Repertory box already handles a comma
  // list fine on its own, since it scores the whole case as prose rather than matching one tag.
  const terms = query.split(",").map(s => s.trim()).filter(Boolean);
  if (terms.length > 1) {
    let html = "";
    terms.forEach(term => {
      const quick = wantSymptoms && !wantDisease ? quickIndexGroupHTML(term, selectedIds) : null;
      html += `<div class="protocol-suggestion-group-label">${esc(term)}</div>`;
      if (quick) { html += quick; return; }
      const { matches, diseaseMatches, anyHits } = matchesForTerm(term, selectedIds, selectedDiseaseIds);
      const shown = (wantDisease ? diseaseMatches.length : 0) + (wantSymptoms ? matches.length : 0);
      if (!shown) {
        html += `<div class="protocol-suggestion-empty">${anyHits ? "Already added" : "No match — try a different word"}</div>`;
      } else {
        html += suggestionButtonsHTML(diseaseMatches, matches, wantDisease, wantSymptoms);
      }
    });
    targetEl.innerHTML = html;
    wireSuggestionButtons(targetEl);
    targetEl.style.display = "block";
    return;
  }

  const quick = wantSymptoms && !wantDisease ? quickIndexGroupHTML(query, selectedIds) : null;
  if (quick) {
    targetEl.innerHTML = quick;
    wireSuggestionButtons(targetEl);
    targetEl.style.display = "block";
    return;
  }

  const { matches, diseaseMatches, anyHits } = matchesForTerm(query, selectedIds, selectedDiseaseIds);
  const shown = (wantDisease ? diseaseMatches.length : 0) + (wantSymptoms ? matches.length : 0);
  if (!shown) {
    // Distinguish "you already added the only match" (not an error) from "this symptom
    // is not in the repertory yet" (a real coverage gap) — showing the same generic
    // message for both made an already-selected symptom look like a broken search.
    const msg = anyHits ? "Already added" : "No match — try a different word";
    targetEl.innerHTML = `<div class="protocol-suggestion-empty">${msg}</div>`;
    targetEl.style.display = "block";
    return;
  }
  targetEl.innerHTML = suggestionButtonsHTML(diseaseMatches, matches, wantDisease, wantSymptoms);
  wireSuggestionButtons(targetEl);
  targetEl.style.display = "block";
}
protocolSearchEl.addEventListener("input", () => renderSuggestionsInto(protocolSuggestionsEl, protocolSearchEl.value, true, false));
protocolSearchEl.addEventListener("focus", () => renderSuggestionsInto(protocolSuggestionsEl, protocolSearchEl.value, true, false));
comboSearchEl.addEventListener("input", () => renderSuggestionsInto(comboSuggestionsEl, comboSearchEl.value, false, true));
comboSearchEl.addEventListener("focus", () => renderSuggestionsInto(comboSuggestionsEl, comboSearchEl.value, false, true));
document.addEventListener("click", (e) => {
  if (!e.target.closest(".protocol-search-row") && !e.target.closest("#protocolSuggestions") && !e.target.closest("#comboSuggestions")) {
    protocolSuggestionsEl.style.display = "none";
    comboSuggestionsEl.style.display = "none";
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
  renderSymptomChips();
  updateGetComboBtnState();
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
        ${typeof card.percent === "number" ? `<div class="rc-potency">${confidenceStarsHTML(card.percent)}</div>` : ""}
      </div>
      <div class="rc-body">
        ${p.doses.map(doseLine).join("")}
        ${renderBiochemicBlock(p.biochemicSupport)}
        ${protocolFieldRow("Duration", p.duration)}
        ${protocolFieldRow("Review", p.review)}
        ${protocolFieldRow("Expected response", p.expectedResponse)}
        ${protocolFieldRow("Tip", p.tip)}
        ${card.repetitionNote ? protocolFieldRow("Repetition", card.repetitionNote) : ""}
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
        <div class="rc-eyebrow">🏷️ Named Condition Protocol · ${esc(headerLabel)}</div>
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
        ${typeof card.percent === "number" ? `<div class="rc-potency">${confidenceStarsHTML(card.percent)}</div>` : ""}
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

/* ---------- Supportive Care (Nosode support now comes entirely from the shared Miasmatic/
   Disease-Specific Nosode system in script.js — renderMiasmaticAnalysis/renderMiasmaticNosodes/
   renderDiseaseSpecificNosodes, reused here as-is) ---------- */

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
  // Check both the selected chief-symptom tags (label + rubric text) and any selected disease
  // names for red-flag language — this is the closest thing to "case text" that Expert
  // Protocol mode has, since there's no free-text case description here.
  const caseText = selectedSymptoms.map(s => s.tag.label + ". " + s.tag.rubric).join(". ")
    + ". " + selectedDiseaseShortcuts.map(d => d.label).join(". ");
  html += renderRedFlagBanner(detectRedFlags(caseText));
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
    if (disease.miasm) {
      html += renderMiasmaticAnalysis(disease.miasm);
      html += renderMiasmaticNosodes(disease.miasm);
      html += renderDiseaseSpecificNosodes(disease.diseaseNosodes);
    }
  });

  // Granular chief-symptom scoring runs independently and appends below, clearly separated,
  // if the doctor also picked individual symptoms alongside (or instead of) a disease shortcut.
  if (selectedSymptoms.length) {
    const ranked = scoreProtocolMatch(selectedSymptoms);
    const cards = generateProtocolCards(selectedSymptoms);
    if (cards.length) {
      // When a named-condition (disease shortcut) card was already rendered above, these
      // symptom-scored cards are a SEPARATE remedy for the rest of the case, not one blended
      // answer — relabel clearly so the doctor reads two intentional parts, not two competing
      // "top picks" for the same thing. See mixedWithShortcut branches in renderProtocolCard calls below.
      const mixedWithShortcut = selectedDiseaseShortcuts.length > 0;
      if (mixedWithShortcut) html += `<div class="protocol-section-divider">👇 Also matched from your other symptoms — a separate remedy for the rest of the case, alongside the named-condition protocol above:</div>`;
      cards.forEach(card => {
        if (card.tier === "primary") { html += renderProtocolCard(card, "green", mixedWithShortcut ? "Also Matched · Primary" : "Expert Protocol 1 · Primary"); html += renderClinicalPearl(card.remedy); }
        else if (card.tier === "alternative") html += renderProtocolCard(card, "blue", mixedWithShortcut ? "Also Matched · Alternative" : "Expert Protocol 2 · Alternative");
        // Only surface the full Banerji-style combination card — a complete separate dosing
        // protocol, shown with equal visual weight to the actual matches — when the disease it
        // was authored for genuinely overlaps with what the doctor selected. An unrelated
        // disease's full protocol (e.g. "Depression" surfacing on a hair-loss case just because
        // the same remedy happens to treat both) is real noise, not a helpful cross-reference —
        // that lighter-weight case belongs in the collapsed per-remedy FYI note, not a top-level card.
        else if (card.tier === "combination" && diseaseRelatesToSelection(card.diseaseContext)) html += renderCombinationCard(card);
      });
      const caseTextForMissing = selectedSymptoms.map(s => s.tag.label + ". " + s.tag.rubric).join(". ");
      html += renderMissingKeynotes(ranked[0].remedy, caseTextForMissing, "expert");
      // Miasmatic/Disease-Specific Nosodes are shown only when a named condition was detected
      // (see the disease-shortcut loop above) — pure granular-symptom scoring has no genuine
      // disease-derived miasm signal to draw on, so nothing is shown here rather than guessed.
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
    protocolResultsEl.innerHTML = `<div class="msg">No confident protocol match for this combination — try adding a more specific chief symptom, or switch to Expert Repertory mode for full-text case-taking.</div>`;
    return;
  }

  html += potencyGuideSection("expert");
  if (supportiveRemedy) html += renderSupportiveCare(supportiveRemedy, supportiveBiochemicSalts, supportiveTests);
  html += `<div class="caution">⚠ Expert Protocol gives a fast, symptom-merit-based suggestion from chief complaints only — it is not a substitute for full case-taking. Switch to Expert Repertory mode for a complete repertorized analysis.</div>`;

  protocolResultsEl.innerHTML = html;
}

// Plain-data snapshot of the currently selected chips, safe to store in a saved
// visit (no DOM/tag-object references) — used by patient-records.js so a saved
// visit keeps the exact section+intensity of each chip instead of just the
// chip text, which patient-records.js used to scrape from the DOM.
window.getProtocolSymptomSnapshot = function () {
  return selectedSymptoms.map((s) => ({
    id: s.tag.id,
    label: s.tag.rubric || s.tag.label, // full text — s.tag.label is UI-truncated ("…") for the chip button
    section: s.tag.section,
    intensity: s.intensity
  }));
};
getProtocolBtn.addEventListener("click", runProtocolSearch);
getComboBtn.addEventListener("click", runProtocolSearch);
