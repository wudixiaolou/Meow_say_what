import argparse
import csv
import json
import os
import re
from collections import Counter, defaultdict

INTENT_CLASSES = [
    "attention_call",
    "food_request",
    "comfort_purr",
    "warning_hiss",
    "distress",
    "neutral_other",
]


def parse_args():
    parser = argparse.ArgumentParser(description="Fuse multiple signals and classify dataset to 6 intents.")
    parser.add_argument("--pseudo-csv", required=True)
    parser.add_argument("--catalog-json", required=True)
    parser.add_argument("--output-csv", required=True)
    parser.add_argument("--source-doc-index-json", default="")
    parser.add_argument("--min-yamnet-confidence", type=float, default=0.08)
    return parser.parse_args()


def load_catalog(path: str):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return {s["id"]: s for s in data.get("sources", [])}


def load_doc_index(path: str):
    if not path or not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    out = {}
    for row in data.get("docs", []):
        sid = str(row.get("source_id", ""))
        out[sid] = str(row.get("status", "failed"))
    return out


def split_source_file(file_name: str):
    if "__" in file_name:
        source_id, origin_name = file_name.split("__", 1)
        return source_id, origin_name
    return "unknown_source", file_name


def extract_suffix(origin_name: str):
    stem = os.path.splitext(origin_name)[0]
    m = re.search(r"(\d+)$", stem)
    return m.group(1) if m else "nosuffix"


def parse_context_from_name(origin_name: str):
    token = origin_name.split("_", 1)[0].strip().upper()
    if len(token) == 1 and token in {"B", "F", "I"}:
        return token
    return ""


def add_score(scores, label, value):
    if label in scores:
        scores[label] += float(value)


def majority_hint(rows):
    c = Counter([r["yamnet_label"] for r in rows if r["yamnet_label"] in INTENT_CLASSES])
    if not c:
        return "neutral_other", 0.0
    label, n = c.most_common(1)[0]
    return label, n / max(1, len(rows))


def main():
    args = parse_args()
    os.makedirs(os.path.dirname(args.output_csv) or ".", exist_ok=True)
    catalog = load_catalog(args.catalog_json)
    doc_index = load_doc_index(args.source_doc_index_json)

    rows = []
    with open(args.pseudo_csv, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            fn = str(r["file"])
            source_id, origin_name = split_source_file(fn)
            suffix = extract_suffix(origin_name)
            context_token = parse_context_from_name(origin_name)
            yamnet_label = str(r.get("intent_label", "neutral_other"))
            yamnet_conf = float(r.get("intent_confidence", "0") or 0)
            rows.append(
                {
                    "file": fn,
                    "source_id": source_id,
                    "origin_name": origin_name,
                    "suffix": suffix,
                    "context_token": context_token,
                    "yamnet_label": yamnet_label,
                    "yamnet_conf": yamnet_conf,
                    "top_class_1": str(r.get("top_class_1", "")),
                }
            )

    suffix_groups = defaultdict(list)
    for r in rows:
        suffix_groups[(r["source_id"], r["suffix"])].append(r)
    suffix_hints = {}
    for k, g in suffix_groups.items():
        hint_label, ratio = majority_hint(g)
        suffix_hints[k] = (hint_label, ratio)

    out = []
    for r in rows:
        source_cfg = catalog.get(r["source_id"], {})
        source_doc_status = doc_index.get(r["source_id"], "unknown")
        fixed_intent = str(source_cfg.get("fixed_intent", ""))
        semantics = source_cfg.get("filename_semantics", {})
        context_map = semantics.get("context_map", {})
        context_label = context_map.get(r["context_token"], "")
        suffix_label, suffix_ratio = suffix_hints.get((r["source_id"], r["suffix"]), ("neutral_other", 0.0))

        scores = {k: 0.0 for k in INTENT_CLASSES}
        add_score(scores, "neutral_other", 0.35)
        if fixed_intent in INTENT_CLASSES:
            add_score(scores, fixed_intent, 1.25)
        if context_label:
            add_score(scores, context_label, 0.90)
        if r["yamnet_label"] in INTENT_CLASSES and r["yamnet_conf"] >= args.min_yamnet_confidence:
            add_score(scores, r["yamnet_label"], 0.75 + min(0.5, r["yamnet_conf"]))
        if suffix_ratio >= 0.55:
            add_score(scores, suffix_label, 0.55)
        top1 = r["top_class_1"]
        if "Hiss" in top1:
            add_score(scores, "warning_hiss", 0.9)
        if "Purr" in top1:
            add_score(scores, "comfort_purr", 0.9)
        if "Meow" in top1 or "Caterwaul" in top1:
            add_score(scores, "attention_call", 0.55)
        if "Cry" in top1 or "Scream" in top1:
            add_score(scores, "distress", 0.7)
        if "Growling" in top1:
            add_score(scores, "warning_hiss", 0.5)
        if source_doc_status != "ok":
            for k in scores:
                scores[k] *= 0.92

        ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
        best_label, best_score = ranked[0]
        second_score = ranked[1][1] if len(ranked) > 1 else 0.0
        margin = best_score - second_score
        needs_review = margin < 0.22 or best_score < 0.55

        out.append(
            {
                "file": r["file"],
                "source_id": r["source_id"],
                "origin_name": r["origin_name"],
                "semantic_group": f"{r['source_id']}|{r['suffix']}",
                "suffix": r["suffix"],
                "context_token": r["context_token"],
                "context_label": context_label,
                "source_doc_status": source_doc_status,
                "yamnet_label": r["yamnet_label"],
                "yamnet_confidence": f"{r['yamnet_conf']:.6f}",
                "suffix_hint_label": suffix_label,
                "suffix_hint_ratio": f"{suffix_ratio:.4f}",
                "final_intent_label": best_label,
                "final_confidence": f"{best_score:.6f}",
                "needs_review": "true" if needs_review else "false",
                "decision_margin": f"{margin:.6f}",
            }
        )

    with open(args.output_csv, "w", newline="", encoding="utf-8") as f:
        fields = [
            "file",
            "source_id",
            "origin_name",
            "semantic_group",
            "suffix",
            "context_token",
            "context_label",
            "source_doc_status",
            "yamnet_label",
            "yamnet_confidence",
            "suffix_hint_label",
            "suffix_hint_ratio",
            "final_intent_label",
            "final_confidence",
            "needs_review",
            "decision_margin",
        ]
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(out)
    print(f"Classified rows: {len(out)}")
    print(f"Evidence CSV: {args.output_csv}")


if __name__ == "__main__":
    main()
