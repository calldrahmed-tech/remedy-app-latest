#!/usr/bin/env python3
"""
enrich_from_boericke.py

Enriches Smart Remedy AI's remedies.json with real text from Boericke's
Homoeopathic Materia Medica (1927), hosted free and public-domain at
homeoint.org: http://homeoint.org/books/boericmm/

For every remedy already in your remedies.json, this script:
  1. Looks up the correct Boericke page for that remedy (by matching name)
  2. Downloads the page
  3. Parses out real keynote sentences (Mind, Stomach, Stool, etc. sections)
     and modality phrases (Worse/Better)
  4. Replaces that remedy's thin keynotes with the richer parsed ones
  5. Writes the result back to remedies.json (a .bak backup is made first)

WHY THIS MATTERS: the app matches free-text symptoms against your keynote
wording. Short telegraphic keynotes ("restless, anxious, chilly") have very
little overlap with a full sentence a doctor types. Boericke's actual prose
("Very irritable, sensitive to all impressions. Cannot bear noises, odors,
light.") gives the matcher far more real language to match against.

USAGE:
    pip install requests --break-system-packages   # if not already installed
    python3 enrich_from_boericke.py remedies.json

    # To enrich only specific remedies (by id), e.g. while testing:
    python3 enrich_from_boericke.py remedies.json --only puls,sep,lyc

    # To skip remedies that already have a sourceNote (already enriched):
    python3 enrich_from_boericke.py remedies.json --skip-enriched

This script is respectful of the source: it fetches one page at a time with
a short delay between requests, and only reads from homeoint.org (a
long-standing free public-domain homeopathy archive).
"""

from __future__ import annotations

import json
import re
import sys
import time
import argparse
import urllib.request

INDEX_URL = "http://homeoint.org/books/boericmm/remedies.htm"
BASE_URL = "http://homeoint.org/books/boericmm/"
USER_AGENT = "Mozilla/5.0 (compatible; SmartRemedyAI-DataEnrichment/1.0; personal research use)"


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw = resp.read()
        # the source pages are Latin-1 / Windows-1252 encoded (old FrontPage HTML)
        for enc in ("windows-1252", "latin-1", "utf-8"):
            try:
                return raw.decode(enc)
            except UnicodeDecodeError:
                continue
        return raw.decode("utf-8", errors="replace")


def build_name_index() -> dict[str, str]:
    """Fetch the master abbreviation index and return {normalized_name: url}."""
    print("Fetching Boericke remedy index...")
    html = fetch(INDEX_URL)
    # lines look like: <A HREF="a/abrot.htm">ABROT</A> ------> ABROTANUM
    pattern = re.compile(
        r'<A HREF="([^"]+\.htm)">[^<]*</A>\s*-+>\s*([^<\n]+)', re.IGNORECASE
    )
    index = {}
    for href, name_raw in pattern.findall(html):
        # name_raw may be "ABROTANUM" or "ABIES NIGRA" or "AESCULUS HIPPOCASTANUM (AESCULUS)"
        primary = re.split(r"[\(\-]", name_raw)[0].strip().lower()
        primary = re.sub(r"\s+", " ", primary)
        url = BASE_URL + href
        index[primary] = url
        # also index any bracketed alt-name, e.g. "(AESCULUS)"
        alt_match = re.search(r"\(([^)]+)\)", name_raw)
        if alt_match:
            alt = alt_match.group(1).strip().lower()
            index.setdefault(alt, url)
    print(f"Indexed {len(index)} remedy names.")
    return index


def find_url_for_remedy(remedy_name: str, name_index: dict[str, str]) -> str | None:
    """Match a remedies.json remedy name to a Boericke index entry.

    Tries, in order of specificity: exact match, then a simplified form with common
    species/variety suffixes stripped, then a genus-only (first word) match. The
    simplified and genus-only fallbacks pick the LONGEST matching candidate name
    (most specific), not just the first one encountered in dict order — with dozens of
    "Calcarea X" or "Mercurius X" entries sharing a first word, taking whatever happened
    to be inserted first into the index was an arbitrary, easy-to-get-wrong choice.
    """
    key = remedy_name.lower().strip()
    if key in name_index:
        return name_index[key]

    # try without common suffix words that vary between editions
    simplified = re.sub(r"\b(officinalis|vulgaris|album|alba|nigra|indica|tinctoria)\b", "", key).strip()
    simplified = re.sub(r"\s+", " ", simplified)
    best_match: tuple[str, str] | None = None  # (candidate_name, url)
    if simplified:
        for candidate_name, url in name_index.items():
            if simplified in candidate_name:
                if best_match is None or len(candidate_name) > len(best_match[0]):
                    best_match = (candidate_name, url)
    if best_match:
        return best_match[1]

    # try matching on just the first word (genus), e.g. "Bryonia" from "Bryonia Alba"
    first_word = key.split()[0] if key.split() else key
    best_match = None
    for candidate_name, url in name_index.items():
        if candidate_name.startswith(first_word):
            if best_match is None or len(candidate_name) > len(best_match[0]):
                best_match = (candidate_name, url)
    return best_match[1] if best_match else None


def clean_sentence(s: str) -> str:
    s = re.sub(r"[\*]", "", s)
    s = re.sub(r"\([A-Za-z][A-Za-z\-\s;.]*\)", "", s)  # strip (Bry; Ars) cross-refs
    s = re.sub(r"<[^>]+>", " ", s)  # strip any leftover HTML tags
    s = re.sub(r"\s+", " ", s).strip().rstrip(".").strip()
    return s


def parse_section_text(raw_body: str) -> list[str]:
    raw_body = re.sub(r"\*\*[A-Za-z ]+\.--\*\*", " ", raw_body)
    raw_body = re.sub(r"[A-Za-z][A-Za-z ]{1,20}\.--", " ", raw_body)
    parts = re.split(r"(?<=[a-z0-9])\.\s+|\;\s+", raw_body)
    out = []
    for p in parts:
        c = clean_sentence(p)
        if len(c) > 4 and not re.match(r"^[A-Z][a-z]{1,4}$", c):
            out.append(c)
    return out


def parse_modalities(mod_text: str, max_each: int = 8) -> list[dict]:
    worse_m = re.search(r"Worse,?\s*(.+?)(?:Better,|$)", mod_text, re.S)
    better_m = re.search(r"Better,?\s*(.+)$", mod_text, re.S)
    worse = clean_sentence(worse_m.group(1)) if worse_m else ""
    better = clean_sentence(better_m.group(1)) if better_m else ""
    keynotes = []
    # cap each list — classical remedies often list 15-20+ modality factors, and splitting
    # every one into its own isolated 1-2 word keynote makes coincidental matching too easy
    # (e.g. "worse motion" alone becomes trivial to match against almost any query mentioning
    # motion at all, regardless of body region or context). Keeping the first N (the most
    # emphasized/defining ones, as Boericke orders them) preserves the strongest signal.
    for item in worse.split(",")[:max_each]:
        item = item.strip().rstrip(".")
        if len(item) > 2:
            keynotes.append({"t": f"worse {item.lower()}", "w": 0.6})
    for item in better.split(",")[:max_each]:
        item = item.strip().rstrip(".")
        if len(item) > 2:
            keynotes.append({"t": f"better {item.lower()}", "w": 0.6})
    return keynotes


def html_to_text(html: str) -> str:
    # strip nav/header/footer boilerplate and tags, keep the body prose
    html = re.sub(r"<head.*?</head>", "", html, flags=re.S | re.I)
    html = re.sub(r"<script.*?</script>", "", html, flags=re.S | re.I)
    text = re.sub(r"<br\s*/?>", "\n", html, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"&nbsp;", " ", text)
    text = re.sub(r"&amp;", "&", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text


def parse_remedy_page(html: str, remedy_name: str, max_body_sentences: int = 14) -> list[dict]:
    text = html_to_text(html)
    mod_match = re.search(r"Modalities\.--(.+?)(?:Relationship|Dose|Copyright|$)", text, re.S)
    mod_keynotes = parse_modalities(mod_match.group(1)) if mod_match else []

    body_match = re.search(
        re.escape(remedy_name.split()[0]) + r"(.+?)(?:Modalities\.--|Relationship\.--|Dose\.--)",
        text, re.S | re.I
    )
    body_text = body_match.group(1) if body_match else text
    body_sentences = parse_section_text(body_text)

    keynotes = [{"t": s.lower(), "w": 2} for s in body_sentences if 2 <= len(s.split()) <= 25][:max_body_sentences]
    keynotes += mod_keynotes

    dedup = {}
    for k in keynotes:
        key = k["t"].strip().lower()
        if key not in dedup or k["w"] > dedup[key]["w"]:
            dedup[key] = k
    return list(dedup.values())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("remedies_json", help="Path to your remedies.json")
    ap.add_argument("--only", help="Comma-separated remedy ids to process (for testing)")
    ap.add_argument("--skip-enriched", action="store_true", help="Skip remedies that already have a sourceNote")
    ap.add_argument("--delay", type=float, default=1.0, help="Seconds to wait between requests (default 1.0)")
    ap.add_argument("--checkpoint-every", type=int, default=15,
                     help="Save progress to disk every N remedies, so a power cut or crash only loses a few "
                          "minutes of work instead of the whole run (default 15)")
    args = ap.parse_args()

    if args.checkpoint_every < 1:
        ap.error("--checkpoint-every must be at least 1")
    if args.delay < 0:
        ap.error("--delay cannot be negative")

    with open(args.remedies_json, encoding="utf-8") as f:
        db = json.load(f)

    backup_path = args.remedies_json + ".bak"
    with open(backup_path, "w", encoding="utf-8") as f:
        json.dump(db, f, indent=2)
    print(f"Backup saved to {backup_path}")

    def save_progress():
        with open(args.remedies_json, "w", encoding="utf-8") as f:
            json.dump(db, f, indent=2)

    name_index = build_name_index()

    only_ids = set(args.only.split(",")) if args.only else None

    # RESUME SUPPORT: if this script was already run once and interrupted, remedies from
    # that earlier attempt carry a sourceNote — --skip-enriched lets you just re-run the
    # same command and it'll pick up where it left off instead of starting over.
    enriched, skipped, failed = 0, 0, 0
    since_last_save = 0
    for remedy in db["remedies"]:
        if only_ids and remedy["id"] not in only_ids:
            continue
        if args.skip_enriched and remedy.get("sourceNote"):
            skipped += 1
            continue

        url = find_url_for_remedy(remedy["name"], name_index)
        if not url:
            print(f"  [NO MATCH] {remedy['name']} — leaving existing keynotes as-is")
            failed += 1
            continue

        try:
            html = fetch(url)
            keynotes = parse_remedy_page(html, remedy["name"])
            if not keynotes:
                print(f"  [NO KEYNOTES PARSED] {remedy['name']} ({url}) — leaving as-is")
                failed += 1
                continue
            remedy["keynotes"] = keynotes
            remedy["maxScore"] = sum(k["w"] for k in keynotes)
            remedy["sourceNote"] = "Enriched from Boericke Materia Medica (public domain)"
            print(f"  [OK] {remedy['name']}: {len(keynotes)} keynotes  ({url})")
            enriched += 1
            since_last_save += 1
        except Exception as e:
            print(f"  [ERROR] {remedy['name']} ({url}): {e}")
            failed += 1

        if since_last_save >= args.checkpoint_every:
            save_progress()
            print(f"  --- checkpoint saved ({enriched} enriched so far) ---")
            since_last_save = 0

        time.sleep(args.delay)

    with open(args.remedies_json, "w", encoding="utf-8") as f:
        json.dump(db, f, indent=2)

    print()
    print(f"Enriched: {enriched}   Skipped: {skipped}   Failed/no-match: {failed}")
    print(f"Saved to {args.remedies_json}")
    print("Remedies that failed to match keep their original keynotes untouched —")
    print("check the [NO MATCH] lines above and fix remedy names manually if needed.")


if __name__ == "__main__":
    main()
