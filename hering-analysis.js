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

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  const ACTION_ICON = { WAIT: "\u{1F7E2}", REPEAT_HIGHER_POTENCY: "\u{1F7E1}", CHANGE_REMEDY: "\u{1F535}", ANTIDOTE_REEVALUATE: "\u{1F7E0}", UNCLEAR: "⚪" };
  const ACTION_CSS = { WAIT: "hering-cure", REPEAT_HIGHER_POTENCY: "hering-stalled", CHANGE_REMEDY: "hering-change", ANTIDOTE_REEVALUATE: "hering-suppression", UNCLEAR: "hering-unclear" };

  function renderFollowUpActionCard(result) {
    if (!result) return "";
    return `
      <div class="hering-direction-card ${ACTION_CSS[result.action] || "hering-unclear"}">
        <div class="hering-direction-label">${ACTION_ICON[result.action] || "⚪"} ${esc(result.actionLabel)}</div>
        <div class="hering-direction-text">${esc(result.reasoning)}</div>
        ${!result.reliable ? `<div class="hering-direction-note">Save both visits from Expert Protocol mode (symptom chips) for a reliable read.</div>` : ""}
        <div class="hering-direction-disclaimer">Decision support only, not a diagnosis — please correlate with full case assessment.</div>
      </div>
    `;
  }

  window.HeringAnalysis = { getSecondVisitAction, analyzeFollowUp, getVisitLevelEntries, renderFollowUpActionCard, HERING_LEVEL };
})();
