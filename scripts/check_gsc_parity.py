import argparse
import csv
import json
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def post_json(url: str, payload: dict):
    req = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def normalize_path(url: str) -> str:
    try:
        p = (urlparse(url).path or "/").lower().replace("//", "/")
    except Exception:
        p = str(url or "").lower().strip()
    if p != "/" and p.endswith("/"):
        p = p[:-1]
    return p or "/"


def build_lookup(csv_path: Path):
    rows = list(csv.reader(csv_path.read_text(encoding="utf-8-sig").splitlines()))
    lookup = {}
    col_to_tier = {1: "A", 2: "B", 3: "C", 4: "D", 5: "E"}
    for r in rows[1:]:
        for idx, tier in col_to_tier.items():
            if idx >= len(r):
                continue
            raw = (r[idx] or "").strip()
            if not raw:
                continue
            p = normalize_path(raw)
            lookup[p] = tier
            # alias / <-> /home
            if p.endswith("/home"):
                lookup[p[:-5] or "/"] = tier
            elif p.endswith("/"):
                lookup[(p[:-1] or "/") + "/home"] = tier
    return lookup


def classify_ai_geo(url: str, lookup: dict):
    p = normalize_path(url)
    if p in ("/", "/home"):
        return "A"
    if "/s/" in p:
        return "E"
    if p in lookup:
        return lookup[p]
    if "/workshops" in p or "/event" in p or "/webinar" in p:
        return "C"
    if "/academy" in p or "/free-online-photography-course" in p:
        return "E"
    if "/blog" in p or "/article" in p or "/guides" in p:
        return "D"
    if (
        "/photography-services-near-me/" in p
        or "/product" in p
        or "/courses" in p
        or "/mentoring" in p
        or "/subscription" in p
    ):
        return "B"
    if len([x for x in p.split("/") if x]) <= 1:
        return "A"
    return "F"


def rollup_from_rows(rows, lookup):
    out = {k: {"clicks": 0, "impressions": 0} for k in ["A", "B", "C", "D", "E", "F"]}
    for r in rows:
        tier = classify_ai_geo(r.get("page") or r.get("url") or "", lookup)
        out[tier]["clicks"] += int(round(float(r.get("clicks") or 0)))
        out[tier]["impressions"] += int(round(float(r.get("impressions") or 0)))
    return out


def main():
    ap = argparse.ArgumentParser(description="Compare Clawdbot vs AI GEO parity by period+tier.")
    ap.add_argument("--claw-json", required=True, help="Path to Clawdbot segmented dump JSON")
    ap.add_argument("--tier-csv", required=True, help="Path to page segmentation by tier.csv")
    ap.add_argument("--endpoint", default="https://ai-geo-audit.vercel.app/api/fetch-search-console")
    ap.add_argument("--property-url", default="https://www.alanranger.com")
    ap.add_argument("--out", required=False, help="Optional output report JSON path")
    args = ap.parse_args()

    claw = load_json(Path(args.claw_json))
    lookup = build_lookup(Path(args.tier_csv))

    report = {"windows": {}, "pass": True}
    for key in ["latest", "d7", "d28", "d90"]:
        w = (claw.get("periods", {}) or {}).get(key, {})
        window = w.get("window", {}) or {}
        start = window.get("startDate")
        end = window.get("endDate")
        if not start or not end:
            continue

        ai = post_json(
            args.endpoint,
            {
                "propertyUrl": args.property_url,
                "startDate": start,
                "endDate": end,
                "dimensions": ["page"],
                "rowLimit": 25000,
            },
        )
        ai_rows = ai.get("rows", []) or []
        ai_roll = rollup_from_rows(ai_rows, lookup)

        claw_roll = (((w.get("rollups", {}) or {}).get("byTier", {}) or {} if isinstance(w, dict) else {}) or {})
        deltas = {}
        win_pass = True
        for t in ["A", "B", "C", "D", "E", "F"]:
            cc = int(round(float((claw_roll.get(t, {}) or {}).get("clicks") or 0)))
            ci = int(round(float((claw_roll.get(t, {}) or {}).get("impressions") or 0)))
            ac = ai_roll[t]["clicks"]
            aii = ai_roll[t]["impressions"]
            dc = ac - cc
            di = aii - ci
            deltas[t] = {"claw_clicks": cc, "ai_clicks": ac, "delta_clicks": dc, "claw_impr": ci, "ai_impr": aii, "delta_impr": di}
            if dc != 0 or di != 0:
                win_pass = False

        report["windows"][key] = {"window": {"startDate": start, "endDate": end}, "pass": win_pass, "deltas": deltas}
        report["pass"] = report["pass"] and win_pass

    print(json.dumps(report, indent=2))
    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()

