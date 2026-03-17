import argparse
import csv
import json
import os
import shutil
from collections import defaultdict

TARGET_CLASSES = [
    "attention_call",
    "food_request",
    "comfort_purr",
    "warning_hiss",
    "distress",
    "neutral_other",
]


def parse_args():
    parser = argparse.ArgumentParser(description="Build balanced intent dataset from classification evidence.")
    parser.add_argument("--raw-dir", required=True)
    parser.add_argument("--evidence-csv", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--report-json", required=True)
    parser.add_argument("--per-class", type=int, default=20)
    parser.add_argument("--min-confidence", type=float, default=0.75)
    parser.add_argument("--max-groups-per-class", type=int, default=8)
    return parser.parse_args()


def clear_dir(path: str):
    if os.path.exists(path):
        shutil.rmtree(path)
    os.makedirs(path, exist_ok=True)


def main():
    args = parse_args()
    clear_dir(args.output_dir)
    os.makedirs(os.path.dirname(args.report_json) or ".", exist_ok=True)

    grouped = defaultdict(list)
    grouped_by_semantic = defaultdict(lambda: defaultdict(list))
    review_count = 0
    with open(args.evidence_csv, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            label = str(row.get("final_intent_label", "neutral_other"))
            if label not in TARGET_CLASSES:
                continue
            conf = float(row.get("final_confidence", "0") or 0)
            if conf < args.min_confidence:
                continue
            if str(row.get("needs_review", "false")).lower() == "true":
                review_count += 1
                continue
            grouped[label].append(row)
            sg = str(row.get("semantic_group", "unknown_group"))
            grouped_by_semantic[label][sg].append(row)

    selected = defaultdict(list)
    gaps = {}
    copied = 0
    for label in TARGET_CLASSES:
        groups = grouped_by_semantic[label]
        ranked_groups = sorted(
            groups.items(),
            key=lambda item: (
                -len(item[1]),
                -sum(float(x.get("final_confidence", "0") or 0) for x in item[1]) / max(1, len(item[1])),
            ),
        )
        keep_groups = ranked_groups[: args.max_groups_per_class]
        candidate_rows = []
        for _, rs in keep_groups:
            rs_sorted = sorted(rs, key=lambda r: float(r.get("final_confidence", "0") or 0), reverse=True)
            candidate_rows.extend(rs_sorted)
        rows = sorted(candidate_rows, key=lambda r: float(r.get("final_confidence", "0") or 0), reverse=True)
        take = rows[: args.per_class]
        selected[label] = take
        gap = max(0, args.per_class - len(take))
        gaps[label] = gap

        out_label_dir = os.path.join(args.output_dir, label)
        os.makedirs(out_label_dir, exist_ok=True)
        for row in take:
            fn = str(row["file"])
            src = os.path.join(args.raw_dir, fn)
            if not os.path.exists(src):
                continue
            dst = os.path.join(out_label_dir, fn)
            shutil.copy2(src, dst)
            copied += 1

    report = {
        "target_per_class": args.per_class,
        "max_groups_per_class": args.max_groups_per_class,
        "needs_review_filtered": review_count,
        "selected_per_class": {k: len(v) for k, v in selected.items()},
        "gaps_per_class": gaps,
        "total_selected": copied,
        "ready_for_training": all(v == 0 for v in gaps.values()),
    }
    with open(args.report_json, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(f"Total selected: {copied}")
    print(f"Ready for training: {report['ready_for_training']}")
    print(f"Gap report: {args.report_json}")


if __name__ == "__main__":
    main()
