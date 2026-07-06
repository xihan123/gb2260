from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "build" / "areas.sqlite"
AREA_FIELDS = ["code", "name", "level", "province", "city", "parent_code", "path", "status", "start_year", "end_year", "new_code"]
CHANGE_FIELDS = ["change_type", "year", "code", "name", "old_name", "new_name", "new_code", "source"]


def connect(path: Path) -> sqlite3.Connection:
    if not path.exists():
        raise FileNotFoundError(f"missing {path}; run scripts/fetch_sources.py and scripts/build_database.py first")
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def print_rows(rows: list[sqlite3.Row], fields: list[str]) -> None:
    if not rows:
        print("no rows")
        return
    print("\t".join(fields))
    for row in rows:
        print("\t".join("" if row[field] is None else str(row[field]) for field in fields))


def valid_filter(year: int) -> tuple[str, tuple[int, int]]:
    return "cast(start_year as integer) <= ? and (end_year = '' or cast(end_year as integer) > ?)", (year, year)


def cmd_code(conn: sqlite3.Connection, args) -> None:
    rows = conn.execute(
        """select code,name,level,province,city,parent_code,path,status,start_year,end_year,new_code
        from areas where code = ?
        order by case status when 'active' then 0 else 1 end, start_year, name""",
        (args.code,),
    ).fetchall()
    print_rows(rows, AREA_FIELDS)


def cmd_year(conn: sqlite3.Connection, args) -> None:
    first_where, first_params = valid_filter(args.year)
    where = [first_where]
    params: list[object] = list(first_params)
    if args.level:
        where.append("level = ?")
        params.append(args.level)
    if args.province:
        where.append("province = ?")
        params.append(args.province)
    sql = f"""select code,name,level,province,city,parent_code,path,status,start_year,end_year,new_code
    from areas where {' and '.join(where)} order by code limit ?"""
    params.append(args.limit)
    rows = conn.execute(sql, params).fetchall()
    print_rows(rows, AREA_FIELDS)


def cmd_children(conn: sqlite3.Connection, args) -> None:
    where = ["parent_code = ?"]
    params: list[object] = [args.code]
    if args.year is not None:
        year_where, year_params = valid_filter(args.year)
        where.append(year_where)
        params.extend(year_params)
    rows = conn.execute(
        f"""select code,name,level,province,city,parent_code,path,status,start_year,end_year,new_code
        from areas where {' and '.join(where)} order by code""",
        params,
    ).fetchall()
    print_rows(rows, AREA_FIELDS)


def cmd_changes(conn: sqlite3.Connection, args) -> None:
    rows = conn.execute(
        """select change_type,year,code,name,old_name,new_name,new_code,source
        from changes where code = ? or new_code = ? order by year, change_type""",
        (args.code, args.code),
    ).fetchall()
    print_rows(rows, CHANGE_FIELDS)


def cmd_history(conn: sqlite3.Connection, args) -> None:
    where = ["code = ?"]
    params: list[object] = [args.code]
    if args.source:
        where.append("source = ?")
        params.append(args.source)
    params.append(args.limit)
    rows = conn.execute(
        f"""select source,revision,code,name,level,parent_code,path,file
        from source_areas where {' and '.join(where)} order by source, revision limit ?""",
        params,
    ).fetchall()
    print_rows(rows, ["source", "revision", "code", "name", "level", "parent_code", "path", "file"])

def cmd_plate(conn: sqlite3.Connection, args) -> None:
    rows = conn.execute("select plate_code, region from plate_codes order by plate_code").fetchall()
    matched = []
    for row in rows:
        pattern = row["plate_code"]
        if pattern == args.prefix or re.fullmatch(pattern, args.prefix, flags=re.IGNORECASE):
            matched.append(row)
    print_rows(matched, ["plate_code", "region"])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Query the generated GB2260 database.")
    parser.add_argument("--db", type=Path, default=DB)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("code", help="query one administrative code")
    p.add_argument("code")
    p.set_defaults(func=cmd_code)

    p = sub.add_parser("year", help="list codes valid in a year")
    p.add_argument("year", type=int)
    p.add_argument("--level", choices=["province", "prefecture", "county"])
    p.add_argument("--province")
    p.add_argument("--limit", type=int, default=200)
    p.set_defaults(func=cmd_year)

    p = sub.add_parser("children", help="list child areas of a code")
    p.add_argument("code")
    p.add_argument("--year", type=int)
    p.set_defaults(func=cmd_children)

    p = sub.add_parser("changes", help="query lifecycle changes for a code")
    p.add_argument("code")
    p.set_defaults(func=cmd_changes)

    p = sub.add_parser("plate", help="query a vehicle plate prefix")
    p.add_argument("prefix")
    p.set_defaults(func=cmd_plate)

    p = sub.add_parser("history", help="query all historical source ownership records for a code")
    p.add_argument("code")
    p.add_argument("--source", choices=["gb", "stats", "mca", "areacodes"])
    p.add_argument("--limit", type=int, default=200)
    p.set_defaults(func=cmd_history)

    args = parser.parse_args(argv)
    try:
        with connect(args.db) as conn:
            args.func(conn, args)
    except Exception as exc:
        print(f"query failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

