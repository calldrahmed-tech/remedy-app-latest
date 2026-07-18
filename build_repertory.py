#!/usr/bin/env python3
"""
build_repertory.py

Builds repertory.json — the graded rubric -> remedy mapping that drives Smart Remedy AI's
symptom matching. Each rubric has a set of trigger phrases (how a case might describe that
symptom) and a list of remedies graded 1-3 (3 = most strongly indicated).

This script owns only the SCAFFOLDING: validation, CLI, and file I/O. The actual clinical
content (which remedies are graded for which symptoms) lives in the REPERTORY list below and
is the product of iterative, case-by-case verification against real test cases — it is not
auto-generated, and shouldn't be edited without similarly verifying the change against the
existing regression suite (test_harness.js and friends).

USAGE:
    python3 build_repertory.py
        Builds repertory.json in the current directory.

    python3 build_repertory.py --remedies remedies.json
        Also validates that every remedy id referenced in REPERTORY actually exists in
        remedies.json, failing loudly (nonzero exit code) if any are missing. This catches
        the single most common mistake when adding a new rubric: a typo'd or nonexistent
        remedy id, which previously required a separate manual check after every edit.

    python3 build_repertory.py --output custom_path.json
        Writes to a different output path instead of the default repertory.json.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import TypedDict


class RemedyGrade(TypedDict):
    """A single remedy's grade within a rubric. grade is 1-3 (3 = most characteristic)."""
    id: str
    grade: int


class Rubric(TypedDict, total=False):
    """A single repertory rubric: a symptom, how it's phrased, and who treats it."""
    section: str
    rubric: str
    triggers: list[str]
    remedies: list[RemedyGrade]
    location: dict[str, str | None]  # optional; only body-part-specific rubrics set this


def rem(remedy_id: str, grade: int) -> RemedyGrade:
    """Build a single remedy-grade entry for a rubric's remedy list.

    Args:
        remedy_id: the remedy's id as it appears in remedies.json (e.g. "bry", "nat-mur").
        grade: 1-3, where 3 is the most strongly/characteristically indicated.

    Raises:
        ValueError: if grade is outside the valid 1-3 range.
    """
    if not 1 <= grade <= 3:
        raise ValueError(f"grade must be 1-3, got {grade} for remedy_id={remedy_id!r}")
    return {"id": remedy_id, "grade": grade}


REPERTORY: list[Rubric] = [
    # ===================== COMMON COMPLAINTS =====================
    {"section": "Common", "rubric": "Hair loss, hair falling",
     "triggers": ["hair fall", "hair falling", "falling hair", "hair loss", "losing hair"],
     "remedies": [rem("nat-mur", 3), rem("fl-ac", 3), rem("kali-sulph-rem", 2), rem("sep", 2),
                  rem("phos", 2), rem("sulph", 2), rem("calc-c", 2), rem("sil", 2), rem("graph", 2),
                  rem("kali-c", 1), rem("tell", 2), rem("lyc", 1), rem("ars-alb", 2), rem("nux-v", 1), rem("puls", 2)]},

    {"section": "Common", "rubric": "Dandruff, scalp scaling",
     "triggers": ["dandruff", "scalp scaling", "flaky scalp", "flakes on scalp", "white flakes", "scalp flaking"],
     "remedies": [rem("kali-sulph-rem", 3), rem("nat-mur", 2), rem("graph", 2), rem("sulph", 1)]},

    {"section": "Common", "rubric": "Bleeding gums",
     "triggers": ["bleeding gums", "gums bleeding", "blood from gums", "gums bleed"],
     "remedies": [rem("merc-sol", 3), rem("phos", 2), rem("kreos", 2)]},

    {"section": "Common", "rubric": "Nosebleed, epistaxis",
     "triggers": ["nosebleed", "nose bleeding", "bleeding nose", "blood from nose", "epistaxis"],
     "remedies": [rem("phos", 3), rem("acon", 2), rem("arn", 2)]},

    # ===================== SLEEP =====================
    {"section": "Common", "rubric": "Restless sleep, grinding teeth, talks or starts during sleep",
     "triggers": ["restless sleep", "grinds teeth during sleep", "talks in sleep", "starts during sleep", "wakes up screaming"],
     "remedies": [rem("cina", 3), rem("bell", 2), rem("sulph", 1)]},

    {"section": "Common", "rubric": "Insomnia from worry, overwork, or mental strain",
     "triggers": ["cannot sleep from worry", "insomnia from overwork", "sleeplessness from thoughts", "mind too active to sleep"],
     "remedies": [rem("nux-v", 2), rem("ars-alb", 2), rem("acon", 1)]},

    # ===================== RESPIRATORY =====================
    {"section": "Common", "rubric": "Dry, spasmodic cough, worse at night",
     "triggers": ["dry cough worse night", "spasmodic cough", "barking cough", "dry cough at night"],
     "remedies": [rem("dros", 3), rem("bry", 2), rem("spong", 2)]},

    {"section": "Common", "rubric": "Loose, rattling cough with difficulty expectorating",
     "triggers": ["rattling cough", "loose cough", "cannot expectorate", "chest full of mucus"],
     "remedies": [rem("ant-t", 3), rem("puls", 1)]},

    {"section": "Common", "rubric": "Nausea and vomiting with clean tongue",
     "triggers": ["constant nausea", "nausea not relieved by vomiting", "clean tongue with nausea"],
     "remedies": [rem("ip", 3), rem("nux-v", 1)]},

    # ===================== DIGESTIVE / ABDOMEN =====================
    {"section": "Stool", "rubric": "Colic better bending double or with pressure",
     "triggers": ["colic better bending double", "colic relieved by pressure", "doubling up with pain"],
     "remedies": [rem("coloc", 3), rem("mag-p", 2)]},

    {"section": "Stool", "rubric": "Burning pains in stomach or abdomen, relieved by heat",
     "triggers": ["burning pain relieved by heat", "burning stomach better warmth", "burning abdominal pain"],
     "remedies": [rem("ars-alb", 3), rem("canth", 1)]},

    # ===================== SKIN =====================
    {"section": "Common", "rubric": "Itching, worse from warmth or scratching",
     "triggers": ["itching worse warmth", "itching worse scratching", "itching relieved by cold"],
     "remedies": [rem("sulph", 3), rem("ars-alb", 1)]},

    {"section": "Common", "rubric": "Burning skin eruptions, better from cold applications",
     "triggers": ["burning eruptions better cold", "skin burns better cold application"],
     "remedies": [rem("ars-alb", 2), rem("canth", 3)]},

    {"section": "Common", "rubric": "Boils, abscesses, or suppuration, very sensitive to touch",
     "triggers": ["boils sensitive to touch", "abscess extremely painful", "suppuration with sensitivity"],
     "remedies": [rem("hep", 3), rem("sil", 2)]},

    # ===================== FEMALE HEALTH =====================
    {"section": "Common", "rubric": "Menses too early and profuse",
     "triggers": ["menses too early", "profuse menses", "early and heavy periods"],
     "remedies": [rem("calc-c", 2), rem("nux-v", 1)]},

    {"section": "Common", "rubric": "Menses too late, scanty, or suppressed",
     "triggers": ["menses too late", "scanty menses", "suppressed menses", "delayed periods"],
     "remedies": [rem("puls", 3), rem("sep", 2)]},

    # ===================== GENERAL MODALITIES =====================
    {"section": "Modalities", "rubric": "Worse before a thunderstorm or change of weather",
     "triggers": ["worse before storm", "worse before thunderstorm", "worse change of weather"],
     "remedies": [rem("rhod", 3), rem("phos", 2)]},

    {"section": "Modalities", "rubric": "Symptoms alternate sides, or one-sided complaints",
     "triggers": ["alternating sides", "one sided complaint", "symptoms shift sides"],
     "remedies": [rem("lac-c", 3), rem("lyc", 1)]},

    {"section": "Mind", "rubric": "Effects of suppressed emotion or humiliation",
     "triggers": ["suppressed emotion", "effects of humiliation", "silent indignation"],
     "remedies": [rem("staph", 3), rem("ign", 1)]},

    # ===================== EXTREMITIES (location-aware) =====================
    # "location" is optional and opt-in — only rubrics that specify it get filtered by
    # matchLocation() in script.js; every other rubric above is unaffected. This directly
    # closes the "right leg pain -> Chelidonium (shoulder/liver remedy)" bug: without a
    # location tag, generic words like "right" + "pain" could match a rubric about a
    # completely different body part.
    {"section": "Extremities", "rubric": "Leg pain, weakness, dragging sensation",
     "triggers": ["leg pain", "weakness", "dragging", "pain", "heaviness"],
     "location": {"main": "leg", "side": None},
     "remedies": [rem("rhus-t", 3), rem("ruta", 2), rem("plb", 2)]},

    # ===================== MIND / MENTAL GENERALS =====================
    {"section": "Mind", "rubric": "Silent grief, dwells on past hurts, cannot cry",
     "triggers": ["silent grief", "dwelling on past", "cannot cry", "silent sorrow", "brooding over grief", "worse from consolation", "consolation worse", "worse consolation"],
     "remedies": [rem("nat-mur", 3), rem("ign", 2)]},

    {"section": "Mind", "rubric": "Weeps easily, wants sympathy and consolation",
     "triggers": ["weeps easily", "wants sympathy", "desires consolation", "cries easily", "weepy", "better from consolation", "consolation better", "better consolation"],
     "remedies": [rem("puls", 3), rem("ign", 1)]},

    {"section": "Mind", "rubric": "Anxiety with restlessness, fear of death",
     "triggers": ["fear of death", "anxious restlessness", "great anguish", "anxiety with fear"],
     "remedies": [rem("ars-alb", 3), rem("acon", 2)]},

    {"section": "Mind", "rubric": "Anticipatory anxiety before an event",
     "triggers": ["anticipatory anxiety", "exam anxiety", "stage fright", "anxious before event", "performance anxiety"],
     "remedies": [rem("arg-n", 3), rem("gels", 2)]},

    {"section": "Mind", "rubric": "Irritability, easily angered, impatient",
     "triggers": ["irritable", "easily angered", "impatient", "irritability", "quick to anger"],
     "remedies": [rem("nux-v", 3), rem("cham", 2), rem("cina", 2)]},

    {"section": "Mind", "rubric": "Suppressed anger or indignation from insult",
     "triggers": ["suppressed anger", "indignation", "silent anger", "humiliation", "insult"],
     "remedies": [rem("staph", 3), rem("coloc", 2)]},

    {"section": "Mind", "rubric": "Indifference to loved ones or surroundings",
     "triggers": ["indifference to loved ones", "indifferent to family", "apathy toward family", "emotional indifference"],
     "remedies": [rem("sep", 3), rem("nat-mur", 1)]},

    {"section": "Mind", "rubric": "Jealousy, suspicion, talkative",
     "triggers": ["jealousy", "suspicious", "very talkative", "loquacious", "jumps from subject to subject"],
     "remedies": [rem("lach", 3), rem("hyos", 2)]},

    {"section": "Mind", "rubric": "Lack of confidence, fear of failure",
     "triggers": ["lack of confidence", "lacks confidence", "fear of failure", "low self esteem", "self doubt"],
     "remedies": [rem("lyc", 3), rem("arg-n", 2), rem("sil", 2)]},

    {"section": "Mind", "rubric": "Memory weakness, forgetfulness, confusion of mind",
     "triggers": ["forgetful", "forgetfulness", "confusion of mind", "difficult thinking", "poor memory",
                  "bad memory", "weak memory", "memory loss", "absent minded", "cannot remember",
                  "cant remember", "forgets easily", "memory weakness"],
     "remedies": [rem("anac", 3), rem("bar-c", 2), rem("nat-mur", 2), rem("zinc", 1)]},

    # ===================== APPETITE =====================
    {"section": "Appetite", "rubric": "Ravenous, increased hunger",
     "triggers": ["ravenous", "increased appetite", "excessive hunger", "very hungry", "always hungry"],
     "remedies": [rem("iod", 3), rem("calc-c", 2), rem("lyc", 2), rem("sulph", 2), rem("ferr", 1)]},

    {"section": "Appetite", "rubric": "Decreased appetite, anorexia",
     "triggers": ["no appetite", "decreased appetite", "loss of appetite", "anorexia", "does not want to eat", "poor appetite"],
     "remedies": [rem("ars-alb", 2), rem("puls", 2), rem("ign", 1), rem("nux-v", 1), rem("chin", 1)]},

    {"section": "Appetite", "rubric": "Must eat frequently / hunger soon after eating / faint if meal delayed",
     "triggers": ["must eat frequently", "hungry soon after eating", "faint if meal delayed", "hungry between meals", "weak if does not eat"],
     "remedies": [rem("sulph", 3), rem("nat-c", 2), rem("phos", 2)]},

    {"section": "Appetite", "rubric": "Aversion to food, nausea at sight or smell of food",
     "triggers": ["aversion to food", "nausea at smell of food", "sight of food nauseates", "cannot bear smell of food"],
     "remedies": [rem("ars-alb", 3), rem("colch", 2), rem("puls", 1)]},

    {"section": "Appetite", "rubric": "Capricious appetite, changeable",
     "triggers": ["capricious appetite", "changeable appetite", "appetite comes and goes"],
     "remedies": [rem("puls", 2), rem("ign", 1), rem("chin", 1)]},

    # ===================== THIRST =====================
    {"section": "Thirst", "rubric": "Thirstless, no thirst even with fever",
     "triggers": ["thirstless", "no thirst", "without thirst", "not thirsty", "absence of thirst"],
     "remedies": [rem("puls", 3), rem("apis", 3), rem("gels", 2), rem("ign", 2)]},

    {"section": "Thirst", "rubric": "Extreme thirst, large quantities at a time",
     "triggers": ["extreme thirst", "great thirst", "large quantities", "drinks large amounts", "excessive thirst"],
     "remedies": [rem("bry", 3), rem("nat-mur", 2), rem("phos", 2)]},

    {"section": "Thirst", "rubric": "Thirst for small sips frequently",
     "triggers": ["small sips", "sips frequently", "thirst small quantities often", "little and often"],
     "remedies": [rem("ars-alb", 3), rem("lyc", 2)]},

    {"section": "Thirst", "rubric": "Thirst for cold water/drinks",
     "triggers": ["thirst for cold water", "thirst for cold drinks", "craves cold water", "wants cold water"],
     "remedies": [rem("phos", 3), rem("bry", 2), rem("verat", 2)]},

    {"section": "Thirst", "rubric": "Thirst for warm drinks",
     "triggers": ["thirst for warm drinks", "craves warm drinks", "wants warm water"],
     "remedies": [rem("ars-alb", 2), rem("lyc", 1)]},

    {"section": "Thirst", "rubric": "Thirst, general/unspecified",
     "triggers": ["thirst", "thirsty"],
     "remedies": [rem("bry", 2), rem("nat-mur", 1), rem("phos", 1)]},

    {"section": "Weight", "rubric": "Dryness of mouth, mucous membranes, or skin",
     "triggers": ["dryness", "dry mouth", "dry mucous membranes", "dry skin"],
     "remedies": [rem("bry", 3), rem("nat-mur", 2)]},

    # ===================== WEIGHT =====================
    {"section": "Weight", "rubric": "Emaciation / weight loss despite good appetite",
     "triggers": ["weight loss despite good appetite", "emaciation despite eating well", "losing weight despite eating", "thin despite good appetite"],
     "remedies": [rem("iod", 3), rem("nat-mur", 2), rem("abrot", 2)]},

    {"section": "Weight", "rubric": "Emaciation, general wasting",
     "triggers": ["emaciation", "wasting", "rapid weight loss", "marasmus", "losing weight", "weight loss"],
     "remedies": [rem("abrot", 3), rem("iod", 2), rem("nat-mur", 2), rem("plb", 2), rem("sars", 1)]},

    {"section": "Weight", "rubric": "Tendency to obesity, overweight",
     "triggers": ["obesity", "overweight", "weight gain", "tendency to fat", "gaining weight easily", "gains weight easily"],
     "remedies": [rem("calc-c", 3), rem("graph", 2), rem("puls", 1)]},

    {"section": "Weight", "rubric": "Wrinkled, old-looking face with emaciation",
     "triggers": ["wrinkled face", "old-looking face", "looking old", "aged appearance", "wrinkled skin"],
     "remedies": [rem("abrot", 3), rem("iod", 1), rem("nat-mur", 1)]},

    # ===================== STOOL =====================
    {"section": "Stool", "rubric": "Constipation, hard dry stool",
     "triggers": ["hard dry stool", "hard stool", "dry stool", "constipation hard", "hard constipated"],
     "remedies": [rem("bry", 3), rem("nux-v", 2), rem("sil", 2)]},

    {"section": "Stool", "rubric": "Constipation, ineffectual urging",
     "triggers": ["ineffectual urging", "frequent urging no result", "urge but cannot pass", "unsatisfactory stool"],
     "remedies": [rem("nux-v", 3), rem("sil", 2), rem("alum", 2)]},

    {"section": "Stool", "rubric": "Constipation, no urge, inactive rectum",
     "triggers": ["no urge to pass stool", "no desire for stool", "inactive rectum", "no urging at all"],
     "remedies": [rem("alum", 3), rem("op", 2)]},

    {"section": "Stool", "rubric": "Diarrhoea, watery/profuse",
     "triggers": ["watery diarrhea", "watery diarrhoea", "profuse diarrhea", "profuse diarrhoea", "gushing diarrhea"],
     "remedies": [rem("podo", 3), rem("verat", 2), rem("chin", 2)]},

    {"section": "Stool", "rubric": "Diarrhoea, painless",
     "triggers": ["painless diarrhea", "painless diarrhoea", "diarrhea no pain"],
     "remedies": [rem("chin", 2), rem("podo", 2)]},

    {"section": "Stool", "rubric": "Stool incomplete feeling / sensation of ball in rectum",
     "triggers": ["incomplete evacuation", "feels incomplete", "ball in rectum", "sensation of a ball", "never feels finished"],
     "remedies": [rem("nux-v", 2), rem("sep", 2), rem("alum", 1)]},

    {"section": "Stool", "rubric": "Stool, soft but difficult to pass",
     "triggers": ["soft stool difficult", "soft but hard to pass", "difficult to pass even when soft"],
     "remedies": [rem("alum", 3), rem("sil", 2), rem("nat-mur", 1)]},

    {"section": "Stool", "rubric": "Constipation, general/unspecified",
     "triggers": ["constipation", "constipated"],
     "remedies": [rem("bry", 2), rem("nux-v", 2), rem("alum", 1)]},

    # ===================== MODALITIES =====================
    {"section": "Modalities", "rubric": "Worse from eating",
     "triggers": ["worse eating", "worse after eating", "worse from eating", "symptoms after meals"],
     "remedies": [rem("nux-v", 3), rem("lyc", 2), rem("bry", 2)]},

    {"section": "Modalities", "rubric": "Better from eating, relief while eating",
     "triggers": ["better eating", "better while eating", "relief while eating", "improves with food"],
     "remedies": [rem("anac", 3), rem("petr", 1)]},

    {"section": "Modalities", "rubric": "Worse in morning",
     "triggers": ["worse morning", "worse in the morning", "worse on waking"],
     "remedies": [rem("nux-v", 3), rem("nat-mur", 2), rem("lach", 2)]},

    {"section": "Modalities", "rubric": "Worse in evening or night",
     "triggers": ["worse evening", "worse at night", "worse night"],
     "remedies": [rem("ars-alb", 2), rem("merc-sol", 2), rem("puls", 1)]},

    {"section": "Modalities", "rubric": "Worse from motion",
     "triggers": ["worse motion", "worse from motion", "worse with motion", "worse moving"],
     "remedies": [rem("bry", 3), rem("bell", 2), rem("spong", 1)]},

    {"section": "Modalities", "rubric": "Better from motion, worse from rest",
     "triggers": ["better motion", "better from motion", "worse from rest", "better moving around"],
     "remedies": [rem("rhus-t", 3), rem("puls", 2)]},

    {"section": "Modalities", "rubric": "Worse from cold, better from heat",
     "triggers": ["worse cold", "worse from cold", "better warmth", "better heat", "better from heat"],
     "remedies": [rem("ars-alb", 3), rem("hep", 2), rem("rhus-t", 2)]},

    {"section": "Modalities", "rubric": "Worse from heat, better from cold",
     "triggers": ["worse heat", "worse from heat", "worse warm room", "better cold", "better from cold", "feels hot", "prefers open air"],
     "remedies": [rem("puls", 3), rem("apis", 2), rem("sulph", 2), rem("fl-ac", 2)]},

    # ===================== FEVER / CHILL =====================
    {"section": "Fever", "rubric": "Chilly patient, generally cold, wants warmth",
     "triggers": ["chilly patient", "always cold", "wants warmth", "very chilly", "sensitive to cold", "chilly"],
     "remedies": [rem("ars-alb", 3), rem("nux-v", 2), rem("hep", 2), rem("sil", 1), rem("abrot", 1), rem("kali-c", 2)]},

    {"section": "Fever", "rubric": "Fever without thirst",
     "triggers": ["fever no thirst", "fever without thirst", "fever thirstless"],
     "remedies": [rem("puls", 3), rem("gels", 2), rem("apis", 2)]},

    {"section": "Fever", "rubric": "Fever with thirst",
     "triggers": ["fever with thirst", "fever and thirst", "thirsty during fever"],
     "remedies": [rem("bry", 3), rem("ars-alb", 2), rem("bell", 1)]},

    {"section": "Fever", "rubric": "Chill predominant / chill with fever / restlessness during chill",
     "triggers": ["fever with chill", "chill with fever", "chills and fever", "restlessness during chill", "shaking chill", "chill preceded by thirst"],
     "remedies": [rem("eup-per", 3), rem("ars-alb", 2), rem("nux-v", 2), rem("gels", 1)]},

    {"section": "Fever", "rubric": "Sudden high fever, violent onset, no chill stage",
     "triggers": ["sudden high fever", "sudden violent fever", "high fever no chill", "sudden onset fever"],
     "remedies": [rem("bell", 3), rem("acon", 3)]},

    {"section": "Fever", "rubric": "One-sided heat / one part hot one part cold",
     "triggers": ["one side hot", "one sided heat", "face hot body cold", "one cheek red one pale"],
     "remedies": [rem("cham", 2), rem("ip", 1)]},

    {"section": "Fever", "rubric": "Profuse sweat with fever, sweat does not relieve",
     "triggers": ["profuse sweat", "drenching sweat", "sweat without relief", "sweats but no relief"],
     "remedies": [rem("merc-sol", 3), rem("chin", 2)]},
]


def find_duplicate_triggers(repertory: list[Rubric]) -> list[str]:
    """Return a list of human-readable warnings for any rubric with a repeated trigger
    phrase — a copy-paste mistake that silently wastes space but doesn't cause a crash,
    which is exactly why it needs an automated check rather than relying on someone
    noticing it by eye (this is how two such duplicates went unnoticed for a while).
    """
    warnings: list[str] = []
    for rubric in repertory:
        counts = Counter(rubric.get("triggers", []))
        dupes = [t for t, n in counts.items() if n > 1]
        if dupes:
            warnings.append(f"{rubric['section']}: {rubric['rubric']!r} has duplicate trigger(s): {dupes}")
    return warnings


def find_invalid_remedy_ids(repertory: list[Rubric], valid_ids: set[str]) -> list[str]:
    """Return a list of human-readable errors for any remedy id referenced in the
    repertory that doesn't exist in the given set of valid ids (from remedies.json).
    """
    errors: list[str] = []
    for rubric in repertory:
        for remedy in rubric.get("remedies", []):
            if remedy["id"] not in valid_ids:
                errors.append(
                    f"{rubric['section']}: {rubric['rubric']!r} references unknown remedy id {remedy['id']!r}"
                )
    return errors


def load_valid_remedy_ids(remedies_path: Path) -> set[str]:
    """Load the set of valid remedy ids from a remedies.json file."""
    with remedies_path.open(encoding="utf-8") as f:
        data = json.load(f)
    return {r["id"] for r in data["remedies"]}


def build(output_path: Path, remedies_path: Path | None) -> int:
    """Validate REPERTORY and write it to output_path as JSON.

    Returns:
        0 on success, 1 if validation found problems (duplicates or invalid remedy ids).
        Duplicates are reported as warnings (non-fatal); invalid remedy ids are fatal,
        since a dangling reference means that remedy silently never scores for that
        rubric at runtime — a bug that's easy to miss without this check.
    """
    exit_code = 0

    dupe_warnings = find_duplicate_triggers(REPERTORY)
    for warning in dupe_warnings:
        print(f"  [WARNING] Duplicate trigger — {warning}")

    if remedies_path is not None:
        valid_ids = load_valid_remedy_ids(remedies_path)
        invalid_id_errors = find_invalid_remedy_ids(REPERTORY, valid_ids)
        for error in invalid_id_errors:
            print(f"  [ERROR] Invalid remedy id — {error}")
        if invalid_id_errors:
            exit_code = 1

    output_path.write_text(json.dumps({"repertory": REPERTORY}, indent=2), encoding="utf-8")

    # re-read what was written, rather than trusting the in-memory object, so this
    # check also catches any JSON-serialization problem (e.g. an accidentally non-
    # serializable value slipping into a rubric)
    written = json.loads(output_path.read_text(encoding="utf-8"))
    section_counts = Counter(r["section"] for r in written["repertory"])

    print(f"Rubrics: {len(written['repertory'])}")
    print(f"By section: {dict(section_counts)}")
    print(f"Saved to {output_path}")
    print("JSON VALID" if exit_code == 0 else "COMPLETED WITH ERRORS — see above")

    return exit_code


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", type=Path, default=Path("repertory.json"),
                         help="Output path for the built repertory (default: repertory.json)")
    parser.add_argument("--remedies", type=Path, default=None,
                         help="Path to remedies.json — if given, validates every remedy id "
                              "referenced in the repertory actually exists there")
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
    exit_code = build(args.output, args.remedies)
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
