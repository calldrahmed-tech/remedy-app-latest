// hering-analysis.js — "Clinical Direction" follow-up analysis based on
// Hering's Law of Cure. Compares a patient's saved visits and flags whether
// the case pattern looks more like inside-to-outside (classically read as
// cure) or outside-to-inside (classically read as possible suppression).
//
// This is a PATTERN OBSERVATION meant to prompt the doctor's own clinical
// review, not a diagnosis — the report language stays hedged on purpose, the
// same way the rest of the app treats itself as an aid, not a replacement
// for full case-taking (see the disclaimer in index.html).
//
// Needs zero AI/API calls: it reuses the same repertory-matching engine
// (scoreRepertory's firedRubrics) already used for live symptom search,
// applied retroactively to each saved visit's text. Depends on script.js
// being loaded first (REPERTORY, scoreRepertory), and — for visits saved
// from Expert Protocol mode — on protocol-mode.js's chip snapshot being
// attached to the visit by patient-records.js.

(function () {
  // Maps each repertory section to a depth level for Hering's Law: 1 = deepest/
  // most vital, 4 = most external/superficial. Modalities and Causation aren't
  // body locations (they qualify OTHER symptoms), so they're left out of the
  // hierarchy entirely rather than guessed at.
  //
  // The repertory doesn't always split as finely as the classical organ table
  // does (e.g. "Urinary" covers both kidney and bladder complaints, but almost
  // everything actually recorded under it is bladder-type symptoms, so it's
  // placed at tract-level/3, not organ-level/2). Placements below are a
  // best-effort mapping, not settled doctrine — worth a doctor's sanity check
  // on a borderline case before trusting the direction it reports.
  const HERING_LEVEL = {
    Mind: 1, Generalities: 1, Weakness: 1, Vertigo: 1, Sleep: 1,
    Respiratory: 2, Chest: 2, Fever: 2, Glands: 2, Weight: 2,
    Stomach: 3, Abdomen: 3, Stool: 3, Appetite: 3, Thirst: 3, Female: 3, Male: 3, Urinary: 3,
    Skin: 4, Perspiration: 4, Extremities: 4, Back: 4, Head: 4, Face: 4, Eye: 4, Ear: 4, Nose: 4, Throat: 4, Mouth: 4
  };
  const LEVEL_NAME = {
    1: "mind / constitutional level",
    2: "internal organ level (chest, fever, glands, weight)",
    3: "digestive / urinary / reproductive level",
    4: "skin / joints / surface level"
  };
  const INTENSITY_WEIGHT = { "+": 1, "++": 2, "+++": 3, "++++": 4 };

  // Prefers the exact chip data saved from Expert Protocol mode (tag already
  // carries its real section, no ambiguity). Falls back to re-running the
  // repertory matcher on free-text symptoms (Expert Repertory mode visits, or
  // older visits saved before this feature existed) — flagged as "derived"
  // since free-text matching is inherently less certain than a picked chip.
  // Every entry gets a stable `key` used for matching "is this the same
  // symptom" across visits — the chip's own id when we have one (exact
  // identity, immune to any rewording of its display text), or the
  // "Section: rubric" string for free-text-derived entries (that string IS
  // the rubric's own identity in the repertory, so it's equally stable).
  // `label` is always the FULL text for display — chip tags carry a
  // UI-truncated label ("…") on their own `tag.label` meant only for the
  // small chip button, so the snapshot substitutes `tag.rubric` for that.
  function getVisitLevelEntries(visit) {
    const entries = [];
    if (visit && visit.tags && visit.tags.length) {
      visit.tags.forEach((t) => {
        const level = HERING_LEVEL[t.section];
        if (level) entries.push({ key: t.id || `${t.section}: ${t.label}`, label: t.label, section: t.section, level, weight: INTENSITY_WEIGHT[t.intensity] || 1 });
      });
      return { entries, derived: false };
    }
    if (visit && visit.symptoms && typeof scoreRepertory === "function" && typeof REPERTORY !== "undefined" && REPERTORY) {
      const { firedRubrics } = scoreRepertory(visit.symptoms, null);
      (firedRubrics || []).forEach((rubricKey) => {
        const idx = rubricKey.indexOf(": ");
        const section = idx > -1 ? rubricKey.slice(0, idx) : "";
        const label = idx > -1 ? rubricKey.slice(idx + 2) : rubricKey;
        const level = HERING_LEVEL[section];
        if (level) entries.push({ key: rubricKey, label, section, level, weight: 1 });
      });
      return { entries, derived: true };
    }
    return { entries: [], derived: true };
  }

  // Takes the FULL visits array (not just the latest two) so a symptom that
  // resolved a couple of visits ago and reappears now can still be flagged as
  // a "return of an old symptom" — classically a positive sign during cure.
  function analyzeFollowUp(rawVisits) {
    const visits = (rawVisits || [])
      .filter((v) => v && v.date)
      .slice()
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    if (visits.length < 2) return null;

    const profiles = visits.map((v) => Object.assign({ visit: v }, getVisitLevelEntries(v)));
    const latest = profiles[profiles.length - 1];
    const previous = profiles[profiles.length - 2];

    if (!latest.entries.length || !previous.entries.length) {
      return {
        direction: "unclear",
        headline: "Not enough structured symptom detail in the last two visits to judge direction. Use Expert Protocol mode (symptom chips) at follow-up for a reliable read.",
        reliable: false,
        returningSymptoms: [],
        latestDate: latest.visit.date,
        prevDate: previous.visit.date
      };
    }

    const prevMinLevel = Math.min(...previous.entries.map((e) => e.level));
    const latestMinLevel = Math.min(...latest.entries.map((e) => e.level));

    const latestKeys = new Set(latest.entries.map((e) => e.key));
    const previousKeys = new Set(previous.entries.map((e) => e.key));
    const returningSymptoms = [];
    for (let i = 0; i < profiles.length - 2; i++) {
      profiles[i].entries.forEach((e) => {
        if (latestKeys.has(e.key) && !previousKeys.has(e.key)) {
          returningSymptoms.push({ key: e.key, label: e.label, firstSeen: profiles[i].visit.date });
        }
      });
    }
    const seen = new Set();
    const dedupedReturning = returningSymptoms.filter((r) => {
      if (seen.has(r.key)) return false;
      seen.add(r.key);
      return true;
    });

    let direction = "unclear";
    let headline;
    if (latestMinLevel > prevMinLevel) {
      direction = "cure";
      headline = `The deepest symptom level present has moved from ${LEVEL_NAME[prevMinLevel]} toward ${LEVEL_NAME[latestMinLevel]} — a pattern consistent with Hering's Law (inside → outside).`;
    } else if (latestMinLevel < prevMinLevel) {
      direction = "suppression";
      headline = `A ${LEVEL_NAME[latestMinLevel]} symptom is now present that wasn't the deepest issue at the last visit (which was at ${LEVEL_NAME[prevMinLevel]}) — worth reviewing for possible suppression (outside → inside).`;
    } else {
      headline = `Symptom depth is unchanged since the last visit (both at ${LEVEL_NAME[latestMinLevel]}).`;
    }

    if (dedupedReturning.length) {
      headline += ` Also noted: ${dedupedReturning.map((r) => r.label).join(", ")} reappeared — the return of an earlier symptom is classically read as a good sign during cure, especially if it resolves faster or milder than before.`;
    }

    const reliable = !latest.derived && !previous.derived;
    return { direction, headline, reliable, returningSymptoms: dedupedReturning, latestDate: latest.visit.date, prevDate: previous.visit.date };
  }

  function sumWeight(entries) {
    return entries.reduce((s, e) => s + (e.weight || 1), 0);
  }

  // ---------- Second Visit Decision Engine ----------
  // Compares exactly two saved visits (previous → latest) and returns ONE of
  // four next-step actions, plus a one-line reason. This is the actionable
  // "what do I do now" output — analyzeFollowUp above is the softer
  // whole-history trend view; this is the sharp single-decision tool.
  //
  // Requires BOTH visits to carry structured `tags` (Expert Protocol mode's
  // chip snapshot: [{label, section, intensity}]) to give a real answer —
  // there's no honest way to compute "50% improved" from two blobs of free
  // text without guessing, so a visit saved from Expert Repertory mode (no
  // chips) correctly returns UNCLEAR rather than a fabricated percentage.
  function getSecondVisitAction(visit1Data, visit2Data) {
    const v1 = getVisitLevelEntries(visit1Data);
    const v2 = getVisitLevelEntries(visit2Data);
    if (v1.derived || v2.derived || !v1.entries.length) {
      return {
        action: "UNCLEAR",
        actionLabel: "ACTION: NOT ENOUGH DATA",
        reasoning: "Both visits need to be saved from Expert Protocol mode (symptom chips with intensity) to compare reliably — free-text visits don't carry a severity rating to compare against.",
        improvementPercent: null,
        reliable: false
      };
    }

    const v1Tags = v1.entries, v2Tags = v2.entries;
    const v1ByKey = new Map(v1Tags.map((t) => [t.key, t]));
    const v2ByKey = new Map(v2Tags.map((t) => [t.key, t]));

    // Mind-level check first — this overrides every other signal. A patient
    // who is mentally worse (even with better physical symptoms) is the
    // single clearest suppression warning in classical teaching, so it wins
    // regardless of how good the physical trend looks.
    const v1MindWeight = sumWeight(v1Tags.filter((t) => t.section === "Mind"));
    const v2MindWeight = sumWeight(v2Tags.filter((t) => t.section === "Mind"));
    if (v2MindWeight > v1MindWeight) {
      return {
        action: "ANTIDOTE_REEVALUATE",
        actionLabel: "ACTION: ANTIDOTE / RE-EVALUATE",
        reasoning: "Mental/emotional symptoms are worse or newly present at this visit, even if physical complaints look better. Classically a suppression sign — re-take the case rather than continuing the current remedy.",
        improvementPercent: null,
        reliable: true
      };
    }

    // Physical (non-Mind) improvement, weighted by each symptom's own
    // intensity rating rather than a raw head-count — a "+" symptom clearing
    // matters less than a "++++" one clearing.
    const v1Physical = v1Tags.filter((t) => t.section !== "Mind");
    let totalWeight = 0, improvedWeight = 0;
    v1Physical.forEach((t) => {
      totalWeight += t.weight;
      const stillThere = v2ByKey.get(t.key);
      const remaining = stillThere ? stillThere.weight : 0;
      improvedWeight += Math.max(0, t.weight - remaining);
    });
    const improvementPercent = totalWeight ? Math.round((improvedWeight / totalWeight) * 100) : null;

    const oldSymptomsGone = v1Physical.length > 0 && v1Physical.every((t) => !v2ByKey.has(t.key));
    const newSymptoms = v2Tags.filter((t) => !v1ByKey.has(t.key));

    if (oldSymptomsGone && newSymptoms.length) {
      const avgOldLevel = v1Physical.reduce((s, t) => s + t.level, 0) / v1Physical.length;
      const avgNewLevel = newSymptoms.reduce((s, t) => s + t.level, 0) / newSymptoms.length;
      const namesNew = newSymptoms.map((t) => t.label).join(", ");
      if (avgNewLevel > avgOldLevel) {
        return {
          action: "WAIT",
          actionLabel: "ACTION: WAIT (Placebo)",
          reasoning: `The original complaint has cleared, and the new symptom(s) (${namesNew}) sit at a more external/superficial level than what resolved — a classic healing-crisis pattern, not a new disease. Observe on placebo, no need to repeat or change yet.`,
          improvementPercent: 100,
          reliable: true
        };
      }
      return {
        action: "CHANGE_REMEDY",
        actionLabel: "ACTION: CHANGE REMEDY",
        reasoning: `The original complaint has cleared, but an unrelated new set of symptoms (${namesNew}) has appeared that is NOT a more external/outward shift from it. This looks like a genuinely new picture rather than a healing crisis — re-take the case.`,
        improvementPercent: 100,
        reliable: true
      };
    }

    if (improvementPercent !== null && improvementPercent >= 50) {
      return {
        action: "WAIT",
        actionLabel: "ACTION: WAIT (Placebo)",
        reasoning: `Symptoms are about ${improvementPercent}% improved since the last visit. Continue observing on placebo — no need to repeat or change yet.`,
        improvementPercent,
        reliable: true
      };
    }

    if (improvementPercent !== null) {
      return {
        action: "REPEAT_HIGHER_POTENCY",
        actionLabel: "ACTION: REPEAT / HIGHER POTENCY",
        reasoning: `Symptoms are largely unchanged since the last visit (about ${improvementPercent}% improved) — the same picture still fits, but progress has stalled. Consider repeating the dose or moving to a higher potency.`,
        improvementPercent,
        reliable: true
      };
    }

    return {
      action: "UNCLEAR",
      actionLabel: "ACTION: NOT ENOUGH DATA",
      reasoning: "No overlapping symptom data between these two visits to compare.",
      improvementPercent: null,
      reliable: false
    };
  }

  // ---------- Quick Follow-up: one free-text sentence, zero saved records ----------
  // "Fever gone but cough started" needs no lookup at all — the whole story
  // (what resolved, what's new) is in the sentence itself. This never calls
  // the paid AI Cloud Function: it reuses scoreRepertory (the same free,
  // already-loaded engine that powers every search) purely to figure out
  // which body system each clause is about, plus a small set of plain-English
  // direction words (gone/started/worse/same) to know which way it moved.
  //
  // This is a coarser read than the chip-based getSecondVisitAction — it
  // can't measure "how much" better, only "better or not" — so treat it as
  // the fast, zero-effort option, with Save Visit's chip comparison as the
  // more precise option for a doctor who wants exact numbers.
  const RESOLVED_WORDS = /\b(gone|resolved|cleared|disappeared|stop+ed|settled down|much better|completely better|no more|all better)\b/i;
  const IMPROVED_WORDS = /\b(better|improving|improved|reducing|reduced|less|subsiding|subsided|good|fine|well|great|okay|ok|normal)\b/i;
  const STALLED_WORDS = /\b(same|still|no change|unchanged|not improving|no better|persist|continue)\b/i;
  const WORSE_WORDS = /\b(worse|worsened|worsening|increased|increasing)\b/i;
  const NEW_WORDS = /\b(started|start|starting|appeared|appearing|new|now has|developed|developing|came on|showed up|onset|began|begun)\b/i;
  const MIND_NEGATIVE_WORDS = /\b(anxious|anxiety|depressed|depression|worried|worry|restless|tearful|weepy|irritable|panicky|panic|hopeless|withdrawn|nervous|scared|fearful)\b/i;
  const NEGATION_PREFIX = /\b(no|not|never|without|isn't|wasn't|hasn't|hadn't|doesn't|didn't|don't)\b/i;

  // Common everyday follow-up words that don't always match a curated
  // repertory rubric on their own (e.g. bare "cough" — the repertory has
  // specific cough RUBRICS like "dry sawing-wood cough" but no generic
  // fallback the way Fever/Thirst/Headache/Anxiety do) — this is a small,
  // deliberately non-exhaustive backstop just for finding which body system
  // a plain word belongs to, not for matching remedies.
  const SYMPTOM_SECTION_KEYWORDS = [
    ["fever", "Fever"], ["temperature", "Fever"], ["chill", "Fever"],
    ["cough", "Respiratory"], ["wheeze", "Respiratory"], ["breathless", "Respiratory"], ["breathing", "Respiratory"], ["asthma", "Respiratory"], ["phlegm", "Respiratory"], ["mucus", "Respiratory"], ["bronchitis", "Respiratory"],
    ["nose", "Nose"], ["nasal", "Nose"], ["sneez", "Nose"], ["cold", "Nose"], ["congestion", "Nose"],
    ["throat", "Throat"], ["tonsil", "Throat"], ["hoarse", "Throat"],
    ["ear", "Ear"],
    ["eye", "Eye"], ["vision", "Eye"],
    ["headache", "Head"], ["migraine", "Head"],
    ["tooth", "Mouth"], ["teeth", "Mouth"], ["gum", "Mouth"], ["tongue", "Mouth"], ["mouth", "Mouth"],
    ["nausea", "Stomach"], ["vomit", "Stomach"], ["indigestion", "Stomach"], ["stomach", "Stomach"], ["gastric", "Stomach"], ["acidity", "Stomach"], ["heartburn", "Stomach"],
    ["abdomen", "Abdomen"], ["abdominal", "Abdomen"], ["belly", "Abdomen"], ["bloat", "Abdomen"], ["cramp", "Abdomen"],
    ["diarrhea", "Stool"], ["diarrhoea", "Stool"], ["constipat", "Stool"], ["stool", "Stool"], ["bowel", "Stool"],
    ["urine", "Urinary"], ["urinat", "Urinary"], ["bladder", "Urinary"], ["kidney", "Urinary"],
    ["period", "Female"], ["menses", "Female"], ["menstrual", "Female"], ["pregnan", "Female"],
    ["prostate", "Male"],
    ["rash", "Skin"], ["itch", "Skin"], ["eczema", "Skin"], ["boil", "Skin"], ["acne", "Skin"], ["skin", "Skin"], ["hives", "Skin"], ["hair", "Skin"], ["grey", "Skin"], ["gray", "Skin"],
    ["joint", "Extremities"], ["knee", "Extremities"], ["elbow", "Extremities"], ["wrist", "Extremities"], ["ankle", "Extremities"], ["hip", "Extremities"], ["arm", "Extremities"], ["leg", "Extremities"], ["limb", "Extremities"], ["muscle", "Extremities"],
    ["back", "Back"], ["spine", "Back"],
    ["sleep", "Sleep"], ["insomnia", "Sleep"], ["nightmare", "Sleep"],
    ["anxious", "Mind"], ["anxiety", "Mind"], ["depress", "Mind"], ["mood", "Mind"], ["irritab", "Mind"], ["fear", "Mind"], ["stress", "Mind"], ["worr", "Mind"], ["sad", "Mind"], ["cry", "Mind"], ["panic", "Mind"],
    ["weak", "Weakness"], ["tired", "Weakness"], ["fatigue", "Weakness"], ["exhaust", "Weakness"],
    ["sweat", "Perspiration"], ["perspir", "Perspiration"],
    ["chest", "Chest"], ["palpitat", "Chest"], ["heart", "Chest"],
    ["weight", "Weight"],
    ["thirst", "Thirst"],
    ["appetite", "Appetite"], ["hunger", "Appetite"]
  ];

  function keywordSection(clauseLower) {
    for (const [kw, section] of SYMPTOM_SECTION_KEYWORDS) {
      if (clauseLower.includes(kw)) return section;
    }
    return null;
  }

  // "And" splits into separate clauses too, same as "but" — without this, a
  // sentence like "skin eruption is not improving and also burning started"
  // stays as ONE clause, and the negation check below (scanning back from
  // "started") would wrongly find the earlier "not" that was only meant to
  // negate "improving" and use it to cancel out "started" as well.
  function splitFollowUpClauses(text) {
    return text
      .replace(/\b(but|however|although|yet|and)\b/gi, "|")
      .split(/[|,;.]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // A negation word right before the matched direction word flips or voids
  // its meaning ("no NEW symptoms" is the opposite of "new symptoms") — safest
  // response is to drop that clause from evidence entirely rather than guess
  // at the negated meaning. STALLED_WORDS already spells out its own negated
  // phrases as literal compounds ("not improving", "no better"), so it's
  // exempt from this check — those matches ARE the negation, not a false one.
  //
  // Only looks a short distance back (not the whole clause) — a negation word
  // from an earlier, unrelated part of a long clause shouldn't reach forward
  // and cancel a direction word it was never actually next to.
  const NEGATION_WINDOW_CHARS = 20;
  function negatedMatch(clause, match) {
    if (!match) return false;
    const before = clause.slice(Math.max(0, match.index - NEGATION_WINDOW_CHARS), match.index);
    return NEGATION_PREFIX.test(before);
  }

  function classifyClauseDirection(clause) {
    // A negated RESOLVED/IMPROVED ("hasn't gone", "not better") means the
    // original complaint is still there — that's genuinely STALLED evidence,
    // not nothing. A negated NEW/WORSE ("no new symptoms") just means there's
    // nothing to report either way — safest to drop that as neutral.
    const resolved = RESOLVED_WORDS.exec(clause);
    if (resolved) return negatedMatch(clause, resolved) ? "STALLED" : "RESOLVED";
    const fresh = NEW_WORDS.exec(clause);
    if (fresh) return negatedMatch(clause, fresh) ? null : "NEW";
    const worse = WORSE_WORDS.exec(clause);
    if (worse) return negatedMatch(clause, worse) ? null : "WORSE";
    if (STALLED_WORDS.test(clause)) return "STALLED";
    const improved = IMPROVED_WORDS.exec(clause);
    if (improved) return negatedMatch(clause, improved) ? "STALLED" : "IMPROVED";
    return null;
  }

  // A mind-negative word only counts as "present" if it isn't itself being
  // negated ("no anxiety now" must NOT be read as anxiety being worse).
  function mindWordPresent(clause) {
    const match = MIND_NEGATIVE_WORDS.exec(clause);
    if (!match) return false;
    const before = clause.slice(Math.max(0, match.index - NEGATION_WINDOW_CHARS), match.index);
    return !NEGATION_PREFIX.test(before);
  }

  function analyzeQuickFollowUp(text) {
    const raw = (text || "").trim();
    if (!raw) {
      return { action: "UNCLEAR", reasoning: "Type what changed since the last visit — e.g. \"fever gone but cough started\".", reliable: false };
    }
    const canRepertory = typeof scoreRepertory === "function" && typeof REPERTORY !== "undefined" && REPERTORY;
    const classified = splitFollowUpClauses(raw).map((clause) => {
      const direction = classifyClauseDirection(clause);
      let section = null;
      if (canRepertory) {
        const { firedRubrics } = scoreRepertory(clause, null);
        if (firedRubrics && firedRubrics.length) {
          const idx = firedRubrics[0].indexOf(": ");
          section = idx > -1 ? firedRubrics[0].slice(0, idx) : null;
        }
      }
      if (!section) section = keywordSection(clause.toLowerCase());
      const level = section ? HERING_LEVEL[section] : null;
      return { clause, direction, section, level, mindWorse: mindWordPresent(clause) };
    });

    // Mental state check FIRST — overrides everything else, same priority
    // rule as the chip-based engine: a patient who's mentally worse is the
    // clearest suppression warning, even if their body sounds better.
    const mentalWorse = classified.some((c) => c.mindWorse && c.direction !== "RESOLVED" && c.direction !== "IMPROVED");
    if (mentalWorse) {
      return {
        action: "ANTIDOTE_REEVALUATE",
        reasoning: "Sounds like a mental/emotional symptom is present or worse, even if the physical complaint is better. Classically a suppression sign — re-take the case.",
        reliable: true
      };
    }

    const resolved = classified.filter((c) => c.direction === "RESOLVED" || c.direction === "IMPROVED");
    const newOrWorse = classified.filter((c) => c.direction === "NEW" || c.direction === "WORSE");
    const stalled = classified.filter((c) => c.direction === "STALLED");

    if (resolved.length && newOrWorse.length) {
      const oldLevels = resolved.filter((c) => c.level).map((c) => c.level);
      const newLevels = newOrWorse.filter((c) => c.level).map((c) => c.level);
      if (oldLevels.length && newLevels.length) {
        const avgOld = oldLevels.reduce((a, b) => a + b, 0) / oldLevels.length;
        const avgNew = newLevels.reduce((a, b) => a + b, 0) / newLevels.length;
        if (avgNew > avgOld) {
          return {
            action: "WAIT",
            reasoning: `"${resolved.map((c) => c.clause).join(", ")}" cleared, and "${newOrWorse.map((c) => c.clause).join(", ")}" sits at a more external level — could be a healing crisis, not a new problem. Observe.`,
            reliable: true
          };
        }
      }
      return {
        action: "CHANGE_REMEDY",
        reasoning: `"${resolved.map((c) => c.clause).join(", ")}" cleared, but "${newOrWorse.map((c) => c.clause).join(", ")}" is a different, unrelated complaint — re-take the case.`,
        reliable: true
      };
    }

    // Checked before the pure-"resolved only" case below on purpose: if the
    // sentence ALSO says something hasn't changed ("fever hasn't gone but
    // appetite is better"), that stalled part about the original complaint
    // is the more clinically important half — don't let a secondary
    // improvement alone read as "all clear."
    if (stalled.length && !newOrWorse.length) {
      return { action: "REPEAT_HIGHER_POTENCY", reasoning: "Sounds like the main complaint hasn't changed yet. Consider repeating the dose or a higher potency.", reliable: true };
    }

    if (resolved.length && !newOrWorse.length) {
      return { action: "WAIT", reasoning: "Sounds like things are improving with nothing new. Continue observing.", reliable: true };
    }

    if (newOrWorse.length && !resolved.length) {
      return { action: "REPEAT_HIGHER_POTENCY", reasoning: "The original complaint doesn't sound resolved and may be worse — consider repeating the dose, or re-take the case if this continues.", reliable: true };
    }

    return {
      action: "UNCLEAR",
      reasoning: "Couldn't clearly tell what changed from that description. Try phrasing it like \"fever gone but cough started\" or \"joint pain much better, no new symptoms\".",
      reliable: false
    };
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  // Traffic-light view: exactly 3 colors (green/yellow/red) plus a neutral
  // gray for "not enough data yet" — gray isn't a 4th traffic light, it's the
  // honest alternative to forcing a real "can't tell" case into a color that
  // would claim more certainty than the app has.
  //
  // CHANGE_REMEDY and ANTIDOTE_REEVALUATE share one Red message by design —
  // both are "stop, re-take the case" moments, and the app owner wants ONE
  // simple instruction rather than two similar-but-different ones. The real
  // distinction (mentally worse vs. an unrelated new complaint) is still in
  // the Details section below for a doctor who wants the specific reason.
  const ACTION_DISPLAY = {
    WAIT: { css: "hering-green", icon: "✅", big: "HEALING IS ON TRACK. DO NOT CHANGE REMEDY." },
    REPEAT_HIGHER_POTENCY: { css: "hering-yellow", icon: "⏳", big: "PROGRESS HAS STALLED. REPEAT THE DOSE." },
    ANTIDOTE_REEVALUATE: { css: "hering-red", icon: "⚠️", big: "WARNING: NEW SYMPTOMS. RE-TAKE THE CASE." },
    CHANGE_REMEDY: { css: "hering-red", icon: "⚠️", big: "WARNING: NEW SYMPTOMS. RE-TAKE THE CASE." },
    UNCLEAR: { css: "hering-gray", icon: "❔", big: "NOT ENOUGH INFO YET." }
  };

  function renderFollowUpActionCard(result) {
    if (!result) return "";
    const d = ACTION_DISPLAY[result.action] || ACTION_DISPLAY.UNCLEAR;
    return `
      <div class="hering-traffic-card ${d.css}">
        <div class="hering-traffic-icon">${d.icon}</div>
        <div class="hering-traffic-headline">${esc(d.big)}</div>
        <details class="hering-traffic-details">
          <summary>Details</summary>
          <div class="hering-traffic-reasoning">${esc(result.reasoning)}</div>
          <div class="hering-direction-disclaimer">Decision support only, not a diagnosis — please correlate with full case assessment.</div>
        </details>
      </div>
    `;
  }

  window.HeringAnalysis = { getSecondVisitAction, analyzeFollowUp, analyzeQuickFollowUp, getVisitLevelEntries, renderFollowUpActionCard, HERING_LEVEL };
})();
