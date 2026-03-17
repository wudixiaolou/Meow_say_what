import argparse
import csv
import os
import random
import shutil
from collections import defaultdict

AUDIO_EXT = (".wav", ".mp3", ".ogg", ".flac", ".m4a")


def parse_args():
    parser = argparse.ArgumentParser(description="Prepare small listening pack for manual review.")
    parser.add_argument("--raw-dir", required=True)
    parser.add_argument("--review-dir", required=True)
    parser.add_argument("--per-group", type=int, default=12)
    parser.add_argument("--evidence-csv", default="")
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def clear_dir(path: str):
    if os.path.exists(path):
        shutil.rmtree(path)
    os.makedirs(path, exist_ok=True)


def source_id_from_name(file_name: str):
    if "__" in file_name:
        return file_name.split("__", 1)[0]
    return "unknown_source"


def main():
    args = parse_args()
    clear_dir(args.review_dir)
    random.seed(args.seed)

    grouped = defaultdict(list)
    if args.evidence_csv and os.path.exists(args.evidence_csv):
        with open(args.evidence_csv, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                fn = str(row.get("file", ""))
                if not fn.lower().endswith(AUDIO_EXT):
                    continue
                source_id = str(row.get("source_id") or source_id_from_name(fn))
                label = str(row.get("final_intent_label", "unknown_intent"))
                key = f"{source_id}__{label}"
                grouped[key].append(fn)
    else:
        for fn in sorted(os.listdir(args.raw_dir)):
            if not fn.lower().endswith(AUDIO_EXT):
                continue
            grouped[source_id_from_name(fn)].append(fn)

    rows = []
    for group_id, files in grouped.items():
        chosen = files[:] if len(files) <= args.per_group else random.sample(files, args.per_group)
        out_source_dir = os.path.join(args.review_dir, group_id)
        os.makedirs(out_source_dir, exist_ok=True)
        for idx, fn in enumerate(sorted(chosen), start=1):
            src = os.path.join(args.raw_dir, fn)
            dst_name = f"{idx:03d}__{fn}"
            dst = os.path.join(out_source_dir, dst_name)
            shutil.copy2(src, dst)
            rows.append({"group_id": group_id, "review_file": os.path.join(group_id, dst_name), "raw_file": fn})

    manifest_csv = os.path.join(args.review_dir, "review_manifest.csv")
    with open(manifest_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["group_id", "review_file", "raw_file"])
        writer.writeheader()
        writer.writerows(rows)

    playlist = os.path.join(args.review_dir, "review_playlist.m3u")
    playlist_abs = os.path.join(args.review_dir, "review_playlist_abs.m3u")
    with open(playlist, "w", encoding="utf-8") as f:
        f.write("#EXTM3U\n")
        for r in rows:
            f.write(f"{r['review_file'].replace(os.sep, '/')}\n")
    with open(playlist_abs, "w", encoding="utf-8") as f:
        f.write("#EXTM3U\n")
        for r in rows:
            abs_path = os.path.abspath(os.path.join(args.review_dir, r["review_file"]))
            f.write(f"{abs_path}\n")

    print(f"Prepared review files: {len(rows)}")
    print(f"Review dir: {args.review_dir}")
    print(f"Manifest: {manifest_csv}")
    print(f"Playlist: {playlist}")
    print(f"Absolute playlist: {playlist_abs}")


if __name__ == "__main__":
    main()
