import argparse
import json
import os
from typing import Dict, List

import requests


def parse_args():
    parser = argparse.ArgumentParser(description="Fetch source README/docs for semantics-guided labeling.")
    parser.add_argument("--catalog-json", required=True)
    parser.add_argument("--output-dir", default="server/artifacts/source_docs")
    parser.add_argument("--index-json", default="server/artifacts/source_docs/index.json")
    return parser.parse_args()


def load_catalog(path: str) -> List[Dict]:
    with open(path, "r", encoding="utf-8") as f:
        return list(json.load(f).get("sources", []))


def write_text(path: str, text: str):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def fetch_github_readme(source: Dict):
    owner = str(source["owner"])
    repo = str(source["repo"])
    download_url = ""
    readme_text = ""
    api = f"https://api.github.com/repos/{owner}/{repo}/readme"
    try:
        res = requests.get(api, timeout=20)
        res.raise_for_status()
        data = res.json()
        download_url = str(data.get("download_url", ""))
        if download_url:
            readme_text = requests.get(download_url, timeout=20).text
    except Exception:
        pass
    if not readme_text:
        raw_candidates = [
            f"https://raw.githubusercontent.com/{owner}/{repo}/main/README.md",
            f"https://raw.githubusercontent.com/{owner}/{repo}/master/README.md",
            f"https://raw.githubusercontent.com/{owner}/{repo}/main/readme.md",
            f"https://raw.githubusercontent.com/{owner}/{repo}/master/readme.md",
        ]
        for url in raw_candidates:
            try:
                r = requests.get(url, timeout=20)
                if r.status_code == 200 and r.text.strip():
                    download_url = url
                    readme_text = r.text
                    break
            except Exception:
                continue
    if not readme_text:
        raise RuntimeError("github readme fetch failed")
    return {
        "doc_type": "github_readme",
        "source_url": download_url,
        "content": readme_text,
    }


def fetch_zenodo_summary(source: Dict):
    record_id = str(source["record_id"])
    api = f"https://zenodo.org/api/records/{record_id}"
    res = requests.get(api, timeout=20)
    res.raise_for_status()
    data = res.json()
    md = data.get("metadata", {})
    title = str(md.get("title", ""))
    description = str(md.get("description", ""))
    files = [str(f.get("key", "")) for f in data.get("files", [])]
    content = "\n".join(
        [
            f"# {title}",
            "",
            "## Description",
            description,
            "",
            "## Files",
            *[f"- {k}" for k in files],
        ]
    )
    return {
        "doc_type": "zenodo_metadata",
        "source_url": f"https://zenodo.org/records/{record_id}",
        "content": content,
    }

def fetch_wikimedia_category_doc(source: Dict):
    category_title = str(source["category_title"])
    url = f"https://commons.wikimedia.org/wiki/{category_title.replace(' ', '_')}"
    content = "\n".join(
        [
            f"# {source.get('id', 'wikimedia_source')}",
            "",
            f"- category_title: {category_title}",
            f"- source_url: {url}",
            f"- fixed_intent: {source.get('fixed_intent', '')}",
            "",
            "This source uses Wikimedia Commons audio category listing.",
        ]
    )
    return {
        "doc_type": "wikimedia_category_doc",
        "source_url": url,
        "content": content,
    }


def main():
    args = parse_args()
    os.makedirs(args.output_dir, exist_ok=True)
    os.makedirs(os.path.dirname(args.index_json) or ".", exist_ok=True)
    sources = load_catalog(args.catalog_json)

    index = []
    for source in sources:
        sid = str(source.get("id", "unknown_source"))
        try:
            if source.get("type") == "github_folder":
                doc = fetch_github_readme(source)
            elif source.get("type") == "zenodo_record_file":
                doc = fetch_zenodo_summary(source)
            elif source.get("type") == "wikimedia_category_audio":
                doc = fetch_wikimedia_category_doc(source)
            else:
                raise RuntimeError("unsupported source type")

            local_file = os.path.join(args.output_dir, f"{sid}__source_doc.md")
            write_text(local_file, doc["content"])
            index.append(
                {
                    "source_id": sid,
                    "doc_type": doc["doc_type"],
                    "source_url": doc["source_url"],
                    "local_path": local_file,
                    "status": "ok",
                }
            )
            print(f"Fetched doc for {sid}: {local_file}")
        except Exception as e:
            index.append(
                {
                    "source_id": sid,
                    "doc_type": "unknown",
                    "source_url": str(source.get("url", "")),
                    "local_path": "",
                    "status": "failed",
                    "error": str(e),
                }
            )
            print(f"Failed doc for {sid}: {e}")

    with open(args.index_json, "w", encoding="utf-8") as f:
        json.dump({"docs": index}, f, ensure_ascii=False, indent=2)
    print(f"Doc index: {args.index_json}")


if __name__ == "__main__":
    main()
