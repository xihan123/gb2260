from __future__ import annotations

import argparse
import csv
import hashlib
import json
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime, UTC
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "data" / "build"
SITE_SRC = ROOT / "site" / "src"
SITE_PUBLIC = ROOT / "site" / "public"

DATA_FILES = {
    "areas.csv": ("CSV", "生命周期主表"),
    "areas.json": ("JSON", "按代码索引的结构化数据"),
    "areas.dat": ("DAT", "UTF-8 制表符分隔紧凑表"),
    "areas.sqlite": ("SQLite", "离线关系数据库"),
    "changes.csv": ("CSV", "新增、撤销、改名、旧新代码映射"),
    "versions.csv": ("CSV", "上游版本清单"),
    "plate_codes.csv": ("CSV", "车牌前缀映射"),
    "source_areas.csv": ("CSV", "GB2260 各来源版本快照"),
}

STATIC_FILE_SIZE_LIMIT = 25 * 1024 * 1024

SCHEMA = {
    "areas": {
        "code": "6 位行政区划代码",
        "name": "行政区划名称",
        "level": "province / prefecture / county",
        "province": "一级行政区名称",
        "city": "二级行政区名称，直辖市县级记录为直辖",
        "parent_code": "父级行政区划代码",
        "path": "省/市/县路径",
        "status": "active / retired",
        "start_year": "启用年份",
        "end_year": "变更或弃用年份",
        "new_code": "弃用后的承接代码",
        "source": "生命周期记录来源",
    },
    "changes": {
        "change_type": "created / retired / remapped / added / removed / renamed",
        "year": "发生年份",
        "code": "原代码或变化代码",
        "name": "名称",
        "old_name": "改名前名称",
        "new_name": "改名后名称",
        "new_code": "承接新代码",
        "source": "变化记录来源",
    },
    "plate_codes": {
        "plate_code": "车牌前缀或前缀模式",
        "region": "对应地区",
    },
    "source_areas": {
        "source": "gb / stats / mca / areacodes",
        "revision": "来源版本或年份",
        "code": "6 位行政区划代码",
        "name": "该版本中的名称",
        "level": "province / prefecture / county",
        "parent_code": "该版本中的父级代码",
        "path": "该版本中的所属路径",
        "file": "来源文件",
    },
}


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        return [{key: (value or "").strip() for key, value in row.items()} for row in csv.DictReader(fh)]


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def active_in_year(row: dict[str, str], year: int) -> bool:
    start = int(row["start_year"] or 0)
    end = int(row["end_year"] or 9999)
    return start <= year < end


def level_label(level: str) -> str:
    return {"province": "省级", "prefecture": "地级", "county": "县级"}.get(level, level)


def latest_year(versions: list[dict[str, str]], areas: list[dict[str, str]]) -> int:
    years = [
        int(row["revision"])
        for row in versions
        if row.get("source") == "areacodes" and row.get("revision", "").isdigit() and len(row["revision"]) == 4
    ]
    if years:
        return max(years)
    return max(int(row["start_year"] or 0) for row in areas)


def build_stats(areas: list[dict[str, str]], changes: list[dict[str, str]], latest: int) -> dict:
    years = range(min(int(row["start_year"]) for row in areas if row["start_year"]), latest + 1)
    active_counts = [{"year": year, "count": sum(1 for row in areas if active_in_year(row, year))} for year in years]

    current = [row for row in areas if active_in_year(row, latest)]
    province_counts = []
    for province in sorted({row["province"] for row in current if row["province"]}):
        province_counts.append(
            {
                "province": province,
                "count": sum(1 for row in current if row["province"] == province),
                "county_count": sum(1 for row in current if row["province"] == province and row["level"] == "county"),
            }
        )

    change_counts: dict[str, int] = {}
    for row in changes:
        if row["year"]:
            change_counts[row["year"]] = change_counts.get(row["year"], 0) + 1

    return {
        "active_counts": active_counts,
        "change_counts": [{"year": year, "count": change_counts[year]} for year in sorted(change_counts)],
        "province_counts": province_counts,
    }


def build_history(source_areas: list[dict[str, str]], history_dir: Path) -> list[dict[str, str]]:
    by_code: dict[str, list[dict[str, str]]] = {}
    for row in source_areas:
        code = row["code"]
        by_code.setdefault(code, []).append(
            {
                "source": row["source"],
                "revision": row["revision"],
                "code": code,
                "name": row["name"],
                "level": row["level"],
                "level_label": level_label(row["level"]),
                "parent_code": row["parent_code"],
                "path": row["path"],
                "file": row["file"],
            }
        )

    history_dir.mkdir(parents=True, exist_ok=True)
    index: list[dict[str, str]] = []
    for code, records in sorted(by_code.items()):
        records.sort(key=lambda row: (row["source"], row["revision"], row["code"]))
        names = sorted({row["name"] for row in records if row["name"]})
        sources = sorted({row["source"] for row in records if row["source"]})
        latest = records[-1]
        write_json(history_dir / f"{code}.json", {"code": code, "records": records})
        index.append(
            {
                "code": code,
                "names": " / ".join(names[:6]),
                "sources": ",".join(sources),
                "revision_count": str(len(records)),
                "latest_name": latest["name"],
                "latest_path": latest["path"],
            }
        )
    return index


def package_downloads(downloads: Path, version: str, files: list[Path]) -> Path:
    package = downloads / f"{version}.zip"
    with zipfile.ZipFile(package, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for path in files:
            zf.write(path, path.name)
    return package


def file_entry(path: Path, public_root: Path, title: str, kind: str, description: str) -> dict:
    rel = path.relative_to(public_root).as_posix()
    return {
        "title": title,
        "format": kind,
        "description": description,
        "path": rel,
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
    }


def can_publish_static_file(path: Path) -> bool:
    return path.stat().st_size <= STATIC_FILE_SIZE_LIMIT


def run_frontend_build() -> None:
    if not (ROOT / "package.json").exists():
        raise FileNotFoundError("missing package.json; cannot build frontend")
    npm = shutil.which("npm.cmd") or shutil.which("npm")
    if not npm:
        raise FileNotFoundError("npm executable not found")
    subprocess.run([npm, "run", "build"], cwd=ROOT, check=True)


def write_checksums(downloads: Path) -> Path:
    target = downloads / "checksums.txt"
    rows = (f"{sha256(path)}  {path.name}" for path in sorted(downloads.iterdir()) if path.is_file() and path != target)
    target.write_text("\n".join(rows) + "\n", encoding="utf-8")
    return target


def oversized_static_files(public_dir: Path) -> list[Path]:
    return [path for path in public_dir.rglob("*") if path.is_file() and not can_publish_static_file(path)]


def build_site(build_dir: Path, src_dir: Path, public_dir: Path, build_frontend: bool = True) -> dict:
    for name in DATA_FILES:
        if not (build_dir / name).exists():
            raise FileNotFoundError(f"missing {build_dir / name}; run scripts/build_database.py first")
    if not src_dir.exists():
        raise FileNotFoundError(f"missing site source directory: {src_dir}")

    if build_frontend:
        run_frontend_build()
    public_dir.mkdir(parents=True, exist_ok=True)
    (public_dir / ".nojekyll").write_text("", encoding="utf-8")

    api = public_dir / "api"
    downloads = public_dir / "downloads"
    area_dir = api / "areas"
    history_dir = api / "history"
    for generated_dir in (api, downloads):
        if generated_dir.exists():
            shutil.rmtree(generated_dir)
    downloads.mkdir(parents=True)

    areas = read_csv(build_dir / "areas.csv")
    changes = read_csv(build_dir / "changes.csv")
    versions = read_csv(build_dir / "versions.csv")
    plates = read_csv(build_dir / "plate_codes.csv")
    source_areas = read_csv(build_dir / "source_areas.csv")
    latest = latest_year(versions, areas)
    current = [row for row in areas if active_in_year(row, latest)]

    search_rows = [
        {
            "code": row["code"],
            "name": row["name"],
            "level": row["level"],
            "level_label": level_label(row["level"]),
            "province": row["province"],
            "city": row["city"],
            "parent_code": row["parent_code"],
            "path": row["path"],
            "status": row["status"],
            "start_year": row["start_year"],
            "end_year": row["end_year"],
            "new_code": row["new_code"],
        }
        for row in areas
    ]

    package_files = []
    file_entries = []
    for name, (kind, description) in DATA_FILES.items():
        source = build_dir / name
        package_files.append(source)
        if not can_publish_static_file(source):
            continue
        target = downloads / name
        shutil.copy2(source, target)
        file_entries.append(file_entry(target, public_dir, name, kind, description))

    content_hash = hashlib.sha256()
    for path in package_files:
        content_hash.update(sha256(path).encode("ascii"))
    version = f"gb2260-data-{latest}-{content_hash.hexdigest()[:8]}"
    package = package_downloads(downloads, version, package_files)
    checksums = write_checksums(downloads)
    file_entries.append(file_entry(package, public_dir, package.name, "ZIP", "完整数据包，含 SQLite 与来源版本快照"))
    file_entries.append(file_entry(checksums, public_dir, checksums.name, "TXT", "下载文件 SHA256 校验和"))

    province_codes = {row["code"] for row in areas if row["level"] == "province"}
    groups: dict[str, list[dict[str, str]]] = {}
    for row in search_rows:
        province_code = f"{row['code'][:2]}0000"
        if province_code not in province_codes:
            province_code = row["code"] if row["level"] == "province" else province_code
        groups.setdefault(province_code, []).append(row)
    for code, rows in groups.items():
        write_json(area_dir / f"{code}.json", {"province_code": code, "areas": rows})

    stats = build_stats(areas, changes, latest)
    history_index = build_history(source_areas, history_dir)
    summary = {
        "version": version,
        "generated_at": datetime.now(UTC).replace(microsecond=0).isoformat(),
        "latest_year": latest,
        "counts": {
            "areas": len(areas),
            "active_areas": len(current),
            "changes": len(changes),
            "versions": len(versions),
            "plate_codes": len(plates),
            "province_files": len(groups),
            "history_codes": len(history_index),
            "history_records": len(source_areas),
        },
        "sources": [
            {"name": "cn/GB2260", "url": "https://github.com/cn/GB2260"},
            {"name": "yescallop/areacodes", "url": "https://github.com/yescallop/areacodes"},
        ],
        "files": file_entries,
        "api": [
            "api/manifest.json",
            "api/latest.json",
            "api/search-index.json",
            "api/changes.json",
            "api/plates.json",
            "api/versions.json",
            "api/stats.json",
            "api/schema.json",
            "api/history-index.json",
            "api/areas/{province_code}.json",
            "api/history/{code}.json",
        ],
    }

    write_json(api / "manifest.json", summary)
    write_json(api / "latest.json", {"year": latest, "areas": current})
    write_json(api / "search-index.json", {"areas": search_rows})
    write_json(api / "changes.json", {"changes": changes})
    write_json(api / "plates.json", {"plates": plates})
    write_json(api / "versions.json", {"versions": versions})
    write_json(api / "stats.json", stats)
    write_json(api / "history-index.json", {"codes": history_index})
    write_json(api / "schema.json", SCHEMA)
    write_json(downloads / "manifest.json", summary)

    for path in (api / "manifest.json", api / "latest.json", api / "search-index.json"):
        json.loads(path.read_text(encoding="utf-8"))
    assert (public_dir / "index.html").exists(), "missing index.html"
    assert (downloads / "checksums.txt").exists(), "missing checksums"
    assert groups, "no province area files generated"
    assert (history_dir / "110101.json").exists(), "missing history file for 110101"
    too_large = oversized_static_files(public_dir)
    assert not too_large, f"static files exceed 25MiB: {', '.join(str(path.relative_to(public_dir)) for path in too_large)}"
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build the static open data website.")
    parser.add_argument("--build-dir", type=Path, default=BUILD)
    parser.add_argument("--src-dir", type=Path, default=SITE_SRC)
    parser.add_argument("--public-dir", type=Path, default=SITE_PUBLIC)
    parser.add_argument("--skip-frontend-build", action="store_true", help="refresh API/download files without running Vite")
    args = parser.parse_args(argv)
    try:
        manifest = build_site(args.build_dir, args.src_dir, args.public_dir, not args.skip_frontend_build)
    except Exception as exc:
        print(f"site build failed: {exc}", file=sys.stderr)
        return 1
    print(
        "site="
        f"{args.public_dir} version={manifest['version']} "
        f"areas={manifest['counts']['areas']} active={manifest['counts']['active_areas']} "
        f"files={len(manifest['files'])}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())



