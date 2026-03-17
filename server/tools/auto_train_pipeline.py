import os
import sys
import subprocess
import argparse
import json
import shutil

# Define paths relative to project root (assuming script is run from project root)
SERVER_DIR = "server"
DATA_DIR = "data"
RAW_DIR = os.path.join(DATA_DIR, "raw")
TRAIN_DIR = os.path.join(DATA_DIR, "train")
ARTIFACTS_DIR = os.path.join(SERVER_DIR, "artifacts")
PSEUDO_LABEL_CSV = os.path.join(ARTIFACTS_DIR, "pseudo_labels.csv")
EVIDENCE_CSV = os.path.join(ARTIFACTS_DIR, "classification_evidence.csv")
SOURCE_DOCS_INDEX_JSON = os.path.join(ARTIFACTS_DIR, "source_docs", "index.json")
FETCH_REPORT_JSON = os.path.join(ARTIFACTS_DIR, "fetch_report.json")
GAP_REPORT_JSON = os.path.join(ARTIFACTS_DIR, "gap_report.json")
REVIEW_DIR = os.path.join(DATA_DIR, "review")
INTENT_CLASSES = ["attention_call", "food_request", "comfort_purr", "warning_hiss", "distress", "neutral_other"]

def run_command(cmd_list):
    print(f"Running: {' '.join(cmd_list)}")
    try:
        subprocess.check_call(cmd_list)
        return True
    except subprocess.CalledProcessError as e:
        print(f"Error running command: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description="Auto Train Pipeline: Download -> Label -> Train")
    parser.add_argument("--python-cmd", default=sys.executable, help="Python interpreter to use")
    parser.add_argument("--per-class", type=int, default=20, help="Required samples for each intent class")
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--clean-raw", action="store_true", help="Clean raw data directory before fetching")
    parser.add_argument("--max-per-source", type=int, default=120, help="Max files downloaded from each source")
    parser.add_argument("--prepare-review-only", action="store_true", help="Stop after generating review pack")
    args = parser.parse_args()
    
    python = args.python_cmd
    os.makedirs(ARTIFACTS_DIR, exist_ok=True)
    if args.clean_raw and os.path.exists(RAW_DIR):
        shutil.rmtree(RAW_DIR)
    
    print("=== Step 1: Fetch source documentation ===")
    if not run_command(
        [
            python,
            f"{SERVER_DIR}/tools/fetch_source_docs.py",
            "--catalog-json",
            f"{SERVER_DIR}/tools/source_catalog.json",
            "--output-dir",
            f"{SERVER_DIR}/artifacts/source_docs",
            "--index-json",
            SOURCE_DOCS_INDEX_JSON,
        ]
    ):
        print("Step 1 failed.")
        return

    print("=== Step 2: Download Sample Data ===")
    if not run_command(
        [
            python,
            f"{SERVER_DIR}/tools/fetch_open_data.py",
            "--output-dir",
            RAW_DIR,
            "--report-json",
            FETCH_REPORT_JSON,
            "--max-per-source",
            str(args.max_per_source),
        ]
    ):
        print("Step 2 failed.")
        return

    print("\n=== Step 3: Pseudo-Labeling (Weak Supervision) ===")
    if not run_command([python, f"{SERVER_DIR}/pseudo_label_dataset.py", "--input-dir", RAW_DIR, "--output-csv", PSEUDO_LABEL_CSV, "--min-cat-score", "0.05"]):
        print("Step 3 failed.")
        return

    print("\n=== Step 4: Multi-signal classification evidence ===")
    if not run_command(
        [
            python,
            f"{SERVER_DIR}/tools/classify_dataset.py",
            "--pseudo-csv",
            PSEUDO_LABEL_CSV,
            "--catalog-json",
            f"{SERVER_DIR}/tools/source_catalog.json",
            "--output-csv",
            EVIDENCE_CSV,
            "--source-doc-index-json",
            SOURCE_DOCS_INDEX_JSON,
        ]
    ):
        print("Step 4 failed.")
        return

    print("\n=== Step 5: Prepare review pack ===")
    if not run_command(
        [
            python,
            f"{SERVER_DIR}/tools/prepare_review_pack.py",
            "--raw-dir",
            RAW_DIR,
            "--review-dir",
            REVIEW_DIR,
            "--evidence-csv",
            EVIDENCE_CSV,
            "--per-group",
            "20",
        ]
    ):
        print("Step 5 failed.")
        return

    if args.prepare_review_only:
        print("\n=== Pipeline paused for manual review ===")
        print(f"Review dir: {REVIEW_DIR}")
        return

    print("\n=== Step 6: Build 6-class balanced dataset ===")
    if not run_command(
        [
            python,
            f"{SERVER_DIR}/tools/build_balanced_dataset.py",
            "--raw-dir",
            RAW_DIR,
            "--evidence-csv",
            EVIDENCE_CSV,
            "--output-dir",
            TRAIN_DIR,
            "--report-json",
            GAP_REPORT_JSON,
            "--per-class",
            str(args.per_class),
            "--max-groups-per-class",
            "8",
        ]
    ):
        print("Step 6 failed.")
        return

    with open(GAP_REPORT_JSON, "r", encoding="utf-8") as f:
        gap_report = json.load(f)
    if not gap_report.get("ready_for_training", False):
        print("Dataset gap detected. Stop training.")
        print(f"Gap report: {GAP_REPORT_JSON}")
        return

    print("\n=== Step 7: Train Intent Head ===")
    if not run_command(
        [
            python,
            f"{SERVER_DIR}/train_intent_head.py",
            "--data-dir",
            TRAIN_DIR,
            "--output-dir",
            ARTIFACTS_DIR,
            "--epochs",
            str(args.epochs),
            "--classes",
            *INTENT_CLASSES,
        ]
    ):
        print("Step 7 failed.")
        return

    print("\n=== Pipeline Complete ===")
    print(f"New model saved to: {os.path.join(ARTIFACTS_DIR, 'intent_head.keras')}")
    print("Restart your backend server to load the new model!")

if __name__ == "__main__":
    main()
