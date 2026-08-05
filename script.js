/* ============================================================
   SMART REMEDY AI — engine
   Loads remedies.json (remedies, biochemics, diseaseProtocols)
   and produces: Primary remedy, Alternatives, Dual-Remedy Regimen,
   Biochemic support, Suggested tests, Diet & lifestyle advice.
   ============================================================ */

let DB = null;        // { remedies, biochemics, diseaseProtocols }
let REPERTORY = null; // { repertory: [ {section, rubric, triggers, remedies:[{id,grade}]} ] }
let CHIEF_SYMPTOM_TAGS = null; // [ {id, label, section, rubric} ] — Protocol Mode's tag picker,
                                // one entry per repertory rubric; `rubric`+`section` is the join
                                // key back into REPERTORY for scoring, so tag labels can be
                                // polished independently of the underlying rubric's match text.
let DISEASE_SHORTCUT_TAGS = null; // [ {id, label, diseaseId, searchText} ] — one per curated
                                   // diseaseProtocols[] entry, lets a doctor jump straight to a
                                   // named condition's own curated protocol (e.g. typing
                                   // "abscess") instead of having to reconstruct it symptom by
                                   // symptom in Protocol Mode's chief-symptom picker.

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
    CHIEF_SYMPTOM_TAGS = repertoryJson.chiefSymptomTags || [];
    DISEASE_SHORTCUT_TAGS = (DB.diseaseProtocols || []).map(p => ({
      id: "disease_" + p.id,
      label: p.name,
      diseaseId: p.id,
      searchText: (p.name + " " + (p.synonyms || []).join(" ") + " " + (p.genericSynonyms || []).join(" ")).toLowerCase()
    }));
    buildWordDict();
    statusEl.textContent = "";
    resultBtn.disabled = false;
    // Protocol Mode (protocol-mode.js) waits for this rather than polling — keeps the two
    // files decoupled from each other's internal DOM/init details.
    document.dispatchEvent(new CustomEvent("smartRemedyDataReady"));
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

// COMMON ENGLISH WORDS: WORD_DICT above is built ONLY from words that happen to appear in the
// remedies' own keynote text — it is NOT a real English dictionary. That meant an ordinary,
// correctly-spelled word that simply never happens to appear in a keynote ("could", "since",
// "spotting", "asking", "tiny", "pacing"...) was being treated as a typo and forcibly rewritten
// to the nearest word that DOES appear in the materia medica text, regardless of relevance —
// e.g. "I could barely speak" silently became "I cold barely sweat", manufacturing a fake
// Arsenicum match out of nothing, while "tiny sips" (an actual Arsenicum keynote phrase)
// became "wind sips", destroying the real match. This is ordinary sentence vocabulary that
// fuzzyCorrect must never treat as a medical-term typo, checked before any correction attempt.
const COMMON_ENGLISH_WORDS = new Set([
  // number words — "eight" (as in "eight months ago") was being corrected to "light" purely
  // because it's a real, correctly-spelled word that never happens to appear in any keynote
  "one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve",
  "once","twice","first","second","third","fourth","fifth","sixth","dozen","hundred","thousand",
  // pronouns / determiners
  "this","that","these","those","them","they","their","theirs","there","then","than","when",
  "what","which","while","where","were","been","being","have","having","having","some","such",
  "each","every","both","most","other","others","another","same","only","very","just","also",
  "still","even","back","here","itself","himself","herself","myself","yourself","themselves",
  "ourselves","who","whom","whose","whoever",
  // prepositions / conjunctions
  "about","above","after","again","against","between","during","before","through","under",
  "over","until","since","because","although","though","unless","whereas","without","within",
  "along","among","around","behind","below","beside","beyond","despite","toward","towards",
  "upon","onto","into","across",
  // common verbs, all tenses/forms
  "could","would","should","might","must","shall","will","started","start","starting",
  "begin","began","begun","beginning","speak","speaks","spoke","spoken","speaking","tell",
  "tells","told","telling","asking","asked","asks","talk","talks","talked","talking","think",
  "thinks","thought","thinking","know","knows","knew","known","knowing","feel","feels","felt",
  "feeling","seem","seems","seemed","seeming","notice","notices","noticed","noticing","happen",
  "happens","happened","happening","become","becomes","became","becoming","comes","coming",
  "came","goes","going","gone","went","gets","getting","got","gotten","makes","making","made",
  "takes","taking","took","taken","gives","giving","gave","given","finds","finding","found",
  "wants","wanting","wanted","needs","needed","needing","tries","trying","tried","helps",
  "helping","helped","shows","showing","showed","shown","seems","looks","looking","looked",
  "worries","worried","worrying","confuses","confused","confusing","stormed","storming",
  "snapping","snapped","snaps","pacing","paces","paced","googling","googled","drinking",
  "drinks","drank","drunk","walking","walks","walked","bending","bends","bend","bent",
  "rolls","rolled","rolling","reacts","reacted","reacting","reaction",
  "pressing","presses","pressed","stopping","stops","stopped","staying","stays","stayed",
  "leaving","leaves","left","keeping","keeps","kept","letting","lets","let","calling","calls",
  "called","turning","turns","turned","moving","moves","moved","sitting","sits","sat",
  "standing","stands","stood","lying","lies","lay","lain","losing","loses","lost","meeting",
  "meets","met","running","runs","ran","bringing","brings","brought","writing","writes",
  "wrote","written","reading","reads","opening","opens","opened","closing","closes","closed",
  // common adjectives / adverbs
  "good","bad","big","small","large","little","long","short","high","low","old","new","young",
  "great","strange","strong","quick","quite","really","actually","honestly","basically",
  "generally","usually","normally","typically","occasionally","constantly","definitely",
  "probably","possibly","certainly","exactly","mainly","simply","clearly","obviously","surely",
  "especially","particularly","mostly","oddly","barely","hardly","rarely","suddenly",
  "gradually","completely","totally","entirely","slightly","somewhat","fairly","pretty",
  "extremely","incredibly","absolutely","almost","nearly","quite","enough","too","so","much",
  "many","more","most","less","least","few","several","couple","tiny","huge","massive",
  // time / frequency
  "today","yesterday","tomorrow","morning","afternoon","evening","tonight","week","weeks",
  "month","months","year","years","always","never","sometimes","often","again","ago","daily",
  "weekly","monthly","yearly","recently","lately","currently","immediately","eventually",
  "finally","meanwhile","afterward","afterwards","beforehand",
  // family / people / everyday nouns
  "husband","wife","mother","father","sister","brother","daughter","son","child","children",
  "family","friend","friends","doctor","people","person","things","thing","stuff","way","ways",
  "time","times","part","parts","side","sides","bit","bits","lot","lots","kind","sort"
]);

function fuzzyCorrect(word) {
  word = word.toLowerCase().replace(/[^a-z]/g, "");
  if (word.length < 4) return word;
  if (WORD_DICT.has(word) || COMMON_ENGLISH_WORDS.has(word)) return word;
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
  if (POST_ILLNESS_PATTERN.test(t)) return null;
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

/* ---------- Protocol Mode: Tier B fallback protocol generation ----------
   Every remedy already carries a `category` (acute/chronic/constitutional) and a
   `potency: {acute, chronic}` free-text field — this is real curated data, not invented
   here. Tier B never invents a specific potency or dose for a remedy; it only supplies
   GENERIC, category-level scheduling/duration/review/tip conventions (standard homeopathic
   prescribing practice, not remedy-specific claims) so that a remedy with no hand-authored
   diseaseProtocol entry can still produce a usable protocol card in Protocol Mode. Curated
   diseaseProtocols entries (Tier A) always take priority over this when one matches. */
const PROTOCOL_SCHEDULE_TEMPLATES = {
  acute: {
    potencySlot: "acute",
    scheduleFallback: "Repeat every 2-3 hours until improvement is noted, then reduce to 3 times daily",
    duration: "2-3 days, or until symptoms resolve",
    review: "Reassess if no improvement within 24-48 hours",
    expectedResponse: "Acute remedies typically show a response within hours to a day if well-indicated",
    tip: "Give in a clean mouth — avoid coffee, mint, or strong flavors around dosing"
  },
  chronic: {
    potencySlot: "chronic",
    scheduleFallback: "Single dose, then wait and observe",
    duration: "Observe for 2-4 weeks before repeating",
    review: "Review in 2-4 weeks, or sooner if new symptoms appear",
    expectedResponse: "Deeper-acting remedies often show gradual improvement over days to weeks",
    tip: "Avoid repeating the dose just because symptoms return mildly — reassess the whole case first"
  },
  constitutional: {
    potencySlot: "chronic",
    scheduleFallback: "Single dose, best selected and dosed under full case-taking",
    duration: "Observe for 3-4 weeks before considering a repeat",
    review: "Review in 3-4 weeks",
    expectedResponse: "Constitutional remedies act gradually — watch for overall improvement in energy and well-being, not just the presenting complaint",
    tip: "Note any brief initial aggravation of symptoms before improvement — this is common with well-indicated constitutional remedies"
  }
};

/* Builds a generic (Tier B) protocol object for a remedy that has no curated diseaseProtocols
   entry backing it. Shape intentionally mirrors the migrated diseaseProtocols[].protocols[]
   entries (see remedies.json) so both tiers can be rendered by the same UI code. */
function buildTierBProtocol(remedy) {
  const tpl = PROTOCOL_SCHEDULE_TEMPLATES[remedy.category] || PROTOCOL_SCHEDULE_TEMPLATES.chronic;
  const potencyText = (remedy.potency && remedy.potency[tpl.potencySlot] && remedy.potency[tpl.potencySlot] !== "-")
    ? remedy.potency[tpl.potencySlot]
    : (remedy.potency && (remedy.potency.acute !== "-" ? remedy.potency.acute : remedy.potency.chronic)) || "30C";
  return {
    tier: "generic",
    label: "General guidance (no specific clinical protocol on file for this presentation)",
    doses: [{
      remedy: remedy.id,
      remedyNameRaw: remedy.name,
      potency: potencyText,
      timing: "as needed",
      schedule: tpl.scheduleFallback
    }],
    biochemicSupport: null,
    note: null,
    duration: tpl.duration,
    review: tpl.review,
    expectedResponse: tpl.expectedResponse,
    tip: tpl.tip
  };
}

/* ---------- Protocol Mode: intensity-weighted chief-symptom scoring ----------
   Deliberately separate from the Classical engine's scoreRemedies() below — there is no
   free text here, so there is no parsing/matching ambiguity to resolve. Each selection is
   already an exact rubric the doctor picked; this function only has to do the arithmetic. */
const INTENSITY_WEIGHT = { "+": 0.5, "++": 1.0, "+++": 1.75, "++++": 2.75 };

/* selections: [{ tag: {id, label, section, rubric}, intensity: "+"|"++"|"+++"|"++++" }, ...]
   Returns remedies ranked by weighted rubric-grade sum, percent-normalized against the
   theoretical max (every selection matched at grade 3), with a hard gate: if any symptom
   was marked "++++", a remedy must be graded in at least one of those chief rubrics to
   be considered at all — a remedy that only covers secondary symptoms should never be able
   to outrank one that actually addresses what the doctor flagged as most important. */
function scoreProtocolMatch(selections) {
  if (!REPERTORY || !selections || !selections.length) return [];

  const remedyScores = {};      // id -> weighted score
  const remedyMatches = {};     // id -> [{ rubric, section, intensity, grade }]
  let maxPossible = 0;
  const mustCoverRubrics = [];  // rubrics tied to a "++++" selection

  selections.forEach(sel => {
    const weight = INTENSITY_WEIGHT[sel.intensity] || INTENSITY_WEIGHT["++"];
    const rubric = REPERTORY.find(r => r.section === sel.tag.section && r.rubric === sel.tag.rubric);
    if (!rubric) return;
    const sw = SECTION_WEIGHT[rubric.section] || 1.0;
    maxPossible += 3 * weight * sw; // 3 = highest curated grade, the "perfect match" ceiling
    if (sel.intensity === "++++") mustCoverRubrics.push(rubric);
    rubric.remedies.forEach(r => {
      const add = r.grade * weight * sw;
      remedyScores[r.id] = (remedyScores[r.id] || 0) + add;
      remedyMatches[r.id] = remedyMatches[r.id] || [];
      remedyMatches[r.id].push({ rubric: rubric.rubric, section: rubric.section, intensity: sel.intensity, grade: r.grade });
    });
  });

  let ids = Object.keys(remedyScores);
  if (mustCoverRubrics.length) {
    ids = ids.filter(id => mustCoverRubrics.some(rb => rb.remedies.some(r => r.id === id)));
  }

  return ids
    .map(id => {
      const remedy = DB.remedies.find(r => r.id === id);
      // Nosodes never compete to become the Primary/Alternative recommended remedy — same rule
      // as Classical mode. They only ever appear via the dedicated Miasmatic/Disease-Specific
      // Nosode sections, supporting rather than replacing the indicated constitutional remedy.
      if (!remedy || remedy.nosode) return null;
      const percent = maxPossible > 0 ? Math.round(Math.min(100, (remedyScores[id] / maxPossible) * 100)) : 0;
      return { remedy, rawScore: remedyScores[id], percent, matched: remedyMatches[id] };
    })
    .filter(Boolean)
    .sort((a, b) => b.rawScore - a.rawScore);
}

/* Diseases where this remedy is the FIRST-listed primary remedy — a reasonably strong signal
   it's a clinically central choice for that named condition. Used only to offer optional
   extra context (clearly labelled with the disease it's actually for); Protocol Mode's tag
   input has no disease name, so this is never assumed to match the doctor's actual case.
   Broad polychrests (Arsenicum, Nux Vomica, Pulsatilla, ...) are first-choice for many
   UNRELATED named conditions — surfacing all of them would let a fever case get handed a
   Banerji combination sourced from an asthma protocol. Only surface this when the remedy is
   the first choice for a SMALL number of conditions (a real distinguishing signal), never
   when it's broadly primary for many — better to show nothing than something wrong. */
const RELATED_DISEASE_PROTOCOL_MAX = 2;
function findRelatedDiseaseProtocols(remedyId) {
  const matches = DB.diseaseProtocols.filter(p => (p.primaryRemedies || [])[0] === remedyId);
  return matches.length <= RELATED_DISEASE_PROTOCOL_MAX ? matches : [];
}

function buildProtocolCard(rankedEntry, tier) {
  const remedy = rankedEntry.remedy;
  const related = findRelatedDiseaseProtocols(remedy.id);
  return {
    tier, // "primary" | "alternative"
    remedy,
    percent: rankedEntry.percent,
    matchedRubrics: rankedEntry.matched,
    protocol: buildTierBProtocol(remedy),
    relatedDiseaseProtocols: related.map(p => ({ name: p.name, protocols: p.protocols }))
  };
}

/* Main entry point for Protocol Mode. selections: same shape as scoreProtocolMatch's input.
   Returns 2-4 cards: Primary, Alternative, and — only when genuinely on file, never
   fabricated — a Banerji-style dual-remedy combination sourced from a curated disease
   protocol, explicitly labelled with which named condition it came from. */
function generateProtocolCards(selections) {
  const ranked = scoreProtocolMatch(selections);
  if (!ranked.length) return [];

  const cards = [buildProtocolCard(ranked[0], "primary")];
  if (ranked[1]) cards.push(buildProtocolCard(ranked[1], "alternative"));

  const relatedForTop = findRelatedDiseaseProtocols(ranked[0].remedy.id);
  const combo = relatedForTop.find(p => p.protocols[0] && p.protocols[0].doses.length >= 2);
  if (combo) {
    cards.push({ tier: "combination", diseaseContext: combo.name, protocol: combo.protocols[0] });
  }
  return cards.slice(0, 4);
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
  // "like" was matching as if it were real symptom content (e.g. "isn't like me at all")
  // purely because it's also a fragment of unrelated keynote text like "lightning-like" —
  // it's a filler/comparison word almost everywhere in casual speech, never real evidence.
  "like", "seem", "seems", "kind", "sort",
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
  if (a.length < 5 || b.length < 5) return false;
  // A flat "first 5 letters match" let unrelated words with a shared prefix collide —
  // "constipated" and "constitution" both start "const", but share only 5 of 11-12 letters
  // (worse than half), which let Bryonia coincidentally match "the patient is CONSTIPATED"
  // against an unrelated "robust CONSTITUTION" keynote. Requiring the shared prefix to cover
  // most of the shorter word (not just a fixed 5 chars) still catches genuine suffix variants
  // (stool/stools, irritable/irritability, tonsils/tonsillitis all clear ~80%+) while rejecting
  // coincidental prefix overlaps between otherwise-different words.
  let common = 0;
  const shorter = Math.min(a.length, b.length);
  while (common < shorter && a[common] === b[common]) common++;
  return common >= 5 && common / shorter >= 0.7;
}
function countHits(kWords, inputWords) {
  return kWords.reduce((c, kw) => c + (inputWords.some(iw => wordsMatch(kw, iw)) ? 1 : 0), 0);
}

// PERMANENT FIX for body-location mismatches (e.g. "right leg pain" matching a keynote about
// "right eye pain" or "right shoulder pain" purely because they share generic words like
// "right"/"pain"). Word-overlap matching has no concept of anatomy — "leg" and "eye" are just
// two unrelated words to it, so a keynote about a totally different body part could still earn
// partial credit from the shared filler words. This is a structural fix, not another one-off
// patch: if the query names a specific body part AND a candidate keynote also names a specific
// body part, they must refer to the SAME part or the match is rejected outright, regardless of
// how many other words overlap. If either side doesn't mention a body part, no constraint
// applies (most keynotes are already written in relation to a symptom, not every case needs
// this check to fire).
const ANATOMY_WORDS = new Set([
  "head","scalp","forehead","face","eye","eyes","ear","ears","nose","mouth","teeth","tooth",
  "gums","tongue","jaw","cheek","cheeks","throat","neck","shoulder","shoulders","arm","arms",
  "elbow","elbows","wrist","wrists","hand","hands","finger","fingers","chest","breast","back",
  "spine","abdomen","stomach","belly","hip","hips","groin","thigh","thighs","leg","legs","knee",
  "knees","calf","calves","shin","ankle","ankles","foot","feet","toe","toes","heart","liver",
  "kidney","kidneys","bladder","uterus","ovary","ovaries","testicle","testicles","rectum",
  "anus","skin","heel","joint","joints"
]);
// WEAK_MODIFIER_WORDS: same idea as ANATOMY_WORDS not counting as sufficient evidence alone —
// words that just name the TOPIC/body-side rather than any real distinguishing content.
// "right"/"left" nearly always describe a body side ("right eye"), so a bare "right" matching
// casual speech ("if I don't eat right...") was letting Apis's unrelated "ovarian pain, right
// side" keynote win a case about an itchy scalp. "stool"/"constipation" are the same failure
// for GI topic words — "The patient is constipated. Stool comes a little and then goes back"
// was matching Alumina/Bryonia keynotes ("stools large, dry, hard") purely on the bare word
// "stool"/"constipation", with NONE of the actually distinguishing content (hard, dry, sheep
// dung, no urge) present in the input — same class of bug as Taraxacum/tongue, different topic.
const WEAK_MODIFIER_WORDS = new Set([
  "right", "left", "stool", "stools", "constipation", "constipated", "diarrhea", "diarrhoea"
]);

// MANDATORY CONDITION RULE: for a curated set of serious/diagnostic terms, a coincidental
// match on some unrelated word (even a real symptom word, not just anatomy) is dangerously
// misleading — e.g. "paralysis of tongue" should never surface a remedy whose only connection
// is an unrelated tongue-coating keynote. When the input names one of these, a keynote is only
// allowed to count as a match if it ALSO contains that same condition word — this is a hard
// gate, not a weighting nudge, and only ever activates when one of these specific terms is
// present, so it can't affect the vast majority of ordinary symptom searches.
// NOTE: this only catches terms that tokenize into one specific, unambiguous word. A few
// common doctor phrasings ("heart attack", "kidney failure", "liver failure") don't have a
// safe single-word stand-in — "heart"/"kidney"/"liver" are plain anatomy words and "attack"/
// "failure" are too generic on their own (e.g. "panic attack", "failure to thrive" are
// unrelated) — so those need phrase-level detection this list can't do. Flag if that's needed.
// Deliberately excludes common CHRONIC conditions (diabetes, asthma, eczema, psoriasis,
// bronchitis, schizophrenia...) even though they're "serious" in the everyday sense — those
// are treated in homeopathy via broad symptom-totality matching (and repertory rubrics, which
// this rule doesn't touch at all), so forcing every keynote to literally contain the disease
// name would block legitimate matches and cause MORE "no confident match" results for very
// common searches. This list is only for conditions specific/acute enough that a genuinely
// relevant keynote realistically would name them outright.
const SIGNIFICANT_CONDITION_WORDS = new Set([
  "paralysis","paralyzed","paralysed","paralytic","cancer","carcinoma","tumor","tumour",
  "malignant","leukemia","leukaemia","lymphoma","sarcoma","melanoma","fracture","fractured",
  "hemorrhage","haemorrhage","gangrene","sepsis","septic","stroke","seizure","seizures",
  "convulsion","convulsions","epilepsy","epileptic","coma","comatose","tuberculosis",
  "meningitis","appendicitis","aneurysm","dementia","alzheimers","parkinsons","pneumonia",
  "hepatitis","typhoid","diphtheria","tetanus","rabies","cholera","cirrhosis","jaundice",
  "pancreatitis","peritonitis","embolism","thrombosis","lupus","malaria","encephalitis",
  "poliomyelitis","polio","osteoporosis","infarction","myocardial","sclerosis","nephropathy",
  "glaucoma","cataract","leprosy","hiv","aids"
]);
function anatomyWordsIn(words) {
  return words.filter(w => ANATOMY_WORDS.has(w));
}
// ANATOMY_GROUPS: sub-parts that are really the same broader region for conflict-checking
// purposes — without this, a keynote about "cheek" was flagged as conflicting with a case
// that said "face" (rejecting an otherwise near-perfect 6/9-word Chamomilla match for a
// one-sided facial flush, exactly the kind of case that keynote exists to catch), purely
// because "cheek" and "face" are different literal words for overlapping anatomy.
const ANATOMY_GROUPS = [
  new Set(["face", "cheek", "cheeks", "forehead", "jaw"]),
  new Set(["eye", "eyes"]),
  new Set(["ear", "ears"]),
  new Set(["hand", "hands", "wrist", "wrists", "finger", "fingers"]),
  new Set(["foot", "feet", "toe", "toes", "ankle", "ankles"]),
  new Set(["leg", "legs", "thigh", "thighs", "calf", "calves", "shin", "knee", "knees"]),
];
function anatomyGroupMatch(a, b) {
  if (a === b) return true;
  return ANATOMY_GROUPS.some(g => g.has(a) && g.has(b));
}
function anatomyConflict(inputAnatomy, keynoteAnatomy) {
  if (!inputAnatomy.length || !keynoteAnatomy.length) return false; // no constraint if either is silent on location
  return !keynoteAnatomy.some(k => inputAnatomy.some(i => anatomyGroupMatch(i, k)));
}

// MODALITY POLARITY PAIRING: a keynote like "better from heat" must only match when the
// INPUT actually pairs "better" with "heat" — not when the input separately contains "worse
// heat" AND "better cold" (a different, even opposite, clinical picture). Plain bag-of-words
// matching only checks that both words appear SOMEWHERE, with no concept of which polarity
// word is paired with which quality word, so a case describing "worse heat, better cold"
// could still score a match on "better heat" — the reverse of what the patient actually said.
// This requires the polarity word to be followed within a short window by the keynote's
// quality word(s) in the input, before a modality-type keynote counts as a candidate at all.
// Same idea as modalityPolarityMatches, but for thirst specifically — a remedy keynote
// describing genuine thirst ("excessive thirst", "great thirst for cold water") should not
// count as supporting evidence when the case explicitly states thirstlessness. Kept as its
// own small, narrowly-scoped function rather than folded into a general "contradiction
// engine" — a blanket global contradiction system was tried in an earlier session and
// measurably made accuracy worse by over-penalizing legitimately broad polychrests.
function thirstPolarityMatches(rawKeynoteText, inputText) {
  const kText = rawKeynoteText.toLowerCase();
  if (!/\bthirst/.test(kText)) return true; // not thirst-related — no constraint
  // If the keynote ITSELF already describes thirstlessness (e.g. "thirstless despite
  // fever"), there's no contradiction to check — it already matches that polarity.
  if (/thirstless|no thirst|not thirsty|without thirst/.test(kText)) return true;
  const t = " " + inputText.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ") + " ";
  const inputStatesThirstless = / thirstless | no thirst | not thirsty | without thirst | absence of thirst /.test(t);
  return !inputStatesThirstless;
}

function modalityPolarityMatches(rawKeynoteText, kWords, inputText) {
  const polarityMatch = rawKeynoteText.trim().match(/^(worse|better)\b/i);
  if (!polarityMatch) return true; // not a modality-style keynote — no constraint
  const polarity = polarityMatch[1].toLowerCase();
  const opposite = polarity === "worse" ? "better" : "worse";
  const qualityWords = kWords.filter(w => w !== "worse" && w !== "better");
  if (!qualityWords.length) return true; // nothing to pair against — fall back to normal matching
  const t = " " + inputText.toLowerCase() + " ";
  const WINDOW_CHARS = 60; // rough char budget standing in for "a few words of tolerance"
  let searchFrom = 0;
  while (true) {
    const polIdx = t.indexOf(" " + polarity + " ", searchFrom);
    if (polIdx < 0) return false; // this polarity word never appears at all
    const windowText = t.slice(polIdx, polIdx + polarity.length + 1 + WINDOW_CHARS);
    // Reject if the quality word is only found AFTER the opposite polarity word appears in
    // this same window — e.g. "worse heat better cold" must not let Ars-alb's "worse from
    // cold" keynote match just because "cold" happens to show up later in the sentence,
    // when it actually belongs to the separate "better cold" clause. Same class of bug
    // already fixed for repertory triggers; this closes the same hole in materia medica.
    const oppositeIdx = windowText.indexOf(" " + opposite + " ");
    const safeWindow = oppositeIdx >= 0 ? windowText.slice(0, oppositeIdx) : windowText;
    if (qualityWords.every(w => safeWindow.includes(" " + w))) return true;
    searchFrom = polIdx + polarity.length; // try the next occurrence of this polarity word, if any
  }
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
// Symptom-weighting hierarchy: mental generals carry the most diagnostic weight in classical
// prescribing, followed by physical generals & modalities, with particular/local symptoms
// (a specific body-part complaint) carrying real but comparatively lesser weight. Disease-name
// matching (the diseaseProtocol boost elsewhere) is intentionally the lowest of all.
// Symptom-weighting hierarchy — UPDATED per explicit scoring rule: Location & Modalities = 5
// (very high), General & Mental symptoms = 3 (high), common/particular clinical symptoms = 1
// (low). This supersedes the earlier "Mental generals = highest" hierarchy — Mind is now
// tier 2 (tied with General), not tier 1. Ratios below are scaled from that 5:3:1 spec.
const SECTION_WEIGHT = {
  Modalities: 1.67,  // location & modalities — VERY HIGH (tier 1)
  // Causation ("ailments from grief/fright/anger/...") is new — a doctor reaches for this
  // rubric before almost anything else when a case names its own trigger; it's given the
  // highest weight of any section since it's rarely coincidental the way a bare physical
  // symptom can be.
  Causation: 2.0,
  Mind: 1.0,          // mental symptoms — HIGH (tier 2, same as general)
  Thirst: 1.0, Appetite: 1.0, // general symptoms — HIGH (tier 2)
  // Common and Extremities were originally set to the same LOW tier as bare/generic
  // fallback rubrics (undifferentiated fever, generic constipation) — but most of what's
  // actually IN those sections (acne with pus, hair loss, nosebleed, nerve injury, leg pain)
  // are specific, diagnostic presenting complaints, not vague generalities. Leaving them
  // low meant a genuinely defining physical complaint (e.g. "acne with pus, worse touch,
  // better warmth") lost out to a generic Mind match ("irritable") purely because of which
  // bucket the rubric happened to be filed under, not because the Mind match was actually
  // more diagnostic for that case.
  Common: 1.0, Extremities: 1.0,
  // Weight gets the same treatment as Common did — "emaciation despite good appetite" is a
  // specific, well-known differentiator (the Iodum/Abrotanum picture), not a vague symptom,
  // so it shouldn't be discounted below a generic remedy's bare Constipation match.
  Weight: 1.0,
  Stool: 0.33, Fever: 0.33 // still low — these sections lean more toward
                           // generic/fallback rubrics (bare constipation,
                           // undifferentiated fever) rather than SRPs
};
// RUBRIC_WEIGHT_OVERRIDE: a small number of individual rubrics are genuinely peculiar,
// pathognomonic symptoms (Hering's "keynote" symptoms) that happen to live in a section
// SECTION_WEIGHT otherwise treats as low-value fallback content — e.g. "stool recedes after
// partial expulsion" sits in Stool (weighted 0.33, since most Stool rubrics really are generic
// fallbacks like bare "constipated"), but this specific symptom is one of the single most
// distinctive, textbook-defining signs for Silicea, on par with a Modalities-tier match. Only
// add a rubric here when it's this kind of rare, highly characteristic single symptom — not as
// a general way to boost a remedy.
const RUBRIC_WEIGHT_OVERRIDE = {
  "Stool recedes after partial expulsion (bashful/shy stool)": SECTION_WEIGHT.Modalities,
  "Colic better bending double or with pressure": SECTION_WEIGHT.Modalities,
};
// GENERIC (location/complaint-agnostic) SECTIONS: Thirst, Appetite, Fever and Weight describe
// a constitutional REACTION PATTERN (thirstless, ravenous at 11am, etc.) that says nothing
// about WHAT the presenting complaint actually is — almost every remedy is graded on some of
// these, and the repertory data has essentially no location tagging on them (only 1 of 174
// rubrics carries a location field at all). That let a remedy like Apis win completely
// unrelated cases (an itchy scalp, an ear infection) purely off "thirstless" — a real symptom
// of the case, but one with zero connection to what the case is actually ABOUT. Mind/Common/
// Stool/Extremities rubrics name the actual presenting symptom (grief, hair loss, vertigo, leg
// pain...) and are NOT generic — a grief case winning on Mind alone (Nat-mur) is correct.
const GENERIC_SECTIONS = new Set(["Thirst", "Appetite", "Fever", "Weight"]);
// Modalities is handled separately, NOT as a whole-section rule — unlike Thirst/Appetite, a
// modality is very often the presenting complaint's own defining behavior (Bryonia's "worse
// motion, better pressure" for a back spasm basically IS the complaint, not incidental
// generalist noise), so treating the whole section as generic broke real, correct matches.
// Only the subset below — pure thermal/weather/time-of-day reaction patterns with no pain
// character or body-specific content of their own — are the ones that caused the Apis-wins-
// everything failure, so only these count as generic; mechanical/pain modalities do not.
// Also covers named "general/unspecified" fallback rubrics outside Thirst/Appetite/Fever/
// Weight — e.g. "Constipation, general/unspecified" (Stool section) let Bryonia's bare
// "I'm constipated" mention out-boost Silicea's far more specific, later-mentioned "stool
// recedes after partial expulsion" purely because the generic one happened to appear first in
// the text and MAIN_COMPLAINT_BOOST rewards earliest position, not diagnostic specificity.
const GENERIC_MODALITY_RUBRICS = new Set([
  "Worse before a thunderstorm or change of weather",
  "Every change to cold damp weather brings new symptoms, worse from chill after being overheated",
  "Cannot bear warmth of bed, throws off covers, itching or burning worse from heat of bed",
  "Worse around 10-11am, worse from heat and sun",
  "Worse from cold, better from heat",
  "Worse from heat, better from cold",
  "Worse in morning",
  "Worse in evening or night",
  "Constipation, general/unspecified"
]);
// How hard a remedy's generic-only evidence gets discounted when it has NO corroborating
// complaint-specific evidence at all (no Mind/Common/Stool/Extremities rubric, no real materia
// medica keynote hit) — mirrors the existing MM_WEIGHT_CONFIRM-style "this is confirmation,
// not proof" pattern already used elsewhere in this file.
const GENERIC_ALONE_DISCOUNT = 0.2;
// LOCATION_SCORE_BONUS: location is scored explicitly (not just used as a pass/fail filter)
// per the "Location match = +5" rule — applied directly in scoreRemedies below wherever a
// materia medica keynote's body part matches the query's.
const LOCATION_SCORE_BONUS = 1.67; // same tier as Modalities, per the 5:5 parity in the rule
// LOCATION_SCORE_BONUS applies only to specific, diagnostically distinctive body parts —
// extremities, joints, organs — not broad generic terms like "face" or "skin" that appear
// across dozens of unrelated keynotes. Testing this rule found exactly that problem: "red
// face" is common wording in many different remedies' fever/headache keynotes, and applying
// the location bonus there let obscure coincidental matches (Melilotus, Ferrum Met) outrank
// Aconitum — the actual textbook remedy — for a sudden-fever case. The broader ANATOMY_WORDS
// set (used for the exclusion/conflict check) stays broad, since excluding a mismatch is safe;
// this narrower set is only for the reward bonus, which needs to be conservative.
const LOCATION_BONUS_WORDS = new Set([
  "eye","eyes","ear","ears","shoulder","shoulders","arm","arms","elbow","elbows","wrist",
  "wrists","hand","hands","finger","fingers","hip","hips","groin","thigh","thighs","leg",
  "legs","knee","knees","calf","calves","ankle","ankles","foot","feet","toe","toes","heart",
  "liver","kidney","kidneys","bladder","uterus","ovary","ovaries","testicle","testicles",
  "rectum","joint","joints","spine","back"
]);

// LOCATION FILTERING for repertory rubrics — optional, opt-in per rubric. Most rubrics
// (Mind, Appetite, Thirst, Weight, Stool, general Modalities) have no location field and are
// unaffected. Rubrics that DO specify a location (e.g. an Extremities/leg-pain rubric) will
// only fire when the input names the same body part — this stops e.g. a generic "right ...
// pain" query from matching a rubric that's actually about a completely different body part.
function parseLocation(text) {
  const t = " " + text.toLowerCase() + " ";
  let location = null, side = null;
  for (const w of ANATOMY_WORDS) { if (t.includes(" " + w + " ")) { location = w; break; } }
  if (t.includes(" right ")) side = "right";
  else if (t.includes(" left ")) side = "left";
  return { text, location, side };
}
function matchLocation(rubric, input) {
  if (!rubric.location) return true;
  if (rubric.location.main !== input.location) return false;
  if (rubric.location.side && rubric.location.side !== input.side) return false;
  return true;
}

// IDF-STYLE RARITY WEIGHTING: a remedy graded across MANY different rubrics (a "generalist")
// gets each individual match discounted, while a remedy graded in only a few rubrics (a
// "specialist" for that particular symptom) gets full or boosted credit. This directly
// counters dominance bias — without it, a remedy like Natrum Muriaticum (graded in 13
// rubrics) can accumulate a winning score just from breadth of coverage across many
// DIFFERENT symptom categories, even when no single match is the case's actual defining
// pathology. A remedy is only discounted for breadth it's actually earned; a remedy that's
// both broad AND genuinely strongly-matched can still win — it just can't win on breadth alone.
let REMEDY_BREADTH = null;
function computeRemedyBreadth() {
  const breadth = {};
  (REPERTORY || []).forEach(rubric => {
    rubric.remedies.forEach(r => { breadth[r.id] = (breadth[r.id] || 0) + 1; });
  });
  return breadth;
}
function idfFactor(remedyId) {
  if (!REMEDY_BREADTH) REMEDY_BREADTH = computeRemedyBreadth();
  const breadth = REMEDY_BREADTH[remedyId] || 1;
  return 1 / (1 + 0.4 * Math.log(breadth)); // gentler slope — breadth=1 -> 1.0, breadth=13 -> ~0.50
}

// SYNONYM NORMALIZATION: a huge fraction of the bugs found this session were the same root
// cause wearing different clothes — "craves salt" matched, "desires salt" didn't, purely
// because the trigger was written for one specific word form. Rather than manually adding
// every variant to every rubric as each surfaces (which is what's been happening), rewrite
// common synonymous PATTERNS to one canonical form before matching ever runs. Every trigger
// in the repertory only needs to be written in the canonical form once; every known variant
// then automatically routes to it. Starting with cravings (the reported example) since that
// pattern is well-scoped and low-risk; this can grow the same incremental way everything
// else in the repertory has, as more synonym patterns get discovered through real cases.
function normalizeSynonyms(text) {
  // Restricted to a curated list of actual craveable items throughout — NOT applied to any
  // arbitrary word. A first version transformed "wants X" -> "craves X" unconditionally,
  // which silently broke existing triggers like "wants sympathy", "wants warmth", and
  // "wants to be held" — none of those are food cravings, but the blanket transformation
  // couldn't tell the difference and rewrote them into nonsense before matching ever ran.
  const ITEM = "(salt|sweets?|sugar|chocolate|eggs?|milk|spicy|sour|ice|fat|meat|alcohol|cold water|warm water|warm drinks|cold drinks)";
  return text
    // "desire for salt" / "desires salt" -> "craves salt"
    .replace(new RegExp("\\bdesires? for " + ITEM, "g"), "craves $1")
    .replace(new RegExp("\\bdesires? " + ITEM, "g"), "craves $1")
    // "craving for salt" / "craving salt" -> "craves salt"
    .replace(new RegExp("\\bcraving for " + ITEM, "g"), "craves $1")
    .replace(new RegExp("\\bcraving " + ITEM, "g"), "craves $1")
    // "wants salt" -> "craves salt" (restricted to items only, so "wants sympathy"/"wants
    // warmth"/"wants to be held" are untouched — those aren't food cravings)
    .replace(new RegExp("\\bwants " + ITEM, "g"), "craves $1")
    // "salt craving" / "salt desire" -> "craves salt" (reversed word order)
    .replace(new RegExp("\\b" + ITEM + "\\s+(?:craving|desire)\\b", "g"), "craves $1")
    // Thirstless cluster: several common phrasings for "no desire to drink" that the
    // existing "no thirst"/"not thirsty" triggers don't cover on their own.
    .replace(/\bdoes(?:n't| not) (?:feel|seem) thirsty\b/g, "thirstless")
    .replace(/\bnever (?:feels?|seems?) thirsty\b/g, "thirstless")
    .replace(/\bno (?:desire|urge) (?:to drink|for water)\b/g, "thirstless")
    .replace(/\bdoes(?:n't| not) want (?:water|to drink)\b/g, "thirstless")
    .replace(/\bhave?n'?t wanted (?:a |any )?(?:single )?drop\b/g, "thirstless")
    .replace(/\bbarely (?:any|wanted) thirst\b/g, "thirstless")
    .replace(/\bhave?n'?t wanted to drink (?:much|a lot)\b/g, "thirstless")
    // Worse-motion cluster: "aggravated by movement" and similar phrasings that don't
    // literally contain the word "worse" or "motion" together.
    .replace(/\baggravated by (?:motion|movement|moving)\b/g, "worse motion")
    .replace(/\b(?:movement|moving|any movement) makes? it (?:[a-z]+ ){0,2}worse\b/g, "worse motion")
    .replace(/\bgets? worse with (?:motion|movement|moving)\b/g, "worse motion")
    // Better-motion cluster: "improves with motion"/"eases with movement" mean the same
    // clinical fact as "better motion" but don't literally contain the word "better".
    .replace(/\bimproves? with\b/g, "better")
    .replace(/\beases? with\b/g, "better")
    // "X rather than making it worse" is a NEGATION of worse (the thing described actually
    // helps) — left as-is, the literal word "worse" sitting right next to whatever caused it
    // (e.g. "hot water... rather than making it worse") was being read by the modality
    // matcher as a genuine "worse from heat" aggravation, the opposite of what the sentence
    // actually says. Strip the whole negated clause so only the true polarity remains.
    .replace(/\brather than (?:making it |getting )?worse\b/g, "")
    // "hot" (adjective, e.g. "room gets hot") -> "heat" (noun, what every "worse heat"
    // trigger actually expects). Narrative text overwhelmingly uses "hot", but the
    // repertory's modality triggers were all written in the noun form.
    .replace(/\bhot\b/g, "heat");
}

function scoreRepertory(inputText) {
  // NOTE: preserve digits (a-z AND 0-9) — a version that stripped all non-letter characters
  // meant a trigger like "4pm" could never match anything, since the input's own "4pm" was
  // being reduced to " pm" (digit stripped) while the trigger text still had the digit intact.
  // This silently broke every time-of-day-based trigger (4-8pm, 12am, 3am) until now.
  // Clause-ending punctuation (. ; ! ?) AND contrastive conjunctions ("but", "however",
  // "although", "yet") are converted to a "clausebreak" marker — but a plain COMMA is
  // deliberately NOT treated as one. The original bug ("no thirst, but the appetite is
  // good") was really caused by the word "but" signaling a contrast between two different
  // topics, not by the comma itself. Treating every comma as a hard block broke the much
  // more common case of a plain symptom list ("fever, chills, vomiting, diarrhea") — a
  // list joined by commas describes the SAME patient's symptoms together, not a contrast.
  const t = " " + normalizeSynonyms(inputText.toLowerCase())
    .replace(/\b(but|however|although|yet)\b/g, "$1 clausebreak")
    .replace(/[.;!?]/g, " clausebreak ")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ") + " ";
  const inputLoc = parseLocation(inputText);
  const remedyScores = {};      // id -> accumulated weighted grade total
  const remedyGenericScores = {}; // id -> portion of remedyScores that came ONLY from
                                   // GENERIC_SECTIONS (see above) — used to discount a remedy
                                   // that has no complaint-specific evidence behind it at all
  const remedyRubrics = {};     // id -> [ "Section: rubric text", ... ] (for display)
  if (!REPERTORY) return { remedyScores, remedyGenericScores, remedyRubrics, firedRubrics: [], mainComplaintRubric: null };

  const firedRubrics = [];
  // MAIN COMPLAINT DETECTION: the fired rubric whose trigger appears EARLIEST in the text is
  // treated as the case's main complaint (first-mentioned/most emphasized symptom). Per Step 3,
  // a Mind-section match takes priority as "main complaint" over an equally-early physical one,
  // since mental symptoms are meant to dominate the case here.
  let mainComplaintRubric = null;
  let earliestPos = Infinity;
  // TRIGGER_GAP_STOPWORDS: qualifier/intensifier words allowed to appear BETWEEN the words
  // of a multi-word trigger without breaking the match — e.g. "worse from motion" must still
  // fire on "worse from slightest motion". Without this, exact-contiguous-phrase matching
  // silently failed on any input with an inserted qualifier, which meant the single most
  // important Modality/Thirst rubric for a case could fail to fire at all, letting a
  // completely unrelated but literally-earlier-firing rubric (like generic "irritable")
  // wrongly claim the main-complaint boost instead.
  function triggerFires(trigger, text) {
    // NEGATION CHECK: applies to every trigger, not just the hand-picked "no fever" case
    // from earlier. A case can say "haven't been drinking small sips" — the words "small
    // sips" are right there and would otherwise match, but the sentence is explicitly
    // DENYING that symptom, not reporting it. Reject any match where a negation word
    // appears in the short window immediately before where the trigger phrase starts.
    const NEGATION_WINDOW_CHARS = 25;
    function isNegated(matchStartIdx) {
      const before = text.slice(Math.max(0, matchStartIdx - NEGATION_WINDOW_CHARS), matchStartIdx + 1);
      // "without fail" is an idiom meaning "always/reliably", not a negation of whatever
      // follows it ("without fail I get this urgent hunger" means the hunger DOES happen) —
      // strip it out before checking so its "without" doesn't falsely negate the real symptom.
      const beforeSansIdiom = before.replace(/ without fail /g, " ");
      return / (not|no|never|haven|hasn|hadn|without|isn|wasn|aren|weren|doesn|didn|don) /.test(beforeSansIdiom);
    }
    const exactIdx = text.indexOf(" " + trigger.toLowerCase() + " ");
    if (exactIdx >= 0) return isNegated(exactIdx) ? -1 : exactIdx;
    // NOTE: deliberately NOT using the global STOPWORDS set here — that list treats
    // "worse"/"better" as optional (correct for materia medica matching), but for a
    // repertory TRIGGER phrase the polarity word is semantically essential ("worse from
    // motion" vs "better from motion" are different rubrics) and must not be stripped down
    // to a single generic word like "motion".
    const TRIGGER_GAP_FILLERS = new Set(["from", "of", "in", "on", "the", "a", "an", "to", "with"]);
    const words = trigger.toLowerCase().split(/\s+/).filter(w => w && !TRIGGER_GAP_FILLERS.has(w));
    if (words.length < 2) return -1; // single-word triggers already handled by exact match
    // A plain word-count or character-distance gap limit can't tell "worse from slightest
    // motion" (a legitimate qualifier in the gap) apart from "worse heat, better cold" (the
    // OPPOSITE polarity word sitting in the gap — a different clause entirely, describing the
    // reverse of what the trigger means). Both have the same gap size. What actually
    // distinguishes them: the bad case has the trigger's own opposite polarity word inside the
    // gap. So the rule is explicit, not distance-based — reject if "better" appears inside the
    // gap of a "worse ..." trigger, or "worse" appears inside the gap of a "better ..." trigger.
    const opposite = words[0] === "worse" ? "better" : (words[0] === "better" ? "worse" : null);
    const MAX_GAP_CHARS = 55; // widened to accommodate longer comma-separated symptom
                               // lists ("fever, chills, vomiting, vomiting, diarrhea") —
                               // safe to widen because the clausebreak and opposite-polarity
                               // checks below now do the real work of rejecting genuinely
                               // unrelated bridges, not the character distance alone
    // findWholeWord: text.indexOf(" " + w, ...) alone only checks a LEADING space boundary —
    // that let "rest" match inside "restless", "restaurant", etc. Must also confirm the
    // character right after the word is a space (or end of string), or every short trigger
    // word risks matching as a prefix of some longer, unrelated word.
    function findWholeWord(w, fromIdx) {
      let idx = fromIdx;
      while (true) {
        idx = text.indexOf(" " + w, idx);
        if (idx < 0) return -1;
        const afterCharIdx = idx + 1 + w.length;
        if (text[afterCharIdx] === " ") return idx;
        idx += 1; // this occurrence was a prefix of a longer word — keep searching
      }
    }
    // Extracted so it can be tried in more than one word order — see below. Takes an
    // explicit ORDERED list of words and the polarity word to treat as "opposite-sensitive"
    // (may not be at position 0 once word order is reversed).
    // Quality-word opposites: catches cases where the polarity word itself (worse/better)
    // wasn't swapped, but the QUALITY word's conceptual opposite sits in the gap instead —
    // e.g. "gets worse the moment I walk into a warm room from the cold outside air": here
    // "worse" and "cold" are both present in the right order, but "warm room" (the ACTUAL
    // cause) sits directly between them. Without this, "worse...cold" would wrongly fire a
    // worse-from-cold trigger when the real aggravating factor was heat, not cold at all.
    const QUALITY_OPPOSITES = {
      cold: ["warm", "heat", "hot"], heat: ["cold", "cool"], hot: ["cold", "cool"], warm: ["cold", "cool"],
      motion: ["rest", "still", "quiet"], rest: ["motion", "moving", "movement"],
      light: ["dark", "darkness"], dark: ["light", "bright"]
    };
    function tryOrder(orderedWords, polarityWord) {
      const oppositeWord = polarityWord === "worse" ? "better" : (polarityWord === "better" ? "worse" : null);
      let searchFrom = 0, firstPos = -1;
      for (const w of orderedWords) {
        const idx = findWholeWord(w, searchFrom);
        if (idx < 0) return -1;
        if (firstPos >= 0) {
          if (idx - searchFrom > MAX_GAP_CHARS) return -1;
          const gapText = text.slice(searchFrom, idx);
          if ((gapText + " ").includes(" clausebreak ")) return -1;
          if (oppositeWord && (gapText + " ").includes(" " + oppositeWord + " ")) return -1;
          const qualityOpposites = QUALITY_OPPOSITES[w] || [];
          if (qualityOpposites.some(qw => (gapText + " ").includes(" " + qw + " "))) return -1;
        }
        if (firstPos < 0) firstPos = idx;
        searchFrom = idx + w.length;
      }
      return firstPos;
    }
    const forwardResult = tryOrder(words, opposite ? words[0] : null);
    if (forwardResult >= 0) return isNegated(forwardResult) ? -1 : forwardResult;
    // REVERSED-ORDER FALLBACK: clinical shorthand writes "worse heat" (polarity word first),
    // but real narrative case descriptions very often say the opposite — "whenever a room
    // gets hot... the aching gets ten times worse" (cause stated BEFORE the aggravation
    // word). Without this, an entire textbook-perfect case could fire zero repertory rubrics
    // simply because the person wrote in plain sentences instead of clinical shorthand. Only
    // applied to exactly two-word worse/better triggers, where "reversed" is unambiguous.
    if (words.length === 2 && (words[0] === "worse" || words[0] === "better")) {
      const reversedResult = tryOrder([words[1], words[0]], words[0]);
      return reversedResult >= 0 && !isNegated(reversedResult) ? reversedResult : -1;
    }
    return -1;
  }
  REPERTORY.forEach(rubric => {
    // word-boundary match only — a raw substring fallback here would let a bare trigger
    // like "thirst" incorrectly match "thirstless" (opposite meaning) since it's a literal
    // substring of it. The input text t is always padded with leading/trailing spaces, so
    // the space-bounded check alone is sufficient for every trigger position.
    if (!matchLocation(rubric, inputLoc)) return;
    let bestPos = Infinity;
    rubric.triggers.forEach(trigger => {
      const idx = triggerFires(trigger, t);
      if (idx >= 0 && idx < bestPos) bestPos = idx;
    });
    if (bestPos === Infinity) return; // didn't fire
    firedRubrics.push(`${rubric.section}: ${rubric.rubric}`);
    const sw = RUBRIC_WEIGHT_OVERRIDE[rubric.rubric] ?? (SECTION_WEIGHT[rubric.section] || 1.0);
    const isGeneric = !rubric.location && (
      GENERIC_SECTIONS.has(rubric.section) || GENERIC_MODALITY_RUBRICS.has(rubric.rubric)
    );
    rubric.remedies.forEach(r => {
      const add = r.grade * sw * idfFactor(r.id);
      remedyScores[r.id] = (remedyScores[r.id] || 0) + add;
      if (isGeneric) remedyGenericScores[r.id] = (remedyGenericScores[r.id] || 0) + add;
      remedyRubrics[r.id] = remedyRubrics[r.id] || [];
      remedyRubrics[r.id].push(`${rubric.section}: ${rubric.rubric}`);
    });
    // Main complaint = whichever rubric's trigger appears EARLIEST in the text, full stop.
    // An earlier version gave Mind-section rubrics an unconditional override regardless of
    // position (to satisfy "mental symptoms dominate"), but that caused a real, repeated
    // problem: any case mentioning "irritable" ANYWHERE — even as a minor closing detail —
    // had its main-complaint boost hijacked toward Nux-v/Chamomilla/Cina, overriding a much
    // more specific and clearly-primary physical complaint (e.g. "acne with pus, worse touch,
    // better warmth" mentioned first, with irritability tacked on at the end). Genuine mental
    // generals still carry real weight via SECTION_WEIGHT.Mind and can still win the main-
    // complaint slot when they're actually mentioned early/centrally — they just no longer
    // override a case's real chief complaint purely by category.
    if (bestPos < earliestPos) {
      earliestPos = bestPos;
      mainComplaintRubric = rubric;
    }
  });

  // FALLBACK: a bare, undifferentiated "fever" mention with no qualifying detail (no chill,
  // thirst, onset speed, etc. — so none of the specific Fever rubrics above fired) still
  // deserves a clinically sensible answer rather than falling through to coincidental
  // materia medica word-overlap. Only applies when no specific Fever rubric already fired,
  // so it never dilutes a more specific fever presentation that's already well-matched.
  const hasSpecificFeverRubric = firedRubrics.some(f => f.startsWith("Fever:"));
  // NEGATION CHECK: "no fever" / "afebrile" / "without fever" explicitly DENIES fever, so the
  // undifferentiated-fever fallback must not fire just because the word "fever" appears
  // somewhere in the sentence — that was awarding fever-remedy credit to cases that
  // specifically said the patient does NOT have a fever.
  const feverNegated = / no fever | without fever | afebrile | not febrile /.test(t);
  if (!hasSpecificFeverRubric && !feverNegated && / fever /.test(t)) {
    const GENERAL_FEVER = [{ id: "acon", grade: 3 }, { id: "bell", grade: 3 }, { id: "gels", grade: 2 }, { id: "bry", grade: 2 }, { id: "ars-alb", grade: 2 }];
    const sw = SECTION_WEIGHT.Fever;
    firedRubrics.push("Fever: General/undifferentiated fever");
    GENERAL_FEVER.forEach(r => {
      const add = r.grade * sw * idfFactor(r.id);
      remedyScores[r.id] = (remedyScores[r.id] || 0) + add;
      remedyGenericScores[r.id] = (remedyGenericScores[r.id] || 0) + add;
      remedyRubrics[r.id] = remedyRubrics[r.id] || [];
      remedyRubrics[r.id].push("Fever: General/undifferentiated fever");
    });
  }

  // Same "only fire if nothing more specific already did" pattern for thirst — a bare
  // "thirsty" mention shouldn't ALSO stack on top of "thirst for cold water" firing
  // separately; that was double-counting one underlying symptom as if it were two
  // independent pieces of evidence, letting Bryonia/Phosphorus/Nat-mur win cases (like
  // ear pain, headache, anything) purely because thirst was mentioned as a minor accompanying
  // detail, drowning out the actual defining complaint.
  const hasSpecificThirstRubric = firedRubrics.some(f => f.startsWith("Thirst:"));
  if (!hasSpecificThirstRubric && / thirst(y)? /.test(t)) {
    const GENERAL_THIRST = [{ id: "bry", grade: 2 }, { id: "nat-mur", grade: 1 }, { id: "phos", grade: 1 }];
    const sw = SECTION_WEIGHT.Thirst;
    firedRubrics.push("Thirst: General/unspecified");
    GENERAL_THIRST.forEach(r => {
      const add = r.grade * sw * idfFactor(r.id);
      remedyScores[r.id] = (remedyScores[r.id] || 0) + add;
      remedyGenericScores[r.id] = (remedyGenericScores[r.id] || 0) + add;
      remedyRubrics[r.id] = remedyRubrics[r.id] || [];
      remedyRubrics[r.id].push("Thirst: General/unspecified");
    });
  }

  // Same fallback pattern for two other extremely common bare complaints that had zero
  // dedicated repertory coverage — a doctor typing just "headache" or "anxiety" alone with
  // no other detail was falling straight through to a weak coincidental materia-medica
  // match (or nothing at all, below the confidence floor), which felt like the app being
  // broken rather than appropriately cautious.
  const hasSpecificHeadacheRubric = firedRubrics.some(f => f.includes("headache") || f.includes("Headache"));
  if (!hasSpecificHeadacheRubric && / headache /.test(t)) {
    const GENERAL_HEADACHE = [{ id: "bell", grade: 3 }, { id: "bry", grade: 2 }, { id: "nux-v", grade: 2 }, { id: "gels", grade: 2 }];
    const sw = SECTION_WEIGHT.Common || 0.33;
    firedRubrics.push("Common: General/undifferentiated headache");
    GENERAL_HEADACHE.forEach(r => {
      remedyScores[r.id] = (remedyScores[r.id] || 0) + r.grade * sw * idfFactor(r.id);
      remedyRubrics[r.id] = remedyRubrics[r.id] || [];
      remedyRubrics[r.id].push("Common: General/undifferentiated headache");
    });
  }

  const hasSpecificAnxietyRubric = firedRubrics.some(f => f.includes("Anxiety") || f.includes("anxiety"));
  if (!hasSpecificAnxietyRubric && / anxiety /.test(t)) {
    const GENERAL_ANXIETY = [{ id: "ars-alb", grade: 3 }, { id: "acon", grade: 2 }, { id: "arg-n", grade: 2 }, { id: "gels", grade: 1 }];
    const sw = SECTION_WEIGHT.Mind;
    firedRubrics.push("Mind: General/unspecified anxiety");
    GENERAL_ANXIETY.forEach(r => {
      remedyScores[r.id] = (remedyScores[r.id] || 0) + r.grade * sw * idfFactor(r.id);
      remedyRubrics[r.id] = remedyRubrics[r.id] || [];
      remedyRubrics[r.id].push("Mind: General/unspecified anxiety");
    });
  }

  return { remedyScores, remedyGenericScores, remedyRubrics, firedRubrics, mainComplaintRubric };
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
  const { remedyScores: repScores, remedyGenericScores: repGenericScores, remedyRubrics, mainComplaintRubric } = scoreRepertory(inputText);
  // Whether the case's main-complaint rubric is itself one of the location-agnostic GENERIC
  // sections — if so, MAIN_COMPLAINT_BOOST below must not hand out its full flat bonus to a
  // remedy purely for matching that generic rubric (see GENERIC_ALONE_DISCOUNT above).
  const mainComplaintIsGeneric = !!mainComplaintRubric && !mainComplaintRubric.location && (
    GENERIC_SECTIONS.has(mainComplaintRubric.section) || GENERIC_MODALITY_RUBRICS.has(mainComplaintRubric.rubric)
  );
  // MAIN COMPLAINT BOOST: remedies graded in the detected main-complaint rubric get a large
  // score boost — strong enough that matching the case's central symptom reliably outranks a
  // remedy that only matches secondary/general symptoms (thirst, dryness) without touching the
  // main complaint at all. No separate "demotion" logic is needed — a remedy that lacks this
  // boost is automatically out-ranked by one that has it, which achieves the same effect.
  const MAIN_COMPLAINT_BOOST = 3.5;
  const mainComplaintRemedyIds = new Set((mainComplaintRubric ? mainComplaintRubric.remedies : []).map(r => r.id));
  const REP_WEIGHT = 1.4;      // multiplier per repertory grade point
  const MM_WEIGHT_CONFIRM = 0.35; // materia medica weight when repertory already fired for this
                                   // remedy — here it's genuinely just confirmation on top
  const MM_WEIGHT_PRIMARY = 1.1;  // materia medica weight when NO repertory rubric fired for
                                   // this remedy at all. The repertory only covers a handful
                                   // of categories (appetite, thirst, weight, stool, modality,
                                   // fever) — for everything else (headaches, burning
                                   // sensations, discharges, pains, etc.) materia medica IS
                                   // the only available evidence and must be able to stand on
                                   // its own with real confidence, not be dampened as if it
                                   // were merely supporting a repertory match that doesn't exist.

  const results = [];
  const TOP_N = 6; // only the strongest few materia-medica matches count toward confirmation
                    // & display — stops a remedy with dozens of keynotes that each weakly
                    // share a generic word (e.g. "right", "side", "pain" scattered across
                    // unrelated body systems) from out-accumulating a genuinely strong match.
  const inputAnatomy = anatomyWordsIn(inputWords);
  // See SIGNIFICANT_CONDITION_WORDS above — non-empty only when the case names a serious
  // diagnostic term, in which case every materia medica candidate below must also contain it.
  const inputConditionWords = inputWords.filter(w =>
    [...SIGNIFICANT_CONDITION_WORDS].some(cw => wordsMatch(w, cw)));
  DB.remedies.forEach(r => {
    const candidates = [];
    r.keynotes.forEach(k => {
      // split on ANY non-letter (matches how input text is tokenized) — splitting only
      // on whitespace was merging slash/hyphen-joined words like "tonsillitis/quinsy"
      // into one unmatchable glued token ("tonsillitisquinsy").
      const kWords = [...new Set(k.t.toLowerCase().split(/[^a-z]+/).filter(w => w && !STOPWORDS.has(w)))];
      // deduped: a word repeated within one keynote (e.g. "rolling side to side") must not
      // count twice toward the match ratio — that inflated short, coincidental keynotes to
      // beat genuinely more specific longer matches purely from word repetition.
      if (!kWords.length) return;
      // Hard reject on body-location mismatch — see anatomyConflict for why this exists.
      if (anatomyConflict(inputAnatomy, anatomyWordsIn(kWords))) return;
      // Hard reject on modality polarity mismatch — see modalityPolarityMatches for why.
      if (!modalityPolarityMatches(k.t, kWords, inputText)) return;
      // Hard reject on thirst contradiction — see thirstPolarityMatches for why.
      if (!thirstPolarityMatches(k.t, inputText)) return;
      const hitCount = countHits(kWords, inputWords);
      const ratio = hitCount / kWords.length;
      // Very short keynotes (2 words) need a FULL match, not just partial — a keynote like
      // "hay fever" matching on just the word "fever" alone is coincidental overlap with an
      // unrelated condition (allergic rhinitis, not an actual fever), and with only 2 words
      // there's no room for a partial match to still carry real specificity. Longer keynotes
      // (3+) can still contribute on a partial match — the top-N ranking below is what keeps
      // those appropriately weighted rather than dominating.
      const isShort = kWords.length <= 3;
      // A LONG keynote matching on ONLY a body-part word isn't real evidence (e.g. "paralysis
      // of tongue" matching Taraxacum purely because "tongue" appears in its unrelated
      // "mapped/geographic tongue coating" keynote — the actual complaint, "paralysis", was
      // never matched at all). A single matched NON-anatomy word is still allowed through, since
      // that's normally a genuine characteristic symptom/quality term (e.g. "irritable" alone
      // correctly carries Nux Vomica) — anatomy words are just the body part being discussed,
      // not distinguishing evidence on their own the way a symptom/quality word is.
      const matchedWords = kWords.filter(kw => inputWords.some(iw => wordsMatch(kw, iw)));
      const hasNonAnatomyHit = matchedWords.some(w => !ANATOMY_WORDS.has(w) && !WEAK_MODIFIER_WORDS.has(w));
      // MANDATORY CONDITION RULE — see SIGNIFICANT_CONDITION_WORDS: when the case names a
      // serious diagnostic term, this keynote must contain that same term to count at all,
      // no matter how strong its overlap is otherwise. Only constrains anything when
      // inputConditionWords is non-empty, so ordinary searches are untouched.
      const hasRequiredConditionMatch = !inputConditionWords.length ||
        matchedWords.some(mw => inputConditionWords.some(cw => wordsMatch(mw, cw)));
      if (((isShort && ratio >= 1.0) || (!isShort && ratio > 0 && hasNonAnatomyHit)) && hasRequiredConditionMatch) {
        // Location match = +5 (explicit score bonus, not just a pass/fail gate): a keynote
        // that names the SAME body part as the query gets extra weight on top of its normal
        // word-overlap strength, so a location-confirmed match outranks an equally-worded
        // match with no location relevance at all.
        const keynoteAnatomy = anatomyWordsIn(kWords);
        const bonusInputAnatomy = inputAnatomy.filter(a => LOCATION_BONUS_WORDS.has(a));
        const bonusKeynoteAnatomy = keynoteAnatomy.filter(a => LOCATION_BONUS_WORDS.has(a));
        const locationBonus = (bonusInputAnatomy.length && bonusKeynoteAnatomy.some(a => bonusInputAnatomy.includes(a))) ? LOCATION_SCORE_BONUS : 0;
        candidates.push({ t: k.t, strength: k.w * ratio + locationBonus });
      }
    });
    candidates.sort((a, b) => b.strength - a.strength);
    const top = candidates.slice(0, TOP_N);
    const mmScore = top.reduce((s, c) => s + c.strength, 0);
    const matched = top.map(c => c.t);

    const repScore = repScores[r.id] || 0;
    const mmWeight = repScore > 0 ? MM_WEIGHT_CONFIRM : MM_WEIGHT_PRIMARY;
    // GENERIC-ALONE DISCOUNT: a remedy whose ONLY evidence is location-agnostic (worse
    // heat/thirstless/etc., see GENERIC_SECTIONS) with nothing tying it to what the case is
    // actually about — no Mind/Common/Stool/Extremities rubric, no real materia medica keynote
    // hit — gets that generic portion heavily discounted rather than letting it carry the case.
    const genericRepScore = repGenericScores[r.id] || 0;
    const specificRepScore = repScore - genericRepScore;
    // MIN_REAL_MM_EVIDENCE: a materia medica match built from a single common/ambiguous word
    // (e.g. "right" meaning "eat right", not "right side") can slip past the anatomy-hit gate
    // with a tiny strength value — that's not real corroboration, just noise, and must not be
    // enough on its own to validate an otherwise-generic-only remedy. Real matches consistently
    // score well above this from today's testing; coincidental single-weak-word ones don't.
    const MIN_REAL_MM_EVIDENCE = 0.5;
    const hasSpecificEvidence = specificRepScore > 0.01 || mmScore >= MIN_REAL_MM_EVIDENCE;
    const effectiveRepScore = hasSpecificEvidence
      ? repScore
      : specificRepScore + genericRepScore * GENERIC_ALONE_DISCOUNT;
    let score = effectiveRepScore * REP_WEIGHT + mmScore * mmWeight;
    if (mainComplaintRemedyIds.has(r.id) && (!mainComplaintIsGeneric || hasSpecificEvidence)) score += MAIN_COMPLAINT_BOOST;

    // NAT-MUR GUARDRAIL: Natrum Muriaticum is graded across more rubrics than any other
    // remedy in this repertory, which structurally makes it easy to accumulate a winning
    // score from breadth rather than genuinely fitting the case. Explicit rule: it needs at
    // least 2 distinct fired rubrics behind it, UNLESS that one rubric is itself a strong,
    // specific (non-generic-section) match — e.g. "Silent grief, dwells on past hurts" firing
    // alone for an actual grief case IS the real diagnostic signal, not accumulated breadth,
    // and halving it was wrongly letting a weaker competitor (Ignatia, ungraded by this same
    // guardrail) outrank a textbook-correct single strong match.
    if (r.id === "nat-mur") {
      const natMurRubricCount = (remedyRubrics[r.id] || []).length;
      if (natMurRubricCount < 2 && specificRepScore < 1.0) score *= 0.5;
    }

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

  // CONFIDENCE DISPLAY REWORK: previously every remedy's percent was computed independently
  // on a fixed absolute scale (score/4*100, capped at 100) — meaning a strong match and a
  // moderately-supported competitor could both display 100%, with no visible signal of how
  // much more confident the top pick actually was. This runs strictly AFTER sorting, so it
  // only changes what confidence number is shown — never which remedy ranks #1 or their
  // relative order, since that's already fixed by rawScore at this point.
  if (results.length > 0) {
    const topRawScore = results[0].rawScore;
    results.forEach((r, i) => {
      if (i === 0) return; // top remedy keeps its own absolute-scale percent as-is
      const ratioToTop = topRawScore > 0 ? r.rawScore / topRawScore : 1;
      r.percent = Math.round(Math.min(r.percent, ratioToTop * results[0].percent));
    });
  }

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
      const kWords = [...new Set(k.t.toLowerCase().split(/[^a-z]+/).filter(w => w && !STOPWORDS.has(w)))];
      // deduped: a word repeated within one keynote (e.g. "rolling side to side") must not
      // count twice toward the match ratio — that inflated short, coincidental keynotes to
      // beat genuinely more specific longer matches purely from word repetition.
      if (!kWords.length) return;
      const hitCount = countHits(kWords, inputWords);
      const ratio = hitCount / kWords.length;
      const isShortB = kWords.length <= 2;
      if ((isShortB && ratio >= 1.0) || (!isShortB && ratio > 0)) score += k.w * ratio;
    });
    if (score > 0) results.push({ biochemic: b, score });
  });
  results.sort((a, b) => b.score - a.score);
  return results;
}

/* ---------- fallback Dual-Remedy Regimen / tests / diet when no curated disease protocol matched ---------- */
// NOTE: this table no longer carries a `tests` field per system category — that was the same
// kind of forced, non-specific guess as the old biochemic organ-system fallback (routinely
// suggesting "CBC and basic metabolic panel" etc. for literally any unmatched case). Suggested
// Tests now comes ONLY from a detected diseaseProtocol's own curated, clinically-indicated
// list (see diseaseProtocols[].tests) — an unmatched free-text case simply has no Tests line.
const SYSTEM_FALLBACK = {
  gut: {
    diet: { eat: ["Small frequent easily-digestible meals", "Warm fluids, soluble fiber"], avoid: ["Spicy fried food", "Carbonated drinks", "Irregular meal timing"] }
  },
  respiratory: {
    diet: { eat: ["Warm fluids, steam inhalation", "Vitamin C rich fruits"], avoid: ["Cold drinks", "Dust and smoke exposure"] }
  },
  nerves: {
    diet: { eat: ["Regular sleep schedule", "Magnesium-rich foods"], avoid: ["Excess caffeine", "Screen time before bed"] }
  },
  skin: {
    diet: { eat: ["Omega-3 rich foods", "Adequate hydration"], avoid: ["Known food allergens", "Harsh soaps"] }
  },
  joints: {
    diet: { eat: ["Anti-inflammatory foods - turmeric, ginger", "Adequate hydration"], avoid: ["Excess purine-rich food (red meat, organ meat)", "Prolonged inactivity"] }
  },
  liver: {
    diet: { eat: ["Light, low-fat meals", "Bitter greens"], avoid: ["Alcohol", "Fried and fatty food"] }
  },
  default: {
    diet: { eat: ["Balanced light diet", "Adequate hydration and rest"], avoid: ["Irregular meals", "Self-medication beyond a few days without review"] }
  }
};

function fallbackAdvice(topRemedy) {
  const sys = topRemedy ? (topRemedy.system || [])[0] : null;
  return SYSTEM_FALLBACK[sys] || SYSTEM_FALLBACK.default;
}


/* ---------- rendering ---------- */
function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; }

const CHRONICITY_WORDS = ["chronic", "recurrent", "recurring", "for years", "since childhood",
  "longstanding", "long standing", "repeated", "keeps coming back", "keeps returning",
  "for months", "since birth", "lifelong"];
// Matches natural duration phrasing like "two years ago", "a year ago", "several months ago" —
// this is just as strong a chronicity signal as the literal word list above, but doctors
// typing a narrative case describe duration this way far more often than saying "chronic".
const CHRONICITY_DURATION_PATTERN = /\b(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(years?|months?)\s+ago\b/i;
function isChronicContext(text) {
  const t = text.toLowerCase();
  return CHRONICITY_WORDS.some(w => t.includes(w)) || CHRONICITY_DURATION_PATTERN.test(t);
}

// A named disease/diagnosis mentioned as something the patient RECOVERED FROM in the past
// should not trigger that disease's acute-protocol remedy boost — "ever since I recovered
// from typhoid two years ago" is describing chronic sequelae, not active typhoid, and the
// acute protocol's remedies (e.g. Arsenicum for active typhoid) are the wrong signal here.
const POST_ILLNESS_PATTERN = /\b(recovered from|recovering from|after (that|a|an|my) (bad )?(bout|case|episode) of|used to have|had .{0,20}\byears? ago|since (i|my) (had|recovered))\b/i;

/* Materia medica note: a short, general descriptive snapshot of the remedy (its own top
   keynotes by weight) shown for every displayed remedy — independent of which specific
   words matched this query. This is "for confirmation" context, not the match evidence. */
function materiaMedicaNote(remedy) {
  const sorted = [...remedy.keynotes].sort((a, b) => b.w - a.w);
  return sorted.slice(0, 3).map(k => k.t).join("; ");
}

/* Short keynote: a single concise 1-2 line clinical summary for a remedy card. Prioritizes
   the repertory rubric(s) that matched (most clinically meaningful), then materia medica
   evidence, then falls back to the remedy's own top keynote. Deliberately terse — this is
   a clean clinical view, not a full evidence dump. */
function differentiatingQuestion(main, close) {
  if (!close) return null;
  // Find a symptom genuinely UNIQUE to the close remedy — not just its top overall match,
  // which is often something both remedies already share (that's exactly why they're
  // competing in the first place). Asking about a shared symptom doesn't actually
  // differentiate anything; asking about something only Close has does.
  const mainSignals = new Set([...(main.repertoryRubrics || []), ...(main.matched || [])]);
  const closeSignals = [...(close.repertoryRubrics || []), ...(close.matched || [])];
  const uniqueToClose = closeSignals.find(s => !mainSignals.has(s));
  const closeSymptom = uniqueToClose ? uniqueToClose.split(": ").slice(1).join(": ") || uniqueToClose : shortKeynote(close);
  return `To confirm <b>${esc(main.remedy.name)}</b> rather than <b>${esc(close.remedy.name)}</b>, ask: does the patient also have <i>${esc(closeSymptom)}</i>? If yes, ${esc(close.remedy.name)} may be the better fit.`;
}

function shortKeynote(r) {
  const rem = r.remedy;
  if (r.repertoryRubrics && r.repertoryRubrics.length) {
    return r.repertoryRubrics.slice(0, 2).map(x => x.split(": ").slice(1).join(": ") || x).join("; ");
  }
  if (r.matched && r.matched.length) {
    return r.matched.slice(0, 2).join("; ");
  }
  return materiaMedicaNote(rem).split("; ").slice(0, 2).join("; ");
}

function nowStamp() {
  const d = new Date();
  const date = d.toLocaleDateString(undefined, { day: "2-digit", month: "long", year: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return { date, time };
}

const VIAL_SVG = `<svg class="vial" viewBox="0 0 40 70" xmlns="http://www.w3.org/2000/svg">
  <rect x="8" y="14" width="24" height="50" rx="10" fill="rgba(255,255,255,0.28)" stroke="#fff" stroke-width="1.6"/>
  <rect x="13" y="4" width="14" height="12" rx="3" fill="#c99659" stroke="#8a6230" stroke-width="1"/>
  <circle cx="16" cy="40" r="2.4" fill="#fff"/>
  <circle cx="24" cy="46" r="2.4" fill="#fff"/>
  <circle cx="18" cy="53" r="2.4" fill="#fff"/>
  <circle cx="25" cy="35" r="2.4" fill="#fff"/>
  <circle cx="15" cy="58" r="2.4" fill="#fff"/>
  <circle cx="22" cy="58" r="2.4" fill="#fff"/>
</svg>`;

function confidenceGaugeSVG(pct) {
  const r = 50, circ = Math.PI * r;
  const offset = circ * (1 - pct / 100);
  const color = pct >= 70 ? "#2fa84f" : pct >= 40 ? "#e0a824" : "#e0342f";
  return `<svg viewBox="0 0 120 65" width="120" height="65">
    <path d="M10,60 A50,50 0 0,1 110,60" fill="none" stroke="#e6e4dd" stroke-width="9" stroke-linecap="round"/>
    <path d="M10,60 A50,50 0 0,1 110,60" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round"
      stroke-dasharray="${circ}" stroke-dashoffset="${offset}"/>
  </svg>`;
}

// Doctors don't want to weigh a raw percentage themselves — a star rating with a plain-
// English label reads faster and matches how a colleague would actually describe confidence
// ("strong match" vs "91%"). Reused by both Classical mode and Expert Protocol mode.
function confidenceRating(pct) {
  if (pct >= 85) return { stars: 5, label: "Excellent Match" };
  if (pct >= 65) return { stars: 4, label: "Strong Match" };
  if (pct >= 45) return { stars: 3, label: "Good Match" };
  if (pct >= 25) return { stars: 2, label: "Moderate Match" };
  return { stars: 1, label: "Low Match" };
}
function confidenceStarsHTML(pct) {
  const r = confidenceRating(pct);
  return `<span class="confidence-stars">${"★".repeat(r.stars)}${"☆".repeat(5 - r.stars)}</span> <span class="confidence-label">${r.label}</span>`;
}

const SYSTEM_CASE_LABEL = {
  gut: "Digestive Case", respiratory: "Respiratory Case", nerves: "Nervous System Case",
  skin: "Skin Case", joints: "Joint / Rheumatic Case", liver: "Liver Case",
  urinary: "Urinary Case", reproductive: "Reproductive Case", bones: "Bone Case",
  glands: "Glandular Case", immune: "Immune / Fever Case", circulation: "Circulatory Case",
  ent: "ENT Case", muscles: "Muscular Case", blood: "Blood Case"
};
// Section-based case label is preferred over the remedy's static system list — a remedy like
// Bryonia lists system:["respiratory","joints","liver","gut"], so picking system[0] blindly
// tagged a constipation case "Respiratory Case" just because "respiratory" happened to be
// listed first, regardless of which keynote actually matched for THIS case. The rubric
// section that actually fired is a far more accurate signal of what kind of case it is.
const REPERTORY_SECTION_CASE_LABEL = {
  Mind: "Mental / Emotional Case", Stool: "Digestive Case", Appetite: "Digestive Case",
  Fever: "Acute / Fever Case", Extremities: "Joint / Rheumatic Case",
  Weight: "Digestive Case", Thirst: "General Case"
};
function deriveCaseTag(mainResult) {
  const rubrics = mainResult.repertoryRubrics || [];
  for (const r of rubrics) {
    const section = r.split(":")[0];
    if (REPERTORY_SECTION_CASE_LABEL[section]) return REPERTORY_SECTION_CASE_LABEL[section];
    if (section === "Common") {
      const lower = r.toLowerCase();
      if (lower.includes("hair") || lower.includes("dandruff")) return "Hair / Skin Case";
      if (lower.includes("gum") || lower.includes("nose")) return "ENT Case";
    }
  }
  return SYSTEM_CASE_LABEL[(mainResult.remedy.system || [])[0]] || "General Case";
}

// Static, remedy-agnostic educational content — same block regardless of which remedy or case
// is shown, so it never needs case-specific data. idSuffix keeps the toggle IDs distinct
// between Classical (#results) and Expert Protocol (#protocolResults), which both exist in the
// DOM at once (only one is ever visible), to avoid duplicate-ID collisions.
function potencyGuideSection(idSuffix) {
  const id = "potency-guide-" + idSuffix;
  return `<div class="collapsible-section neutral">
    <button class="collapsible-toggle" onclick="toggleSection('${id}')">
      <span>💊 Suggested Potency Guide</span>
      <span class="ct-link"><span id="${id}-arrow">▶</span> View guide</span>
    </button>
    <div id="${id}" class="collapsible-content" style="display:none;">
      <div class="rc-field"><b>Acute Conditions</b><br>Usually 30C</div>
      <div class="rc-field"><b>Chronic Conditions</b><br>Usually 200C</div>
      <div class="rc-field" style="margin-top:6px;"><b>Dr. Ahmed's Clinical Preference:</b> Dr. Ahmed often begins treatment with a single dose of a high potency (CM or 10M) when clinically appropriate, followed by lower potencies such as 30C for continued management. However, potency selection always depends on the individual case and should be determined by the treating physician.</div>
      <div class="rc-field rc-related-disclosure" style="margin-top:6px;"><b>Disclaimer:</b> Potency selection depends on the patient's constitution, susceptibility, disease stage, previous treatment, and the physician's clinical judgment. These are general educational guidelines and not fixed prescribing rules.</div>
    </div>
  </div>`;
}

// RED FLAG SAFETY NET — plain-language warning-sign patterns. If free text (Classical mode) or
// the doctor's selected chief-symptom tags (Expert Protocol mode) match any of these, a
// prominent banner is shown BEFORE any remedy recommendation, urging prompt medical evaluation.
// This is a safety feature, not a diagnostic one: each category is checked as an "any word from
// this set appears somewhere in the text" match rather than a rigid exact phrase, deliberately
// erring toward catching more real red-flag language (a patient rarely describes symptoms in
// tidy clinical phrasing) rather than requiring an exact match and risking a missed warning.
const RED_FLAG_PATTERNS = [
  { label: "Blood in stool", any: [["blood", "stool"], ["bloody", "stool"]] },
  { label: "Black, tarry stool (melena)", any: [["black", "stool"], ["tarry", "stool"], ["melena"]] },
  { label: "Persistent vomiting", any: [["persistent", "vomiting"], ["vomiting", "days"], ["cannot", "keep", "down"], ["vomiting", "continuously"], ["vomiting", "nonstop"]] },
  { label: "Severe abdominal pain", any: [["severe", "abdominal", "pain"], ["excruciating", "abdominal"], ["unbearable", "stomach", "pain"], ["severe", "stomach", "pain"]] },
  { label: "Unexplained weight loss", any: [["unexplained", "weight", "loss"], ["losing", "weight", "without", "trying"], ["weight", "loss", "no", "reason"], ["rapid", "weight", "loss"]] },
  { label: "High fever lasting several days", any: [["fever", "several", "days"], ["fever", "3", "days"], ["fever", "three", "days"], ["persistent", "high", "fever"], ["fever", "week"], ["fever", "many", "days"]] },
  { label: "Persistent rectal bleeding", any: [["rectal", "bleeding"], ["bleeding", "rectum"], ["bleeding", "anus"]] },
  { label: "Severe dehydration", any: [["severe", "dehydration"], ["very", "dehydrated"], ["signs", "dehydration"]] },
  { label: "Difficulty breathing", any: [["difficulty", "breathing"], ["shortness", "breath"], ["cannot", "breathe"], ["breathless", "rest"], ["struggling", "breathe"], ["trouble", "breathing"]] },
  { label: "Chest pain", any: [["chest", "pain"], ["tightness", "chest"], ["pain", "chest"]] },
  { label: "Loss of consciousness", any: [["loss", "consciousness"], ["lost", "consciousness"], ["fainted"], ["passed", "out"], ["unconscious"], ["blacked", "out"]] },
  { label: "Progressive neurological weakness", any: [["progressive", "weakness"], ["worsening", "weakness"], ["spreading", "weakness"], ["progressive", "paralysis"], ["weakness", "getting", "worse"]] },
  { label: "Severe headache with neurological symptoms", any: [["worst", "headache"], ["severe", "headache", "weakness"], ["severe", "headache", "vision"], ["sudden", "severe", "headache"], ["thunderclap", "headache"], ["headache", "confusion"]] },
  { label: "Persistent blood in urine", any: [["blood", "urine"], ["bloody", "urine"], ["hematuria"]] },
  { label: "Recurrent fainting", any: [["recurrent", "fainting"], ["fainting", "repeatedly"], ["fainted", "multiple"], ["keeps", "fainting"], ["fainting", "episodes"]] },
  { label: "New lump suspicious for malignancy", any: [["new", "lump"], ["growing", "lump"], ["suspicious", "lump"], ["lump", "growing"], ["hard", "lump"]] }
];
function detectRedFlags(text) {
  if (!text) return [];
  const t = " " + text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ") + " ";
  const hits = [];
  RED_FLAG_PATTERNS.forEach(rf => {
    if (rf.any.some(words => words.every(w => t.includes(" " + w + " ")))) hits.push(rf.label);
  });
  return hits;
}
function renderRedFlagBanner(hits) {
  if (!hits.length) return "";
  return `<div class="red-flag-banner">
    <div class="red-flag-title">🚨 Red Flag – Medical Evaluation Recommended</div>
    <div class="red-flag-detected">Detected: ${hits.map(h => esc(h)).join(", ")}</div>
    <div class="red-flag-text">Some of the selected symptoms may indicate a potentially serious medical condition. Prompt evaluation by a qualified physician or emergency medical service is recommended. Homeopathic treatment should not delay appropriate medical assessment.</div>
  </div>`;
}

// MISSING KEY SYMPTOMS — for the top-matched remedy, surface a few of its own highest-weight
// classic keynotes that were NOT substantially present in the case text/selected symptoms.
// This isn't a scoring signal (never affects which remedy wins) — it's a case-taking prompt: a
// doctor can glance at what else this remedy classically covers and ask the patient about it,
// which is exactly how a repertory is meant to be used to VERIFY a match, not just produce one.
function getMissingKeynotes(remedy, caseText) {
  if (!remedy || !remedy.keynotes || !remedy.keynotes.length || !caseText) return [];
  const rawWords = caseText.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const inputWords = [...new Set(rawWords.map(fuzzyCorrect))];
  return remedy.keynotes
    .map(k => {
      const kWords = [...new Set(k.t.toLowerCase().split(/[^a-z]+/).filter(w => w && !STOPWORDS.has(w)))];
      if (!kWords.length) return null;
      const ratio = countHits(kWords, inputWords) / kWords.length;
      return { text: k.t, w: k.w, ratio };
    })
    .filter(Boolean)
    .filter(k => k.ratio < 0.34) // largely unconfirmed by the case so far — a little incidental
                                  // word overlap is still fine to surface as "worth checking"
    .sort((a, b) => b.w - a.w)
    .slice(0, 3)
    .map(k => k.text);
}
function renderMissingKeynotes(remedy, caseText, idSuffix) {
  const missing = getMissingKeynotes(remedy, caseText);
  if (!missing.length) return "";
  const id = "missing-keynotes-" + idSuffix;
  return `<div class="collapsible-section neutral">
    <button class="collapsible-toggle" onclick="toggleSection('${id}')">
      <span>🔎 Other classic symptoms of ${esc(remedy.name)} to check for</span>
      <span class="ct-link"><span id="${id}-arrow">▶</span> View</span>
    </button>
    <div id="${id}" class="collapsible-content" style="display:none;">
      <ul class="alt-reasons">${missing.map(t => `<li>${esc(t)}</li>`).join("")}</ul>
    </div>
  </div>`;
}

// CLINICAL PEARL — one classical clinical-picture paragraph for the top-matched remedy, when
// one is on file (see remedies.json remedy.clinicalPearl — currently authored for the ~45 most
// commonly-matched remedies, not all 193; grows the same incremental way the repertory did).
// Shown directly, not collapsed — unlike "why this remedy" or "missing symptoms," this is core
// clinical content a doctor wants to see immediately, not something to dig for.
function renderClinicalPearl(remedy) {
  if (!remedy || !remedy.clinicalPearl) return "";
  return `<div class="clinical-pearl">
    <div class="clinical-pearl-title">💎 Clinical Pearl — ${esc(remedy.name)}</div>
    <div class="clinical-pearl-text">${esc(remedy.clinicalPearl)}</div>
  </div>`;
}

// MIASMATIC / DISEASE-SPECIFIC NOSODE SYSTEM — replaces the old single "pick one nosode"
// mechanism entirely. Two independent tracks, per the redesign: (1) Miasmatic Analysis +
// Miasmatic Nosode, driven by the detected disease's own classical miasm tagging (see
// diseaseProtocols[].miasm in remedies.json); (2) Disease-Specific Nosodes, driven by that
// same disease's diseaseNosodes[] — genuinely sparse, most diseases have none. Nosodes never
// compete to become the MAIN recommended remedy anymore (see the unconditional nosode filter
// in runSearch below) — they only ever appear in these dedicated support sections.
const MIASM_NOSODE_MAP = { "Psora": "psor", "Sycosis": "med", "Tubercular": "tub", "Syphilis": "syph", "Cancerinic": "carcin" };
const MIASM_DEPTH = { "Psora": 1, "Sycosis": 2, "Tubercular": 3, "Syphilis": 4, "Cancerinic": 5 };

function renderMiasmaticAnalysis(miasm) {
  if (!miasm) return "";
  return `<div class="miasm-section">
    <div class="miasm-title">🧬 Miasmatic Analysis</div>
    <div class="miasm-row"><b>Primary Miasm:</b> ${esc(miasm.primary)}</div>
    ${miasm.secondary ? `<div class="miasm-row"><b>Secondary Miasm:</b> ${esc(miasm.secondary)}</div>` : ""}
    <div class="miasm-explanation">${esc(miasm.explanation)}</div>
  </div>`;
}

// Only recommend the constitutional miasmatic nosode when there's genuine depth behind it — a
// disease-derived miasm that is NOT a plain Psora default, or one with a secondary miasm
// present (a mixed picture is itself a sign of deeper chronic pathology). A bare Psora
// assignment with no secondary does not warrant reaching for Psorinum on its own; per spec,
// nosodes must never become routine.
function renderMiasmaticNosodes(miasm) {
  if (!miasm) return "";
  const warrants = miasm.primary !== "Psora" || !!miasm.secondary;
  if (!warrants) return "";
  const target = (miasm.secondary && MIASM_DEPTH[miasm.secondary] > MIASM_DEPTH[miasm.primary]) ? miasm.secondary : miasm.primary;
  const remedyId = MIASM_NOSODE_MAP[target];
  const remedy = remedyId && DB.remedies.find(r => r.id === remedyId);
  if (!remedy) return "";
  return `<div class="miasm-section">
    <div class="miasm-title">🧬 Miasmatic Nosode</div>
    <div class="miasm-row"><b>${esc(remedy.name)}</b> ${esc((remedy.potency.chronic || "1M").split(",")[0])}</div>
    <div class="miasm-explanation">Constitutional nosode matching the ${esc(target)} miasm identified above — best given as a single dose under experienced supervision, supporting rather than replacing the indicated remedy.</div>
  </div>`;
}

function renderDiseaseSpecificNosodes(diseaseNosodes) {
  if (!diseaseNosodes || !diseaseNosodes.length) return "";
  const items = diseaseNosodes.map(n => {
    const remedy = DB.remedies.find(r => r.id === n.id);
    if (!remedy) return "";
    return `<div class="miasm-row"><b>${esc(remedy.name)}</b> ${esc((remedy.potency.chronic || "1M").split(",")[0])}</div><div class="miasm-explanation">${esc(n.reason)}</div>`;
  }).filter(Boolean).join("");
  if (!items) return "";
  return `<div class="miasm-section">
    <div class="miasm-title">🧬 Disease-Specific Nosodes</div>
    ${items}
  </div>`;
}

window.toggleSection = function(id) {
  const el = document.getElementById(id);
  const arrow = document.getElementById(id + "-arrow");
  if (!el) return;
  const isHidden = el.style.display === "none" || !el.style.display;
  el.style.display = isHidden ? "block" : "none";
  if (arrow) arrow.textContent = isHidden ? "▼" : "▶";
};

function runSearch() {
  const text = inputEl.value.trim();
  if (!DB) { resultsEl.innerHTML = `<div class="msg">Database still loading — try again in a moment.</div>`; return; }
  if (!text) { resultsEl.innerHTML = `<div class="msg">Enter a symptom description or disease name first.</div>`; return; }

  ensureMaxScores();
  const diseaseProtocol = detectDiseaseProtocol(text);
  let remedyResults = scoreRemedies(text, diseaseProtocol);
  const biochemicResults = scoreBiochemics(text);
  // Separate, read-only call purely to surface which recognized patterns fired for the
  // "what I understood from your case" display below — kept fully isolated from the actual
  // scoring pipeline above so this can never affect which remedy wins or its score.
  const { firedRubrics: recognizedPatterns } = scoreRepertory(text);

  // Nosodes never compete to become the MAIN/alternative recommended remedy — per the redesign,
  // they only ever appear as support in the dedicated Miasmatic/Disease-Specific Nosode
  // sections below, never replacing the indicated constitutional remedy.
  remedyResults = remedyResults.filter(r => !r.remedy.nosode);
  const chronic = isChronicContext(text);

  if (!remedyResults.length && !diseaseProtocol) {
    resultsEl.innerHTML = `<div class="msg">No confident match found. Try adding a modality (worse/better from what), the mind state, or the single most peculiar symptom — these score highest.</div>`;
    return;
  }

  const main = remedyResults[0];
  const close = remedyResults[1];

  if (!main) {
    resultsEl.innerHTML = `<div class="msg">No strong classical match from symptoms alone. Try adding more specific detail.</div>`;
    return;
  }

  // FAIL-SAFE: below a genuine confidence floor, refuse to guess rather than force out a
  // Main/Close pair built on coincidental word overlap. A named disease protocol is its own
  // legitimate signal (the person told us the diagnosis directly), so it's exempted — but
  // pure free-text symptom matching below this floor is treated as inconclusive.
  const CONFIDENCE_FLOOR = 25;
  if (!diseaseProtocol && main.percent < CONFIDENCE_FLOOR) {
    resultsEl.innerHTML = `<div class="msg"><b>No confident remedy match — more detail needed.</b> The symptoms given aren't specific enough to select a remedy with confidence, so this system won't guess. Please add: the <b>mental/emotional state</b> (e.g. weepy, irritable, anxious, indifferent), a clear <b>modality</b> (what makes it better or worse — motion, heat, cold, time of day), or the single most <b>peculiar or unusual</b> symptom — these carry the most diagnostic weight in classical prescribing and will let the system give a confident answer.</div>`;
    return;
  }

  const stamp = nowStamp();
  const stampEl = document.getElementById("hbTime");
  if (stampEl) stampEl.textContent = stamp.date.split(" ").slice(0,2).join(" ") + ", " + stamp.time;

  let html = "";
  html += renderRedFlagBanner(detectRedFlags(text));

  /* ---------- 0. WHAT I UNDERSTOOD — detective-style: show the recognized clues first,
     before the conclusion. Uses the actual patterns recognized in the TEXT itself (rubric
     names), not the winning remedy's own textbook picture — so this reflects what the
     person said, not what the app already believes about the remedy. ---------- */
  if (recognizedPatterns && recognizedPatterns.length) {
    const readable = [...new Set(recognizedPatterns)]
      .map(r => r.includes(": ") ? r.split(": ").slice(1).join(": ") : r)
      .slice(0, 8);
    html += `<div class="understood-box">
      <div class="understood-title">🔍 What I understood from your case</div>
      <ul class="understood-list">${readable.map(r => `<li>${esc(r)}</li>`).join("")}</ul>
    </div>`;
  }

  /* ---------- 1. MAIN DECISION — always visible, big, centered, no distractions ---------- */
  html += `<div class="main-decision-card" data-confidence="${main.percent}">
    <div class="md-eyebrow">🎯 Recommended Remedy</div>
    <div class="md-remedy-name display">${esc(main.remedy.name)}</div>
    <div class="md-checks">
      <div>✔ Best match for your symptoms</div>
      <div>✔ Start with this remedy first</div>
    </div>
    <button class="md-cta">Start with this remedy</button>
  </div>`;
  html += renderClinicalPearl(main.remedy);

  /* ---------- 2. ALTERNATIVE — collapsed by default ---------- */
  if (close) {
    html += `<div class="collapsible-section neutral">
      <button class="collapsible-toggle" onclick="toggleSection('alt-section')">
        <span>🔄 Not satisfied with result?</span>
        <span class="ct-link"><span id="alt-section-arrow">▶</span> View alternative option</span>
      </button>
      <div id="alt-section" class="collapsible-content" style="display:none;">
        <div class="alt-remedy-name display">${esc(close.remedy.name)}</div>
        <ul class="alt-reasons">
          <li>${esc(shortKeynote(close))}</li>
          <li>Consider this if the main remedy doesn't fit after a few doses</li>
        </ul>
        <button class="md-cta neutral-cta">View alternative option</button>
      </div>
    </div>`;
  }
  html += renderMissingKeynotes(main.remedy, text, "classical");

  // A curated Banerji-style dual-remedy combination card used to render here whenever
  // detectDiseaseProtocol() matched a named condition. That's now Expert Protocol mode's job
  // (its disease-name shortcuts surface the exact same curated combination, more prominently)
  // — showing it here too duplicated the same content across both modes and blurred the split
  // between "Full Repertory: pure rubric/materia-medica analysis" and "Expert Protocol: curated
  // named-condition protocols." diseaseProtocol itself is still detected and still feeds the
  // nosode suggestion below and the remedy-scoring boost elsewhere — only this card's rendering
  // was removed.

  /* ---------- 3.5 MIASMATIC / DISEASE-SPECIFIC NOSODES ---------- */
  // Miasmatic Analysis is shown whenever a detected disease carries classical miasm tagging
  // (see diseaseProtocols[].miasm) — informational, always safe to show. The Miasmatic Nosode
  // and Disease-Specific Nosode sections below it are separately gated (see the functions
  // themselves) so neither ever becomes a routine, forced recommendation.
  if (diseaseProtocol && diseaseProtocol.miasm) {
    html += renderMiasmaticAnalysis(diseaseProtocol.miasm);
    html += renderMiasmaticNosodes(diseaseProtocol.miasm);
    html += renderDiseaseSpecificNosodes(diseaseProtocol.diseaseNosodes);
  }
  html += potencyGuideSection("classical");

  /* ---------- 4. SUPPORT — kept small, not highlighted ---------- */
  // Biochemic support is shown only when there's a genuine signal: the curated, disease-
  // specific salt(s) if a named condition was detected (highest confidence, carries a one-
  // sentence classical justification), otherwise the real keyword-matched result from the
  // case text itself (scoreBiochemics). The organ-system fallback guess (fallbackBiochemicFor)
  // is no longer used to pad this out to a fixed count — an unmatched case simply omits the
  // Biochemic line rather than showing an unjustified generic pick.
  let biochemicPair = [];
  if (diseaseProtocol && diseaseProtocol.biochemicSalts && diseaseProtocol.biochemicSalts.length) {
    biochemicPair = diseaseProtocol.biochemicSalts.map(s => {
      const b = DB.biochemics.find(bc => bc.id === s.id);
      return Object.assign({}, b, { justification: s.justification });
    });
  } else if (biochemicResults.length) {
    biochemicPair = biochemicResults.slice(0, 2).map(b => Object.assign({}, b.biochemic, { justification: null }));
  }
  const advice = diseaseProtocol ? { diet: diseaseProtocol.diet } : fallbackAdvice(main.remedy);

  const biochemicLine = biochemicPair.length
    ? `<div class="support-line"><b>Biochemic:</b> ${biochemicPair.map(b => esc(b.abbr) + (b.justification ? ` — ${esc(b.justification)}` : "")).join("; ")}</div>`
    : "";
  // Suggested Tests is shown ONLY when the detected disease protocol carries genuinely
  // indicated investigations (red flags, chronic-disease monitoring, diagnostic uncertainty —
  // see diseaseProtocols[].tests). There is no generic organ-system fallback here: an
  // uncomplicated case (no disease detected, or a disease with no clinically-indicated tests)
  // simply has no Tests line at all, rather than a routine "Clinical evaluation" placeholder.
  const tests = (diseaseProtocol && diseaseProtocol.tests) || [];
  const testsLine = tests.length
    ? `<div class="support-line"><b>Suggested Tests:</b> ${tests.map(t => `${esc(t.name)} — ${esc(t.reason)}`).join("; ")}</div>`
    : "";
  html += `<div class="support-section-small">
    <div class="support-title">Supportive Care</div>
    ${biochemicLine}
    <div class="support-line"><b>Diet:</b> Avoid ${esc((advice.diet.avoid || [])[0] || "trigger foods")}</div>
    ${testsLine}
  </div>`;

  /* ---------- 5. ANALYSIS — bottom, collapsed, builds trust but stays secondary ---------- */
  const symptomBullets = [main, close].filter(Boolean).map(r => shortKeynote(r)).join("; ").split(/;\s*/).filter(Boolean).slice(0, 4);
  html += `<div class="collapsible-section neutral">
    <button class="collapsible-toggle" onclick="toggleSection('why-section')">
      <span>📊 Why this remedy?</span>
      <span class="ct-link"><span id="why-section-arrow">▶</span> View analysis</span>
    </button>
    <div id="why-section" class="collapsible-content" style="display:none;">
      <ul class="alt-reasons">${symptomBullets.map(b => `<li>${esc(b)}</li>`).join("")}</ul>
      <div class="support-line" style="margin-top:8px;">Match confidence: ${confidenceGaugeSVG(main.percent)} ${confidenceStarsHTML(main.percent)}</div>
    </div>
  </div>`;

  const cautionNeeded = (main.remedy.category === "constitutional" || main.remedy.nosode) ||
                         (close && (close.remedy.category === "constitutional" || close.remedy.nosode));
  if (cautionNeeded) {
    html += `<div class="caution">⚠️ A deep-acting constitutional or nosode remedy is suggested here. Repetition and potency changes are best guided by a full case-taking and professional supervision.</div>`;
  }

  resultsEl.innerHTML = html;
}

resultBtn.addEventListener("click", runSearch);
inputEl.addEventListener("keydown", (e) => {
  // Plain Enter submits the search — feels natural for a search box even though this is
  // now a multi-line textarea. Shift+Enter still inserts a real line break, for anyone
  // typing a longer, multi-paragraph case description who wants to organize it visually.
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    runSearch();
  }
});

// Urdu/Hindi support: this app's symptom matching only understands English. Rather than
// build and maintain a second and third language inside the matching engine itself (tried
// this, walked it back — too easy for a half-translated rubric to quietly hand back the
// wrong remedy), detect Urdu (Arabic script) or Hindi (Devanagari script) as the person
// types, and translate it right in the box using Google's free, undocumented translation
// endpoint (the same one their own web page and browser extension call internally).
// IMPORTANT: this is NOT the official, paid Google Cloud Translation API — it's an
// unofficial endpoint with no guarantee of staying available. If Google ever blocks or
// rate-limits it, translation will stop working until this is swapped for the official
// API (which needs a Google Cloud account and key) or reverted to the new-tab approach.
async function translateToEnglish(text) {
  const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=" + encodeURIComponent(text);
  const res = await fetch(url);
  if (!res.ok) throw new Error("Translation request failed (" + res.status + ")");
  const data = await res.json();
  // Response shape: [[["translated part","original part",...], ...], null, "detected_lang", ...]
  // Concatenate every translated segment to get the full sentence.
  return data[0].map(segment => segment[0]).join("");
}

const translateHint = document.getElementById("translateHint");
const translateBtn = document.getElementById("translateBtn");
inputEl.addEventListener("input", () => {
  const isUrduOrHindi = /[\u0600-\u06FF\u0750-\u077F\u0900-\u097F]/.test(inputEl.value);
  if (translateHint) translateHint.style.display = isUrduOrHindi ? "block" : "none";
});
if (translateBtn) {
  translateBtn.addEventListener("click", async () => {
    const originalText = inputEl.value;
    translateBtn.disabled = true;
    translateBtn.textContent = "Translating…";
    try {
      const englishText = await translateToEnglish(originalText);
      inputEl.value = englishText;
      if (translateHint) translateHint.style.display = "none";
    } catch (err) {
      // Fallback: if the free endpoint is ever blocked or fails, don't leave the person
      // stuck — open the same Google Translate page approach used before as a backup.
      const fallbackUrl = "https://translate.google.com/?sl=auto&tl=en&text=" + encodeURIComponent(originalText) + "&op=translate";
      window.open(fallbackUrl, "_blank");
    } finally {
      translateBtn.disabled = false;
      translateBtn.textContent = "Translate to English";
    }
  });
}

document.querySelectorAll(".sample-chip").forEach(chip => {
  chip.addEventListener("click", () => { inputEl.value = chip.dataset.sample; runSearch(); });
});
