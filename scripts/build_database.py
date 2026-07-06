from __future__ import annotations

import argparse
import csv
import json
import re
import sqlite3
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "build"

AREA_FIELDS = [
    "code",
    "name",
    "level",
    "province",
    "city",
    "parent_code",
    "path",
    "status",
    "start_year",
    "end_year",
    "new_code",
    "source",
]
SOURCE_AREA_FIELDS = ["source", "revision", "code", "name", "level", "parent_code", "path", "file"]
CHANGE_FIELDS = ["change_type", "year", "code", "name", "old_name", "new_name", "new_code", "source"]
VERSION_FIELDS = ["source", "revision", "file"]
PLATE_FIELDS = ["plate_code", "region"]

LEVEL_MAP = {"省级": "province", "地级": "prefecture", "县级": "county"}
STATUS_MAP = {"在用": "active", "弃用": "retired"}


def clean(value) -> str:
    return "" if value is None else str(value).strip()


def level_from_code(code: str, raw_level: str = "") -> str:
    if raw_level in LEVEL_MAP:
        return LEVEL_MAP[raw_level]
    if code.endswith("0000"):
        return "province"
    if code.endswith("00"):
        return "prefecture"
    return "county"


def parent_for(code: str, level: str, code_set: set[str]) -> str:
    province = f"{code[:2]}0000"
    prefecture = f"{code[:4]}00"
    if level == "province":
        return ""
    if level == "prefecture":
        return province if province in code_set and province != code else ""
    if prefecture in code_set and prefecture != code:
        return prefecture
    return province if province in code_set and province != code else ""


def area_path(province: str, city: str, name: str) -> str:
    parts: list[str] = []
    for part in (province, city, name):
        part = clean(part)
        if not part or part == "直辖":
            continue
        if not parts or parts[-1] != part:
            parts.append(part)
    return "/".join(parts)


def read_areas(raw_dir: Path) -> list[dict[str, str]]:
    path = raw_dir / "areacodes" / "result.csv"
    if not path.exists():
        raise FileNotFoundError(f"missing {path}; run scripts/fetch_sources.py first")

    rows: list[dict[str, str]] = []
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        for src in reader:
            code = clean(src.get("代码"))
            if not re.fullmatch(r"\d{6}", code):
                continue
            name = clean(src.get("名称"))
            province = clean(src.get("一级行政区"))
            city = clean(src.get("二级行政区"))
            rows.append(
                {
                    "code": code,
                    "name": name,
                    "level": level_from_code(code, clean(src.get("级别"))),
                    "province": province,
                    "city": city,
                    "parent_code": "",
                    "path": area_path(province, city, name),
                    "status": STATUS_MAP.get(clean(src.get("状态")), clean(src.get("状态"))),
                    "start_year": clean(src.get("启用时间")),
                    "end_year": clean(src.get("变更/弃用时间")),
                    "new_code": clean(src.get("新代码")),
                    "source": "areacodes",
                }
            )

    code_set = {row["code"] for row in rows}
    for row in rows:
        row["parent_code"] = parent_for(row["code"], row["level"], code_set)
    return sorted(rows, key=lambda r: (r["code"], r["start_year"], r["end_year"], r["name"]))


def read_plate_codes(raw_dir: Path) -> list[dict[str, str]]:
    path = raw_dir / "areacodes" / "plate-codes.csv"
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        return [{"plate_code": clean(src.get("代码")), "region": clean(src.get("地区"))} for src in csv.DictReader(fh)]


def read_areacode_snapshots(raw_dir: Path) -> dict[int, dict[str, str]]:
    data_dir = raw_dir / "areacodes" / "data"
    snapshots: dict[int, dict[str, str]] = {}
    if not data_dir.exists():
        return snapshots
    for path in sorted(data_dir.glob("*.txt")):
        if not path.stem.isdigit():
            continue
        entries: dict[str, str] = {}
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if not line:
                continue
            code, name = line.split(maxsplit=1)
            if re.fullmatch(r"\d{6}", code):
                entries[code] = name.strip()
        snapshots[int(path.stem)] = entries
    return snapshots


def source_path(code: str, names: dict[str, str], code_set: set[str]) -> tuple[str, str]:
    level = level_from_code(code)
    parent = parent_for(code, level, code_set)
    parts = [names.get(code, "")]
    seen = {code}
    current = parent
    while current and current not in seen:
        seen.add(current)
        parts.append(names.get(current, ""))
        current = parent_for(current, level_from_code(current), code_set)
    return parent, "/".join(reversed([part for part in parts if part]))


def read_source_areas(raw_dir: Path) -> list[dict[str, str]]:
    base = raw_dir / "gb2260"
    rows: list[dict[str, str]] = []
    if base.exists():
        for path in sorted(base.rglob("*.tsv")):
            with path.open("r", encoding="utf-8-sig", newline="") as fh:
                reader = csv.DictReader(fh, delimiter="\t")
                items = [
                    {
                        "source": clean(src.get("Source")),
                        "revision": clean(src.get("Revision")),
                        "code": clean(src.get("Code")),
                        "name": clean(src.get("Name")),
                        "file": path.relative_to(raw_dir).as_posix(),
                    }
                    for src in reader
                    if re.fullmatch(r"\d{6}", clean(src.get("Code")))
                ]
            names = {item["code"]: item["name"] for item in items}
            code_set = set(names)
            for item in items:
                parent, path_text = source_path(item["code"], names, code_set)
                rows.append(
                    {
                        "source": item["source"],
                        "revision": item["revision"],
                        "code": item["code"],
                        "name": item["name"],
                        "level": level_from_code(item["code"]),
                        "parent_code": parent,
                        "path": path_text,
                        "file": item["file"],
                    }
                )
    for year, snapshot in read_areacode_snapshots(raw_dir).items():
        code_set = set(snapshot)
        for code, name in sorted(snapshot.items()):
            parent, path_text = source_path(code, snapshot, code_set)
            rows.append(
                {
                    "source": "areacodes",
                    "revision": str(year),
                    "code": code,
                    "name": name,
                    "level": level_from_code(code),
                    "parent_code": parent,
                    "path": path_text,
                    "file": f"areacodes/data/{year}.txt",
                }
            )
    return rows

def build_versions(raw_dir: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    revisions_path = raw_dir / "gb2260" / "revisions.json"
    if revisions_path.exists():
        revisions = json.loads(revisions_path.read_text(encoding="utf-8"))
        for source, values in revisions.items():
            for revision in values:
                file_path = f"gb2260/{revision}.tsv" if source == "gb" else f"gb2260/{source}/{revision}.tsv"
                rows.append({"source": source, "revision": revision, "file": file_path})
    data_dir = raw_dir / "areacodes" / "data"
    if data_dir.exists():
        for path in sorted(data_dir.glob("*.txt")):
            rows.append({"source": "areacodes", "revision": path.stem, "file": path.relative_to(raw_dir).as_posix()})
    for name in ("result.csv", "plate-codes.csv"):
        path = raw_dir / "areacodes" / name
        if path.exists():
            rows.append({"source": "areacodes", "revision": path.stem, "file": path.relative_to(raw_dir).as_posix()})
    return sorted(rows, key=lambda r: (r["source"], r["revision"], r["file"]))


def build_changes(areas: list[dict[str, str]], snapshots: dict[int, dict[str, str]]) -> list[dict[str, str]]:
    changes: list[dict[str, str]] = []
    seen: set[tuple[str, str, str, str, str, str]] = set()

    def add(change_type: str, year: str, code: str, name: str = "", old_name: str = "", new_name: str = "", new_code: str = "", source: str = "areacodes") -> None:
        key = (change_type, year, code, old_name, new_name, new_code)
        if key in seen:
            return
        seen.add(key)
        changes.append(
            {
                "change_type": change_type,
                "year": year,
                "code": code,
                "name": name,
                "old_name": old_name,
                "new_name": new_name,
                "new_code": new_code,
                "source": source,
            }
        )

    for row in areas:
        if row["start_year"]:
            add("created", row["start_year"], row["code"], name=row["name"])
        if row["end_year"]:
            add("retired", row["end_year"], row["code"], name=row["name"], new_code=row["new_code"])
        if row["new_code"]:
            add("remapped", row["end_year"], row["code"], name=row["name"], new_code=row["new_code"])

    years = sorted(snapshots)
    for prev_year, year in zip(years, years[1:]):
        prev = snapshots[prev_year]
        current = snapshots[year]
        for code in sorted(set(current) - set(prev)):
            add("added", str(year), code, name=current[code], source="areacodes-snapshot")
        for code in sorted(set(prev) - set(current)):
            add("removed", str(year), code, name=prev[code], source="areacodes-snapshot")
        for code in sorted(set(prev) & set(current)):
            if prev[code] != current[code]:
                add("renamed", str(year), code, old_name=prev[code], new_name=current[code], source="areacodes-snapshot")

    return sorted(changes, key=lambda r: (r["year"], r["change_type"], r["code"], r["new_code"]))


def write_csv(path: Path, rows: list[dict[str, str]], fields: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def write_dat(path: Path, rows: list[dict[str, str]], fields: list[str]) -> None:
    with path.open("w", encoding="utf-8", newline="") as fh:
        fh.write("\t".join(fields) + "\n")
        for row in rows:
            fh.write("\t".join(row.get(field, "").replace("\t", " ") for field in fields) + "\n")


def write_json(path: Path, rows: list[dict[str, str]]) -> None:
    by_code: dict[str, list[dict[str, str]]] = {}
    for row in rows:
        by_code.setdefault(row["code"], []).append(row)
    payload = {"areas": by_code}
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")


def write_sqlite(path: Path, areas, changes, versions, plates, source_areas) -> None:
    if path.exists():
        path.unlink()
    conn = sqlite3.connect(path)
    try:
        conn.execute(
            """create table areas (
            code text, name text, level text, province text, city text, parent_code text, path text,
            status text, start_year text, end_year text, new_code text, source text
            )"""
        )
        conn.execute(
            """create table changes (
            change_type text, year text, code text, name text, old_name text, new_name text, new_code text, source text
            )"""
        )
        conn.execute("create table versions (source text, revision text, file text)")
        conn.execute("create table plate_codes (plate_code text, region text)")
        conn.execute(
            """create table source_areas (
            source text, revision text, code text, name text, level text, parent_code text, path text, file text
            )"""
        )
        conn.executemany(f"insert into areas values ({','.join('?' for _ in AREA_FIELDS)})", [[row[f] for f in AREA_FIELDS] for row in areas])
        conn.executemany(f"insert into changes values ({','.join('?' for _ in CHANGE_FIELDS)})", [[row[f] for f in CHANGE_FIELDS] for row in changes])
        conn.executemany(f"insert into versions values ({','.join('?' for _ in VERSION_FIELDS)})", [[row[f] for f in VERSION_FIELDS] for row in versions])
        conn.executemany(f"insert into plate_codes values ({','.join('?' for _ in PLATE_FIELDS)})", [[row[f] for f in PLATE_FIELDS] for row in plates])
        conn.executemany(
            f"insert into source_areas values ({','.join('?' for _ in SOURCE_AREA_FIELDS)})",
            [[row[f] for f in SOURCE_AREA_FIELDS] for row in source_areas],
        )
        conn.execute("create index idx_areas_code on areas(code)")
        conn.execute("create index idx_areas_parent on areas(parent_code)")
        conn.execute("create index idx_areas_year on areas(start_year,end_year)")
        conn.execute("create index idx_changes_code on changes(code)")
        conn.execute("create index idx_changes_new_code on changes(new_code)")
        conn.execute("create index idx_source_areas_code on source_areas(source,revision,code)")
        conn.commit()
    finally:
        conn.close()


def self_check(out_dir: Path, areas: list[dict[str, str]], changes: list[dict[str, str]]) -> None:
    assert areas, "no areas parsed"
    assert all(re.fullmatch(r"\d{6}", row["code"]) for row in areas), "invalid area code"
    assert all(row["name"] for row in areas), "blank area name"
    by_code = {}
    for row in areas:
        by_code.setdefault(row["code"], []).append(row)
    assert "110000" in by_code, "missing Beijing province-level code"
    assert "110101" in by_code, "missing Dongcheng code"
    assert any(row["code"] == "110103" and row["new_code"] == "110101" for row in areas), "missing old-to-new mapping for 110103"
    assert changes, "no changes generated"
    conn = sqlite3.connect(out_dir / "areas.sqlite")
    try:
        count = conn.execute("select count(*) from areas where code = ?", ("110101",)).fetchone()[0]
        assert count >= 1, "sqlite smoke query failed"
    finally:
        conn.close()


def build(raw_dir: Path, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    areas = read_areas(raw_dir)
    plates = read_plate_codes(raw_dir)
    snapshots = read_areacode_snapshots(raw_dir)
    source_areas = read_source_areas(raw_dir)
    versions = build_versions(raw_dir)
    changes = build_changes(areas, snapshots)

    write_csv(out_dir / "areas.csv", areas, AREA_FIELDS)
    write_json(out_dir / "areas.json", areas)
    write_dat(out_dir / "areas.dat", areas, AREA_FIELDS)
    write_csv(out_dir / "changes.csv", changes, CHANGE_FIELDS)
    write_csv(out_dir / "versions.csv", versions, VERSION_FIELDS)
    write_csv(out_dir / "plate_codes.csv", plates, PLATE_FIELDS)
    write_csv(out_dir / "source_areas.csv", source_areas, SOURCE_AREA_FIELDS)
    write_sqlite(out_dir / "areas.sqlite", areas, changes, versions, plates, source_areas)
    self_check(out_dir, areas, changes)
    print(f"areas={len(areas)} changes={len(changes)} versions={len(versions)} source_areas={len(source_areas)} plates={len(plates)}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build CSV/JSON/DAT/SQLite databases from raw GB2260 data.")
    parser.add_argument("--raw-dir", type=Path, default=RAW)
    parser.add_argument("--out-dir", type=Path, default=OUT)
    args = parser.parse_args(argv)
    try:
        build(args.raw_dir, args.out_dir)
    except Exception as exc:
        print(f"build failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

