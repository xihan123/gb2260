from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
UA = "gb2260-integrator/1.0"


def read_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def download(url: str, path: Path, force: bool = False) -> None:
    if path.exists() and not force:
        print(f"skip {path.relative_to(ROOT)}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    path.write_bytes(data)
    print(f"wrote {path.relative_to(ROOT)} ({len(data)} bytes)")
    time.sleep(0.05)


def github_contents(owner: str, repo: str, path: str, ref: str):
    url = f"https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref={ref}"
    return read_json(url)


def fetch_gb2260(force: bool) -> None:
    base = RAW / "gb2260"
    root_items = github_contents("cn", "GB2260", "", "develop")
    keep_root = {"README.md", "spec.md", "sources.tsv", "revisions.json"}
    for item in root_items:
        name = item["name"]
        if item["type"] == "file" and (name in keep_root or name.endswith(".tsv")):
            download(item["download_url"], base / name, force)

    for subdir in ("mca", "stats"):
        for item in github_contents("cn", "GB2260", subdir, "develop"):
            if item["type"] == "file" and item["name"].endswith(".tsv"):
                download(item["download_url"], base / subdir / item["name"], force)


def fetch_areacodes(force: bool) -> None:
    base = RAW / "areacodes"
    files = ("README.md", "LICENSE", "result.csv", "plate-codes.csv", "errata.md")
    for name in files:
        url = f"https://raw.githubusercontent.com/yescallop/areacodes/master/{name}"
        download(url, base / name, force)

    for item in github_contents("yescallop", "areacodes", "data", "master"):
        if item["type"] == "file" and item["name"].endswith(".txt"):
            download(item["download_url"], base / "data" / item["name"], force)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Fetch upstream GB2260 and areacodes data.")
    parser.add_argument("--force", action="store_true", help="download files even when they already exist")
    args = parser.parse_args(argv)

    try:
        fetch_gb2260(args.force)
        fetch_areacodes(args.force)
    except Exception as exc:
        print(f"fetch failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
