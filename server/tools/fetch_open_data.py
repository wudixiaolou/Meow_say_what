import os
import requests
import argparse
import json
import tempfile
import zipfile
import time
from typing import Dict, List, Tuple

AUDIO_EXT = (".wav", ".mp3", ".ogg", ".flac", ".m4a", ".oga", ".opus")
HTTP_HEADERS = {"User-Agent": "MeowLingoDatasetBot/1.0 (research; contact: local)"}


def download_file(url: str, dest_path: str):
    try:
        response = requests.get(url, timeout=30, headers=HTTP_HEADERS)
        response.raise_for_status()
        with open(dest_path, "wb") as f:
            f.write(response.content)
        print(f"Downloaded: {dest_path}")
        return True
    except Exception as e:
        print(f"Failed to download {url}: {e}")
        return str(e)


def list_repo_audio(owner: str, repo: str, path: str) -> List[Tuple[str, str]]:
    api = f"https://api.github.com/repos/{owner}/{repo}/contents/{path}"
    res = requests.get(api, timeout=20, headers=HTTP_HEADERS)
    res.raise_for_status()
    data = res.json()
    out = []
    for item in data:
        if item.get("type") != "file":
            continue
        name = str(item.get("name", ""))
        if not name.lower().endswith(AUDIO_EXT):
            continue
        out.append((name, str(item.get("download_url", ""))))
    return out


def load_catalog(path: str) -> List[Dict]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return list(data.get("sources", []))


def fetch_from_github(source: Dict, output_dir: str, max_files: int):
    source_id = str(source["id"])
    owner = str(source["owner"])
    repo = str(source["repo"])
    path = str(source["path"])
    try:
        files = list_repo_audio(owner, repo, path)
    except Exception:
        files = []
    if not files:
        return fetch_from_github_via_zip(source, output_dir, max_files)
    picked = files[:max_files]
    report = {"downloaded": [], "skipped_existing": [], "failed": []}
    for name, url in picked:
        if not url:
            report["failed"].append({"source": source_id, "file": name, "error": "missing download_url"})
            continue
        out_name = f"{source_id}__{name}"
        dest = os.path.join(output_dir, out_name)
        if os.path.exists(dest):
            report["skipped_existing"].append({"source": source_id, "file": out_name})
            continue
        result = download_file(url, dest)
        if result is True:
            report["downloaded"].append({"source": source_id, "file": out_name})
        else:
            report["failed"].append({"source": source_id, "file": out_name, "error": result})
    return report


def fetch_from_github_via_zip(source: Dict, output_dir: str, max_files: int):
    source_id = str(source["id"])
    owner = str(source["owner"])
    repo = str(source["repo"])
    path = str(source["path"])
    candidates = [
        f"https://codeload.github.com/{owner}/{repo}/zip/refs/heads/main",
        f"https://codeload.github.com/{owner}/{repo}/zip/refs/heads/master",
    ]
    report = {"downloaded": [], "skipped_existing": [], "failed": []}
    with tempfile.TemporaryDirectory() as td:
        zip_path = os.path.join(td, "repo.zip")
        got = False
        for url in candidates:
            result = download_file(url, zip_path)
            if result is True:
                got = True
                break
        if not got:
            report["failed"].append({"source": source_id, "file": "*", "error": "github_zip_download_failed"})
            return report
        picked = []
        with zipfile.ZipFile(zip_path, "r") as zf:
            want = path.strip("/").replace("\\", "/")
            for name in zf.namelist():
                lower = name.lower()
                if not lower.endswith(AUDIO_EXT):
                    continue
                parts = name.split("/", 1)
                rel = parts[1] if len(parts) > 1 else parts[0]
                rel_norm = rel.replace("\\", "/")
                if not (rel_norm == want or rel_norm.startswith(want + "/")):
                    continue
                base = os.path.basename(rel_norm)
                picked.append((base, name))
                if len(picked) >= max_files:
                    break
            for base, member_name in picked:
                out_name = f"{source_id}__{base}"
                dest = os.path.join(output_dir, out_name)
                if os.path.exists(dest):
                    report["skipped_existing"].append({"source": source_id, "file": out_name})
                    continue
                try:
                    with zf.open(member_name) as src, open(dest, "wb") as dst:
                        dst.write(src.read())
                    report["downloaded"].append({"source": source_id, "file": out_name})
                except Exception as e:
                    report["failed"].append({"source": source_id, "file": out_name, "error": str(e)})
    return report


def fetch_from_zenodo(source: Dict, output_dir: str, max_files: int):
    source_id = str(source["id"])
    record_id = str(source["record_id"])
    file_key = str(source["file_key"])
    meta_url = f"https://zenodo.org/api/records/{record_id}"
    meta = requests.get(meta_url, timeout=30, headers=HTTP_HEADERS)
    meta.raise_for_status()
    files = meta.json().get("files", [])
    chosen = None
    for f in files:
        if str(f.get("key")) == file_key:
            chosen = f
            break
    report = {"downloaded": [], "skipped_existing": [], "failed": []}
    if not chosen:
        report["failed"].append({"source": source_id, "file": file_key, "error": "file_key_not_found"})
        return report
    content_url = str(chosen.get("links", {}).get("self", ""))
    if not content_url:
        report["failed"].append({"source": source_id, "file": file_key, "error": "missing_content_url"})
        return report

    with tempfile.TemporaryDirectory() as td:
        zip_path = os.path.join(td, file_key)
        result = download_file(content_url, zip_path)
        if result is not True:
            report["failed"].append({"source": source_id, "file": file_key, "error": result})
            return report
        with zipfile.ZipFile(zip_path, "r") as zf:
            names = [n for n in zf.namelist() if n.lower().endswith(AUDIO_EXT)]
            names = names[:max_files]
            for name in names:
                base = os.path.basename(name)
                out_name = f"{source_id}__{base}"
                dest = os.path.join(output_dir, out_name)
                if os.path.exists(dest):
                    report["skipped_existing"].append({"source": source_id, "file": out_name})
                    continue
                try:
                    with zf.open(name) as src, open(dest, "wb") as dst:
                        dst.write(src.read())
                    report["downloaded"].append({"source": source_id, "file": out_name})
                except Exception as e:
                    report["failed"].append({"source": source_id, "file": out_name, "error": str(e)})
    return report


def list_wikimedia_category_audio(category_title: str, max_files: int) -> List[Tuple[str, str]]:
    api = "https://commons.wikimedia.org/w/api.php"
    params = {
        "action": "query",
        "list": "categorymembers",
        "cmtitle": category_title,
        "cmtype": "file",
        "cmlimit": "500",
        "format": "json",
    }
    res = requests.get(api, params=params, timeout=30, headers=HTTP_HEADERS)
    res.raise_for_status()
    members = res.json().get("query", {}).get("categorymembers", [])
    titles = [str(m.get("title", "")) for m in members if str(m.get("title", "")).startswith("File:")]
    titles = titles[:max_files]
    out = []
    for t in titles:
        q = {
            "action": "query",
            "prop": "imageinfo",
            "iiprop": "url",
            "titles": t,
            "format": "json",
        }
        rr = requests.get(api, params=q, timeout=30, headers=HTTP_HEADERS)
        rr.raise_for_status()
        pages = rr.json().get("query", {}).get("pages", {})
        for page in pages.values():
            ii = page.get("imageinfo", [])
            if not ii:
                continue
            url = str(ii[0].get("url", ""))
            if not url:
                continue
            name = str(t.split("File:", 1)[1])
            if name.lower().endswith(AUDIO_EXT):
                out.append((name, url))
    return out


def fetch_from_wikimedia_category(source: Dict, output_dir: str, max_files: int):
    source_id = str(source["id"])
    category_title = str(source["category_title"])
    files = list_wikimedia_category_audio(category_title, max_files)
    report = {"downloaded": [], "skipped_existing": [], "failed": []}
    for name, url in files:
        out_name = f"{source_id}__{name}"
        dest = os.path.join(output_dir, out_name)
        if os.path.exists(dest):
            report["skipped_existing"].append({"source": source_id, "file": out_name})
            continue
        if url.startswith("zipmember://"):
            report["failed"].append({"source": source_id, "file": out_name, "error": "zipmember_url_not_supported_here"})
            continue
        result = download_file(url, dest)
        if result is True:
            report["downloaded"].append({"source": source_id, "file": out_name})
        else:
            report["failed"].append({"source": source_id, "file": out_name, "error": result})
        time.sleep(1.2)
    return report


def main():
    parser = argparse.ArgumentParser(description="Download curated cat audio from trusted open sources.")
    parser.add_argument("--output-dir", default="data/raw", help="Directory to save files.")
    parser.add_argument("--catalog-json", default="server/tools/source_catalog.json", help="Source catalog path.")
    parser.add_argument("--max-per-source", type=int, default=120, help="Max files to fetch for each source.")
    parser.add_argument("--report-json", default="server/artifacts/fetch_report.json", help="Fetch report path.")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    os.makedirs(os.path.dirname(args.report_json) or ".", exist_ok=True)

    report = {"downloaded": [], "skipped_existing": [], "failed": [], "sources": []}
    sources = load_catalog(args.catalog_json)
    for source in sources:
        source_id = str(source.get("id", "unknown"))
        source_type = str(source.get("type", "unknown"))
        source_meta = {
            "id": source_id,
            "type": source_type,
            "quality": source.get("quality", ""),
            "license": source.get("license", ""),
            "url": source.get("url", ""),
        }
        report["sources"].append(source_meta)
        try:
            if source_type == "github_folder":
                partial = fetch_from_github(source, args.output_dir, args.max_per_source)
            elif source_type == "zenodo_record_file":
                partial = fetch_from_zenodo(source, args.output_dir, args.max_per_source)
            elif source_type == "wikimedia_category_audio":
                partial = fetch_from_wikimedia_category(source, args.output_dir, args.max_per_source)
            else:
                partial = {"downloaded": [], "skipped_existing": [], "failed": [{"source": source_id, "file": "*", "error": "unsupported_source_type"}]}
        except Exception as e:
            partial = {"downloaded": [], "skipped_existing": [], "failed": [{"source": source_id, "file": "*", "error": str(e)}]}
        report["downloaded"].extend(partial["downloaded"])
        report["skipped_existing"].extend(partial["skipped_existing"])
        report["failed"].extend(partial["failed"])

    with open(args.report_json, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"Downloaded: {len(report['downloaded'])}")
    print(f"Skipped existing: {len(report['skipped_existing'])}")
    print(f"Failed: {len(report['failed'])}")
    print(f"Report: {args.report_json}")

if __name__ == "__main__":
    main()
