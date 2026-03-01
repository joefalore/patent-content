#!/usr/bin/env python3
"""
Batch rescore all previously scored patents using the active prompt in D1.
Only rescores patents that have an abstract and diagrams (skips auto-rejects).
Runs locally — requires ANTHROPIC_API_KEY env var.

Usage:
  export ANTHROPIC_API_KEY=sk-ant-...
  python3 scripts/rescore.py
  python3 scripts/rescore.py --dry-run   # score but don't write to DB
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
import argparse
from typing import Optional

# ── Config ────────────────────────────────────────────────────────────────────

CF_ACCOUNT_ID  = "b34c5595fe31de047a416c904ba0ba16"
CF_API_TOKEN   = "Gd4iBZoRBCSG0AMhAizhvi-uo0VYqKR5v1hGWrQe"
APP_DB_ID      = "94044bcb-eabc-4072-9890-9a783862d3ee"   # inventiongenie-db
PATENTS_DB_ID  = "5cedf456-980d-4276-8d4d-bdf169d92cf4"   # patent-tracker-db
HAIKU_MODEL    = "claude-haiku-4-5-20251001"
DELAY_BETWEEN  = 1.0   # seconds between Anthropic calls

CPC_DESCRIPTIONS = {
    "A": "Human Necessities (food, clothing, personal care, health, amusement)",
    "B": "Performing Operations, Transporting (separating, mixing, shaping, printing, vehicles)",
    "C": "Chemistry, Metallurgy (materials, compounds, processes)",
    "D": "Textiles, Paper (fiber treatment, weaving, apparel)",
    "E": "Fixed Constructions (buildings, civil engineering, sanitary)",
    "F": "Mechanical Engineering, Lighting, Heating (engines, weapons, pumps)",
    "G": "Physics (instruments, nuclear, computing, optics)",
    "H": "Electricity, Electronics (circuits, communications, semiconductors)",
    "Y": "Emerging Cross-Sector Technologies",
}

# ── D1 helpers ────────────────────────────────────────────────────────────────

def d1_query(db_id: str, sql: str, params: list = None) -> list:
    body = {"sql": sql}
    if params:
        body["params"] = params
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/d1/database/{db_id}/query",
        data=data,
        headers={
            "Authorization": f"Bearer {CF_API_TOKEN}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read())
    if not result.get("success"):
        raise RuntimeError(f"D1 query failed: {result}")
    return result["result"][0]["results"]


# ── Prompt template ───────────────────────────────────────────────────────────

def fill_template(template: str, vars: dict) -> str:
    import re
    return re.sub(r"\{\{(\w+)\}\}", lambda m: vars.get(m.group(1), ""), template)


# ── Anthropic scoring ─────────────────────────────────────────────────────────

def score_patent(patent: dict, prompt_template: str, api_key: str) -> Optional[dict]:
    cpc = patent.get("cpc_section") or "Unknown"
    cpc_desc = CPC_DESCRIPTIONS.get(cpc, cpc)

    prompt = fill_template(prompt_template, {
        "patent_number":  patent["patent_number"],
        "title":          patent.get("title") or "",
        "assignee_name":  patent.get("assignee_name") or "Unknown",
        "abstract":       patent.get("abstract") or "",
        "cpc_section":    cpc,
        "cpc_description": cpc_desc,
        "has_diagrams":   "Yes" if patent.get("has_diagrams") else "No",
    })

    body = json.dumps({
        "model": HAIKU_MODEL,
        "max_tokens": 512,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"  Anthropic error {e.code}: {err[:200]}")
        return None

    raw = data["content"][0]["text"]
    raw = raw.replace("```json", "").replace("```", "").strip()

    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        print(f"  JSON parse failed: {raw[:100]}")
        return None

    required = ["familiar_subject", "relatability", "explainability",
                "visual_potential", "discovery_factor", "story_hook", "score"]
    for field in required:
        if not isinstance(result.get(field), (int, float)):
            print(f"  Missing field '{field}'")
            return None

    return result


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Score but don't write to DB")
    args = parser.parse_args()

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("Error: ANTHROPIC_API_KEY env var not set")
        sys.exit(1)

    print("Fetching active scoring prompt...")
    rows = d1_query(APP_DB_ID,
        "SELECT prompt_text FROM prompts WHERE prompt_type='scoring' AND is_active=1 ORDER BY version DESC LIMIT 1")
    if not rows:
        print("No active scoring prompt found")
        sys.exit(1)
    prompt_template = rows[0]["prompt_text"]
    print("Prompt loaded.")

    print("Fetching patents to rescore (has abstract + has diagrams)...")
    to_rescore = d1_query(APP_DB_ID,
        "SELECT patent_number, abstract, has_diagrams FROM patent_scores WHERE abstract IS NOT NULL AND has_diagrams = 1")
    total = len(to_rescore)
    print(f"Found {total} patents to rescore.")

    # Fetch metadata from patent-tracker-db in chunks of 99
    numbers = [r["patent_number"] for r in to_rescore]
    meta_map = {}
    for i in range(0, len(numbers), 99):
        chunk = numbers[i:i+99]
        placeholders = ",".join(["?" for _ in chunk])
        rows = d1_query(PATENTS_DB_ID,
            f"SELECT patent_number, title, assignee_name, cpc_section FROM patents WHERE patent_number IN ({placeholders})",
            chunk)
        for r in rows:
            meta_map[r["patent_number"]] = r
    print(f"Fetched metadata for {len(meta_map)} patents.")

    ok = skip = errors = 0

    for i, row in enumerate(to_rescore):
        pn = row["patent_number"]
        meta = meta_map.get(pn, {})

        patent = {
            "patent_number": pn,
            "abstract":      row["abstract"],
            "has_diagrams":  row["has_diagrams"],
            "title":         meta.get("title", ""),
            "assignee_name": meta.get("assignee_name"),
            "cpc_section":   meta.get("cpc_section"),
        }

        result = score_patent(patent, prompt_template, api_key)

        if not result:
            errors += 1
            print(f"[{i+1}/{total}] {pn} — ERROR, keeping existing score")
        else:
            score = result["score"]
            print(f"[{i+1}/{total}] [{score}/10] {pn} — {meta.get('title','')[:50]}")

            if not args.dry_run:
                d1_query(APP_DB_ID,
                    """UPDATE patent_scores SET
                        score = ?,
                        consumer_relevance = ?,
                        relatability = ?,
                        explainability = ?,
                        visual_appeal = ?,
                        discovery_factor = ?,
                        story_hook = ?,
                        plain_english = ?,
                        reasoning = ?
                    WHERE patent_number = ?""",
                    [
                        score,
                        result["familiar_subject"],
                        result["relatability"],
                        result["explainability"],
                        result["visual_potential"],
                        result["discovery_factor"],
                        result["story_hook"],
                        result["plain_english"],
                        result["reasoning"],
                        pn,
                    ])
            ok += 1

        time.sleep(DELAY_BETWEEN)

    print(f"\nDone. rescored={ok}, errors={errors}, skipped={skip}")
    if args.dry_run:
        print("DRY RUN — no DB writes performed")


if __name__ == "__main__":
    main()
