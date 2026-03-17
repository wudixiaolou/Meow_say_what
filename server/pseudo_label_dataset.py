import argparse
import csv
import os
import sys
import types
from typing import List, Tuple

import librosa
import numpy as np

try:
    import pkg_resources
except ImportError:
    from packaging.version import parse as _parse_version

    pkg_resources = types.ModuleType("pkg_resources")
    pkg_resources.parse_version = _parse_version
    sys.modules["pkg_resources"] = pkg_resources

import tensorflow_hub as hub

SAMPLE_RATE = 16000
CAT_HINTS = ("Cat", "Meow", "Purr", "Hiss", "Caterwaul")
INTENT_RULES = {
    "food_request": ("Begging", "Whimper", "Purr"),
    "warning_hiss": ("Hiss",),
    "comfort_purr": ("Purr",),
    "distress": ("Caterwaul", "Scream", "Cry", "Yowl"),
    "attention_call": ("Meow", "Caterwaul"),
}


def parse_args():
    parser = argparse.ArgumentParser(description="Pseudo-label cat intent from unlabeled audio using YAMNet.")
    parser.add_argument("--input-dir", required=True, help="Directory with unlabeled audio files.")
    parser.add_argument("--output-csv", default="artifacts/pseudo_labels.csv")
    parser.add_argument("--min-cat-score", type=float, default=0.12)
    parser.add_argument("--topk", type=int, default=5)
    return parser.parse_args()


def load_audio(path: str):
    wav, _ = librosa.load(path, sr=SAMPLE_RATE, mono=True)
    if wav.size == 0:
        return np.zeros((SAMPLE_RATE,), dtype=np.float32)
    return wav.astype(np.float32)


def choose_intent(top_classes: List[Tuple[str, float]], min_cat_score: float):
    cat_scores = [score for name, score in top_classes if any(h in name for h in CAT_HINTS)]
    best_cat = max(cat_scores) if cat_scores else 0.0
    if best_cat < min_cat_score:
        return "neutral_other", 0.0, "low_cat_signal"
    for intent, hints in INTENT_RULES.items():
        for name, score in top_classes:
            if any(h in name for h in hints):
                return intent, float(score), f"rule:{intent}"
    if best_cat >= min_cat_score * 1.6:
        return "food_request", float(best_cat), "fallback:high_cat_signal"
    return "neutral_other", float(best_cat), "fallback:neutral"


def main():
    args = parse_args()
    model = hub.load("https://tfhub.dev/google/yamnet/1")
    class_map_path = model.class_map_path().numpy().decode("utf-8")
    class_names = []
    with open(class_map_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            class_names.append(row["display_name"])

    rows = []
    for name in sorted(os.listdir(args.input_dir)):
        if not name.lower().endswith((".wav", ".mp3", ".ogg", ".flac", ".m4a")):
            continue
        fp = os.path.join(args.input_dir, name)
        wav = load_audio(fp)
        scores, _, _ = model(wav)
        mean_scores = np.mean(scores.numpy(), axis=0)
        idx = np.argsort(mean_scores)[::-1][: args.topk]
        top = [(class_names[i], float(mean_scores[i])) for i in idx]
        intent, conf, reason = choose_intent(top, args.min_cat_score)
        rows.append(
            {
                "file": name,
                "intent_label": intent,
                "intent_confidence": f"{conf:.6f}",
                "reason": reason,
                "top_class_1": top[0][0] if len(top) > 0 else "",
                "top_score_1": f"{top[0][1]:.6f}" if len(top) > 0 else "",
                "top_class_2": top[1][0] if len(top) > 1 else "",
                "top_score_2": f"{top[1][1]:.6f}" if len(top) > 1 else "",
            }
        )

    os.makedirs(os.path.dirname(args.output_csv) or ".", exist_ok=True)
    with open(args.output_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "file",
                "intent_label",
                "intent_confidence",
                "reason",
                "top_class_1",
                "top_score_1",
                "top_class_2",
                "top_score_2",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)
    print(f"Generated pseudo labels: {args.output_csv}")
    print(f"Total files: {len(rows)}")


if __name__ == "__main__":
    main()
