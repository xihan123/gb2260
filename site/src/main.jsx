import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Fuse from "fuse.js";
import { Copy, Download, ExternalLink, RotateCcw, Search } from "lucide-react";

const numberFormat = new Intl.NumberFormat("zh-CN");
const levelLabels = { province: "省级", prefecture: "地级", county: "县级" };
const statusLabels = { active: "在用", retired: "弃用" };
const sourceLabels = { areacodes: "areacodes", gb: "GB", stats: "统计", mca: "民政部" };

function fetchJson(path) {
  return fetch(path).then((response) => {
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    return response.json();
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units.shift();
  while (value >= 1024 && units.length) {
    value /= 1024;
    unit = units.shift();
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

function levelName(level) {
  return levelLabels[level] || level || "-";
}

function statusName(status) {
  return statusLabels[status] || status || "-";
}

function activeInYear(row, year) {
  const start = Number(row.start_year || 0);
  const end = Number(row.end_year || 9999);
  return start <= year && year < end;
}

function yearRange(row) {
  return `${row.start_year || "-"}${row.end_year ? `-${row.end_year}` : "-"}`;
}

function parseRemapTargets(value) {
  return [...String(value || "").matchAll(/(\d{6})(?:\[(\d{4})\])?/g)].map(([, code, year = ""]) => ({ code, year }));
}

function currentBaseHref() {
  return new URL(".", window.location.href).href;
}

function endpointUrl(baseHref, endpoint) {
  return new URL(endpoint, baseHref).href;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-999px";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function uniqueProvinceRows(areas) {
  const seen = new Set();
  return areas
    .filter((row) => row.level === "province")
    .filter((row) => {
      if (seen.has(row.code)) return false;
      seen.add(row.code);
      return true;
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

function matchesAreaFilters(row, filters) {
  if (filters.year && !activeInYear(row, Number(filters.year))) return false;
  if (filters.level && row.level !== filters.level) return false;
  if (filters.province && row.province !== filters.province) return false;
  if (filters.status && row.status !== filters.status) return false;
  if (filters.source && row.source !== filters.source) return false;
  return true;
}

function matchesHistoryFilters(row, filters) {
  if (!filters.source) return true;
  return String(row.sources || "").split(",").includes(filters.source);
}

function changeTypeName(type) {
  return {
    created: "创建",
    retired: "弃用",
    remapped: "映射",
    added: "新增",
    removed: "移除",
    renamed: "改名",
  }[type] || type || "-";
}

function renderPlainValue(row, field) {
  if (field === "status") return statusName(row[field]);
  if (field === "level") return levelName(row[field]);
  if (field === "change_type") return changeTypeName(row[field]);
  if (field === "source") return sourceLabels[row[field]] || row[field] || "-";
  if (field === "bytes") return formatBytes(Number(row[field] || 0));
  return row[field] || "-";
}

function App() {
  const [payload, setPayload] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({ year: "", level: "", province: "", status: "", source: "" });
  const [selectedCode, setSelectedCode] = useState("110101");
  const [historySource, setHistorySource] = useState("");
  const [historyRecords, setHistoryRecords] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const historyCache = useRef(new Map());

  useEffect(() => {
    let ignore = false;
    Promise.all([
      fetchJson("api/manifest.json"),
      fetchJson("api/search-index.json"),
      fetchJson("api/history-index.json"),
      fetchJson("api/changes.json"),
      fetchJson("api/plates.json"),
      fetchJson("api/versions.json"),
      fetchJson("api/stats.json"),
    ])
      .then(([manifest, searchIndex, historyIndex, changes, plates, versions, stats]) => {
        if (ignore) return;
        setPayload({
          manifest,
          areas: searchIndex.areas || [],
          historyCodes: historyIndex.codes || [],
          changes: changes.changes || [],
          plates: plates.plates || [],
          versions: versions.versions || [],
          stats,
        });
      })
      .catch((error) => {
        if (!ignore) setLoadError(error);
      });
    return () => {
      ignore = true;
    };
  }, []);

  const loadHistory = useCallback(async (code) => {
    if (!/^\d{6}$/.test(code)) return [];
    if (historyCache.current.has(code)) return historyCache.current.get(code);
    try {
      const data = await fetchJson(`api/history/${code}.json`);
      const records = data.records || [];
      historyCache.current.set(code, records);
      return records;
    } catch {
      historyCache.current.set(code, []);
      return [];
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    setHistoryLoading(true);
    loadHistory(selectedCode).then((records) => {
      if (ignore) return;
      setHistoryRecords(records);
      setHistoryLoading(false);
    });
    return () => {
      ignore = true;
    };
  }, [loadHistory, selectedCode]);

  const years = useMemo(() => payload?.stats?.active_counts?.map((row) => Number(row.year)) || [], [payload]);
  const latestYear = Number(payload?.manifest?.latest_year || years.at(-1) || 2025);
  const provinces = useMemo(() => uniqueProvinceRows(payload?.areas || []), [payload]);

  const searchDocs = useMemo(() => {
    if (!payload) return [];
    const areaDocs = payload.areas.map((row, index) => ({
      kind: "area",
      id: `area-${index}`,
      code: row.code,
      name: row.name,
      names: row.name,
      path: row.path,
      province: row.province,
      city: row.city,
      source: row.source,
      new_code: row.new_code,
      row,
    }));
    const historyDocs = payload.historyCodes.map((row) => ({
      kind: "history",
      id: `history-${row.code}`,
      code: row.code,
      name: row.latest_name,
      names: row.names,
      path: row.latest_path,
      source: row.sources,
      row,
    }));
    return [...areaDocs, ...historyDocs];
  }, [payload]);

  const fuse = useMemo(() => {
    return new Fuse(searchDocs, {
      includeScore: true,
      ignoreLocation: true,
      threshold: 0.35,
      keys: [
        { name: "code", weight: 5 },
        { name: "name", weight: 4 },
        { name: "names", weight: 3 },
        { name: "new_code", weight: 2.5 },
        { name: "path", weight: 2 },
        { name: "province", weight: 1.5 },
        { name: "city", weight: 1 },
        { name: "source", weight: 1 },
      ],
    });
  }, [searchDocs]);

  const results = useMemo(() => {
    if (!payload) return { areas: [], history: [] };
    const trimmed = query.trim();
    if (trimmed) {
      const docs = fuse.search(trimmed).map((result) => result.item);
      const areas = docs
        .filter((doc) => doc.kind === "area")
        .map((doc) => doc.row)
        .filter((row) => matchesAreaFilters(row, filters));
      const history = docs
        .filter((doc) => doc.kind === "history")
        .map((doc) => doc.row)
        .filter((row) => matchesHistoryFilters(row, filters));
      return { areas, history };
    }

    const hasFilters = filters.year || filters.level || filters.province || filters.status || filters.source;
    const baseRows = hasFilters ? payload.areas.filter((row) => matchesAreaFilters(row, filters)) : payload.areas.filter((row) => activeInYear(row, latestYear));
    return { areas: baseRows.sort((a, b) => a.code.localeCompare(b.code)), history: [] };
  }, [filters, fuse, latestYear, payload, query]);

  const selectedRecords = useMemo(() => {
    return (payload?.areas || []).filter((row) => row.code === selectedCode).sort((a, b) => `${a.start_year}`.localeCompare(`${b.start_year}`));
  }, [payload, selectedCode]);

  const selectedHistoryMeta = useMemo(() => {
    return (payload?.historyCodes || []).find((row) => row.code === selectedCode);
  }, [payload, selectedCode]);

  const selectedPrimary = useMemo(() => {
    return (
      selectedRecords.find((row) => activeInYear(row, latestYear)) ||
      selectedRecords[selectedRecords.length - 1] || {
        code: selectedCode,
        name: selectedHistoryMeta?.latest_name || selectedCode,
        level: "",
        path: selectedHistoryMeta?.latest_path || "",
        status: "",
        start_year: "",
        end_year: "",
        new_code: "",
      }
    );
  }, [latestYear, selectedCode, selectedHistoryMeta, selectedRecords]);

  const detailChildren = useMemo(() => {
    const year = Number(filters.year || latestYear);
    return (payload?.areas || [])
      .filter((row) => row.parent_code === selectedCode && activeInYear(row, year))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [filters.year, latestYear, payload, selectedCode]);

  const detailChanges = useMemo(() => {
    return (payload?.changes || []).filter((row) => {
      if (row.code === selectedCode) return true;
      return parseRemapTargets(row.new_code).some((target) => target.code === selectedCode);
    });
  }, [payload, selectedCode]);

  if (loadError) return <ErrorScreen message={loadError.message} />;
  if (!payload) return <LoadingScreen />;

  return (
    <>
      <Header manifest={payload.manifest} />
      <main>
        <Summary manifest={payload.manifest} />
        <Explorer
          areas={results.areas}
          history={results.history}
          filters={filters}
          historySource={historySource}
          latestYear={latestYear}
          provinces={provinces}
          query={query}
          selectedCode={selectedCode}
          selectedPrimary={selectedPrimary}
          selectedRecords={selectedRecords}
          detailChildren={detailChildren}
          detailChanges={detailChanges}
          historyRecords={historyRecords}
          historyLoading={historyLoading}
          years={years}
          onFilterChange={setFilters}
          onHistorySourceChange={setHistorySource}
          onQueryChange={setQuery}
          onReset={() => {
            setQuery("");
            setFilters({ year: "", level: "", province: "", status: "", source: "" });
          }}
          onSelectCode={setSelectedCode}
        />
        <Tools areas={payload.areas} changes={payload.changes} latestYear={latestYear} plates={payload.plates} provinces={provinces} years={years} onSelectCode={setSelectedCode} />
        <ApiDocs manifest={payload.manifest} selectedCode={selectedCode} provinces={provinces} />
        <Downloads manifest={payload.manifest} />
        <Versions versions={payload.versions} />
      </main>
      <footer>
        <span>GB2260 Open Data</span>
        <span>生成时间 {payload.manifest.generated_at}</span>
      </footer>
    </>
  );
}

function Header({ manifest }) {
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">GB2260 / areacodes</p>
        <h1>行政区划开放数据工作台</h1>
        <p className="lead">县级以上行政区划代码、历史沿革、版本快照、车牌前缀映射，支持浏览器端检索和静态 API 快测。</p>
      </div>
      <nav className="nav" aria-label="页面导航">
        <a href="#search">检索</a>
        <a href="#tools">工具</a>
        <a href="#api">API</a>
        <a href="#downloads">下载</a>
      </nav>
      <div className="version-pill">{manifest.version}</div>
    </header>
  );
}

function Summary({ manifest }) {
  const stats = [
    ["最新年份", manifest.latest_year],
    ["生命周期记录", numberFormat.format(manifest.counts.areas)],
    ["当前有效", numberFormat.format(manifest.counts.active_areas)],
    ["历史版本记录", numberFormat.format(manifest.counts.history_records)],
    ["车牌映射", numberFormat.format(manifest.counts.plate_codes)],
  ];
  return (
    <section className="band overview" aria-labelledby="overview-title">
      <div className="section-head">
        <div>
          <p className="eyebrow">Data Release</p>
          <h2 id="overview-title">数据概览</h2>
        </div>
      </div>
      <div className="stats-grid">
        {stats.map(([label, value]) => (
          <article className="stat-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </div>
    </section>
  );
}

function Explorer(props) {
  const shownAreas = props.areas.slice(0, 180);
  const shownHistory = props.history.slice(0, 80);
  const total = props.areas.length + props.history.length;
  return (
    <section className="band" id="search" aria-labelledby="search-title">
      <div className="section-head">
        <div>
          <p className="eyebrow">Search</p>
          <h2 id="search-title">核心数据检索</h2>
        </div>
        <span className="muted">显示 {numberFormat.format(shownAreas.length + shownHistory.length)} / {numberFormat.format(total)} 条</span>
      </div>
      <div className="searchbar">
        <label className="wide-field">
          <span>代码、名称、旧名称、路径、新代码</span>
          <div className="input-with-icon">
            <Search size={17} aria-hidden="true" />
            <input value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} type="search" placeholder="110101 / 崇文区 / 滨海新区 / 130108" />
          </div>
        </label>
        <FilterSelect label="年份" value={props.filters.year} onChange={(year) => props.onFilterChange({ ...props.filters, year })}>
          <option value="">全部年份</option>
          {props.years.map((year) => <option key={year} value={year}>{year}</option>)}
        </FilterSelect>
        <FilterSelect label="层级" value={props.filters.level} onChange={(level) => props.onFilterChange({ ...props.filters, level })}>
          <option value="">全部</option>
          <option value="province">省级</option>
          <option value="prefecture">地级</option>
          <option value="county">县级</option>
        </FilterSelect>
        <FilterSelect label="省份" value={props.filters.province} onChange={(province) => props.onFilterChange({ ...props.filters, province })}>
          <option value="">全部</option>
          {props.provinces.map((row) => <option key={row.code} value={row.name}>{row.name}</option>)}
        </FilterSelect>
        <FilterSelect label="状态" value={props.filters.status} onChange={(status) => props.onFilterChange({ ...props.filters, status })}>
          <option value="">全部</option>
          <option value="active">在用</option>
          <option value="retired">弃用</option>
        </FilterSelect>
        <FilterSelect label="来源" value={props.filters.source} onChange={(source) => props.onFilterChange({ ...props.filters, source })}>
          <option value="">全部</option>
          <option value="areacodes">areacodes</option>
          <option value="gb">GB</option>
          <option value="stats">统计</option>
          <option value="mca">民政部</option>
        </FilterSelect>
        <button className="ghost icon-button" type="button" onClick={props.onReset} title="重置检索条件">
          <RotateCcw size={17} aria-hidden="true" />
          重置
        </button>
      </div>

      <div className="workspace">
        <section className="results-panel" aria-label="检索结果">
          <ResultGroup title="生命周期记录" count={props.areas.length}>
            {shownAreas.map((row, index) => (
              <AreaResult key={`${row.code}-${row.start_year}-${row.end_year}-${index}`} row={row} selected={row.code === props.selectedCode} onSelect={props.onSelectCode} />
            ))}
          </ResultGroup>
          <ResultGroup title="历史来源记录" count={props.history.length}>
            {shownHistory.map((row) => (
              <HistoryResult key={row.code} row={row} selected={row.code === props.selectedCode} onSelect={props.onSelectCode} />
            ))}
          </ResultGroup>
        </section>
        <DetailPanel {...props} />
      </div>
    </section>
  );
}

function FilterSelect({ label, value, onChange, children }) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>{children}</select>
    </label>
  );
}

function ResultGroup({ title, count, children }) {
  return (
    <div className="result-group">
      <div className="result-group-head">
        <h3>{title}</h3>
        <span>{numberFormat.format(count)}</span>
      </div>
      <div className="result-list">{count ? children : <p className="empty">无匹配记录</p>}</div>
    </div>
  );
}

function AreaResult({ row, selected, onSelect }) {
  return (
    <button className={`result-item ${selected ? "selected" : ""}`} type="button" onClick={() => onSelect(row.code)}>
      <span className="result-code"><code>{row.code}</code><StatusBadge status={row.status} /></span>
      <strong>{row.name}</strong>
      <span>{levelName(row.level)} · {yearRange(row)}</span>
      <small>{row.path || row.province || "-"}</small>
    </button>
  );
}

function HistoryResult({ row, selected, onSelect }) {
  return (
    <button className={`result-item history ${selected ? "selected" : ""}`} type="button" onClick={() => onSelect(row.code)}>
      <span className="result-code"><code>{row.code}</code><span className="status neutral">历史</span></span>
      <strong>{row.latest_name || row.names}</strong>
      <span>{row.sources || "-"} · {numberFormat.format(Number(row.revision_count || 0))} 条版本</span>
      <small>{row.names || row.latest_path || "-"}</small>
    </button>
  );
}

function DetailPanel({ selectedCode, selectedPrimary, selectedRecords, detailChildren, detailChanges, historyRecords, historyLoading, historySource, latestYear, filters, onHistorySourceChange, onSelectCode }) {
  const historyRows = historySource ? historyRecords.filter((row) => row.source === historySource) : historyRecords;
  const remaps = parseRemapTargets(selectedPrimary.new_code);
  const childYear = filters.year || latestYear;
  return (
    <aside className="detail-panel" aria-label="记录详情">
      <div className="detail-title">
        <div>
          <h3>{selectedPrimary.name || selectedCode}</h3>
          <p><code>{selectedCode}</code></p>
        </div>
        {selectedPrimary.status && <StatusBadge status={selectedPrimary.status} />}
      </div>
      <dl className="detail-list">
        <dt>层级</dt><dd>{levelName(selectedPrimary.level)}</dd>
        <dt>路径</dt><dd>{selectedPrimary.path || "-"}</dd>
        <dt>启用</dt><dd>{selectedPrimary.start_year || "-"}</dd>
        <dt>弃用</dt><dd>{selectedPrimary.end_year || "-"}</dd>
      </dl>
      {remaps.length > 0 && (
        <section className="detail-section">
          <h4>承接代码</h4>
          <div className="chip-row">
            {remaps.map((target) => (
              <button className="chip" type="button" key={`${target.code}-${target.year}`} onClick={() => onSelectCode(target.code)}>
                {target.code}{target.year ? ` · ${target.year}` : ""}
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="detail-section">
        <h4>生命周期</h4>
        <DataTable rows={selectedRecords} columns={[["code", "代码"], ["name", "名称"], ["status", "状态"], ["start_year", "启用"], ["end_year", "弃用"], ["new_code", "新代码"]]} onSelectCode={onSelectCode} empty="生命周期主表未收录该代码" />
      </section>
      <section className="detail-section">
        <h4>下级区划 {childYear}</h4>
        <DataTable rows={detailChildren} columns={[["code", "代码"], ["name", "名称"], ["level", "层级"], ["status", "状态"]]} onSelectCode={onSelectCode} limit={28} empty="无下级区划" />
      </section>
      <section className="detail-section">
        <h4>沿革变化</h4>
        <DataTable rows={detailChanges} columns={[["change_type", "类型"], ["year", "年份"], ["code", "代码"], ["name", "名称"], ["old_name", "旧名"], ["new_name", "新名"], ["new_code", "新代码"]]} onSelectCode={onSelectCode} limit={18} empty="无沿革记录" />
      </section>
      <section className="detail-section">
        <div className="section-line-head">
          <h4>历史版本归属</h4>
          <select value={historySource} onChange={(event) => onHistorySourceChange(event.target.value)}>
            <option value="">全部来源</option>
            <option value="areacodes">areacodes</option>
            <option value="gb">GB</option>
            <option value="stats">统计</option>
            <option value="mca">民政部</option>
          </select>
        </div>
        {historyLoading ? <p className="muted">正在加载历史版本...</p> : <DataTable rows={historyRows} columns={[["source", "来源"], ["revision", "版本"], ["name", "名称"], ["level", "层级"], ["path", "路径"], ["file", "文件"]]} limit={80} empty="未找到历史版本归属" />}
      </section>
    </aside>
  );
}

function StatusBadge({ status }) {
  return <span className={`status ${status || "neutral"}`}>{statusName(status)}</span>;
}

function DataTable({ rows, columns, limit = 12, empty = "无记录", onSelectCode }) {
  if (!rows.length) return <p className="empty">{empty}</p>;
  const shown = rows.slice(0, limit);
  return (
    <div className="table-wrap compact-table">
      <table>
        <thead>
          <tr>{columns.map(([field, label]) => <th key={field}>{label}</th>)}</tr>
        </thead>
        <tbody>
          {shown.map((row, rowIndex) => (
            <tr key={`${row.code || row.title || row.name || row.revision}-${rowIndex}`}>
              {columns.map(([field]) => <td key={field}>{renderCell(row, field, onSelectCode)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > limit && <p className="table-note">仅显示前 {limit} 条，共 {numberFormat.format(rows.length)} 条</p>}
    </div>
  );
}

function renderCell(row, field, onSelectCode) {
  if (field === "status") return <StatusBadge status={row[field]} />;
  if (field === "path" && row[field]?.startsWith("downloads/")) return <a href={row[field]}>下载</a>;
  if (field === "sha256") return <span className="sha">{row[field]}</span>;
  if (field === "code" && /^\d{6}$/.test(row[field] || "") && onSelectCode) {
    return <button className="link-button" type="button" onClick={() => onSelectCode(row[field])}>{row[field]}</button>;
  }
  if (field === "new_code") {
    const targets = parseRemapTargets(row[field]);
    if (targets.length && onSelectCode) {
      return <span className="inline-links">{targets.map((target) => <button key={`${target.code}-${target.year}`} className="link-button" type="button" onClick={() => onSelectCode(target.code)}>{target.code}{target.year ? `[${target.year}]` : ""}</button>)}</span>;
    }
  }
  return renderPlainValue(row, field);
}

function Tools({ areas, changes, latestYear, plates, provinces, years, onSelectCode }) {
  return (
    <section className="band tools" id="tools" aria-labelledby="tools-title">
      <div className="section-head">
        <div>
          <p className="eyebrow">Tools</p>
          <h2 id="tools-title">常用数据工具</h2>
        </div>
      </div>
      <div className="tool-grid">
        <BrowsePanel areas={areas} latestYear={latestYear} provinces={provinces} years={years} onSelectCode={onSelectCode} />
        <ComparePanel areas={areas} latestYear={latestYear} provinces={provinces} years={years} onSelectCode={onSelectCode} />
        <PlatePanel plates={plates} />
        <ChangePanel changes={changes} years={years} onSelectCode={onSelectCode} />
      </div>
    </section>
  );
}

function BrowsePanel({ areas, latestYear, provinces, years, onSelectCode }) {
  const [provinceCode, setProvinceCode] = useState(provinces[0]?.code || "110000");
  const [year, setYear] = useState(String(latestYear));
  useEffect(() => {
    if (!provinceCode && provinces[0]) setProvinceCode(provinces[0].code);
  }, [provinceCode, provinces]);
  const rows = useMemo(() => {
    const prefix = provinceCode.slice(0, 2);
    return areas.filter((row) => row.code.startsWith(prefix) && activeInYear(row, Number(year))).sort((a, b) => a.code.localeCompare(b.code));
  }, [areas, provinceCode, year]);
  return (
    <section className="tool-panel">
      <h3>层级浏览</h3>
      <div className="inline-controls two">
        <select value={provinceCode} onChange={(event) => setProvinceCode(event.target.value)}>{provinces.map((row) => <option key={row.code} value={row.code}>{row.name}</option>)}</select>
        <select value={year} onChange={(event) => setYear(event.target.value)}>{years.map((item) => <option key={item} value={item}>{item}</option>)}</select>
      </div>
      <div className="tree-list">
        {rows.map((row) => <button className={`tree-item ${row.level}`} type="button" key={`${row.code}-${row.start_year}`} onClick={() => onSelectCode(row.code)}><code>{row.code}</code><span>{row.name}</span><small>{levelName(row.level)}</small></button>)}
      </div>
    </section>
  );
}

function ComparePanel({ areas, latestYear, provinces, years, onSelectCode }) {
  const [fromYear, setFromYear] = useState(String(latestYear - 1));
  const [toYear, setToYear] = useState(String(latestYear));
  const [province, setProvince] = useState("");
  const output = useMemo(() => {
    const inProvince = (row) => !province || row.province === province;
    const from = new Map(areas.filter((row) => inProvince(row) && activeInYear(row, Number(fromYear))).map((row) => [row.code, row]));
    const to = new Map(areas.filter((row) => inProvince(row) && activeInYear(row, Number(toYear))).map((row) => [row.code, row]));
    const added = [];
    const removed = [];
    const renamed = [];
    for (const [code, row] of to) {
      if (!from.has(code)) added.push(row);
      else if (from.get(code).name !== row.name) renamed.push({ code, old_name: from.get(code).name, new_name: row.name, path: row.path });
    }
    for (const [code, row] of from) {
      if (!to.has(code)) removed.push(row);
    }
    return { added, removed, renamed };
  }, [areas, fromYear, province, toYear]);
  return (
    <section className="tool-panel">
      <h3>年份对比</h3>
      <div className="inline-controls compare-controls">
        <select value={fromYear} onChange={(event) => setFromYear(event.target.value)}>{years.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <select value={toYear} onChange={(event) => setToYear(event.target.value)}>{years.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <select value={province} onChange={(event) => setProvince(event.target.value)}><option value="">全国</option>{provinces.map((row) => <option key={row.code} value={row.name}>{row.name}</option>)}</select>
      </div>
      <p className="muted">新增 {output.added.length}，撤销 {output.removed.length}，改名 {output.renamed.length}</p>
      <DataTable rows={[...output.added.slice(0, 5), ...output.removed.slice(0, 5), ...output.renamed.slice(0, 5)]} columns={[["code", "代码"], ["name", "名称"], ["old_name", "旧名"], ["new_name", "新名"], ["path", "路径"]]} onSelectCode={onSelectCode} limit={15} empty="所选年份无差异" />
    </section>
  );
}

function PlatePanel({ plates }) {
  const [query, setQuery] = useState("京A");
  const matches = useMemo(() => {
    const normalized = query.trim().toUpperCase();
    if (!normalized) return [];
    return plates.filter((row) => {
      if (row.plate_code.toUpperCase() === normalized) return true;
      try {
        return new RegExp(`^${row.plate_code}$`, "i").test(normalized);
      } catch {
        return false;
      }
    });
  }, [plates, query]);
  return (
    <section className="tool-panel">
      <h3>车牌前缀</h3>
      <div className="inline-controls single-action">
        <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="京A / 冀A" />
      </div>
      <DataTable rows={matches} columns={[["plate_code", "前缀"], ["region", "地区"]]} limit={20} empty="请输入车牌前缀" />
    </section>
  );
}

function ChangePanel({ changes, years, onSelectCode }) {
  const [year, setYear] = useState("");
  const [type, setType] = useState("");
  const rows = useMemo(() => {
    return changes.filter((row) => (!year || row.year === year) && (!type || row.change_type === type)).slice(0, 80);
  }, [changes, type, year]);
  return (
    <section className="tool-panel">
      <h3>沿革事件</h3>
      <div className="inline-controls two">
        <select value={year} onChange={(event) => setYear(event.target.value)}><option value="">全部年份</option>{years.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <select value={type} onChange={(event) => setType(event.target.value)}><option value="">全部类型</option><option value="created">创建</option><option value="retired">弃用</option><option value="remapped">映射</option><option value="renamed">改名</option><option value="added">新增</option><option value="removed">移除</option></select>
      </div>
      <DataTable rows={rows} columns={[["change_type", "类型"], ["year", "年份"], ["code", "代码"], ["name", "名称"], ["new_code", "新代码"]]} onSelectCode={onSelectCode} limit={24} empty="无匹配沿革事件" />
    </section>
  );
}

const endpointFields = {
  manifest: [
    ["version", "数据发布版本号"],
    ["generated_at", "站点数据生成时间"],
    ["latest_year", "当前数据集最新年份"],
    ["counts", "各类记录数量统计"],
    ["files", "下载文件清单、大小、校验和"],
    ["api", "静态 API 端点列表"],
  ],
  search: [
    ["areas", "生命周期记录数组"],
    ["code", "6 位行政区划代码"],
    ["name", "行政区划名称"],
    ["level", "province / prefecture / county"],
    ["province, city, path", "所属省市与完整路径"],
    ["status", "active 或 retired"],
    ["start_year, end_year", "启用年份与弃用年份"],
    ["new_code", "弃用或映射后的承接代码"],
  ],
  "history-index": [
    ["codes", "可查询历史版本的代码索引"],
    ["code", "6 位行政区划代码"],
    ["latest_name", "该索引最新名称"],
    ["latest_path", "该索引最新路径"],
    ["names", "历史名称集合摘要"],
    ["sources", "覆盖来源：areacodes, gb, stats, mca"],
    ["revision_count", "历史版本记录数"],
  ],
  changes: [
    ["changes", "沿革事件数组"],
    ["change_type", "created / retired / remapped / added / removed / renamed"],
    ["year", "事件发生年份，部分映射记录可能为空"],
    ["code", "原代码或变化代码"],
    ["name", "记录名称"],
    ["old_name, new_name", "改名前后名称"],
    ["new_code", "承接新代码，可能包含多个目标"],
    ["source", "事件来源"],
  ],
  "history-code": [
    ["code", "查询的 6 位行政区划代码"],
    ["records", "该代码在所有来源版本中的归属记录"],
    ["source", "来源：areacodes / gb / stats / mca"],
    ["revision", "来源版本或年份"],
    ["name", "该版本中的名称"],
    ["level", "该版本中的层级"],
    ["parent_code", "该版本中的父级代码"],
    ["path", "该版本中的所属路径"],
    ["file", "原始来源文件"],
  ],
  province: [
    ["province_code", "省级分片代码"],
    ["areas", "该省相关生命周期记录数组"],
    ["code, name, level", "区划代码、名称、层级"],
    ["parent_code", "父级行政区划代码"],
    ["path", "完整行政区划路径"],
    ["status", "active 或 retired"],
    ["start_year, end_year", "启用年份与弃用年份"],
  ],
};

function ApiDocs({ selectedCode, provinces }) {
  const [apiCode, setApiCode] = useState(selectedCode || "110101");
  const [provinceCode, setProvinceCode] = useState(provinces[0]?.code || "110000");
  const [copiedKey, setCopiedKey] = useState("");
  const baseHref = useMemo(() => currentBaseHref(), []);
  const endpoints = useMemo(() => [
    { key: "manifest", title: "发布清单", endpoint: "api/manifest.json" },
    { key: "search", title: "检索索引", endpoint: "api/search-index.json" },
    { key: "history-index", title: "历史代码索引", endpoint: "api/history-index.json" },
    { key: "changes", title: "沿革事件", endpoint: "api/changes.json" },
    { key: "history-code", title: "单代码历史", endpoint: `api/history/${apiCode || "110101"}.json` },
    { key: "province", title: "省级分片", endpoint: `api/areas/${provinceCode || "110000"}.json` },
  ], [apiCode, provinceCode]);
  useEffect(() => setApiCode(selectedCode || "110101"), [selectedCode]);
  return (
    <section className="band" id="api" aria-labelledby="api-title">
      <div className="section-head">
        <div>
          <p className="eyebrow">Static API</p>
          <h2 id="api-title">API 快速调用测试</h2>
        </div>
        <code className="base-url">{baseHref.replace(/\/$/, "")}</code>
      </div>
      <div className="api-controls">
        <label><span>代码参数</span><input value={apiCode} onChange={(event) => setApiCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></label>
        <label><span>省级分片</span><select value={provinceCode} onChange={(event) => setProvinceCode(event.target.value)}>{provinces.map((row) => <option key={row.code} value={row.code}>{row.name}</option>)}</select></label>
      </div>
      <div className="api-grid">
        {endpoints.map((item) => {
          const url = endpointUrl(baseHref, item.endpoint);
          const code = apiExample(url);
          return (
            <article className="api-card" key={item.key}>
              <div className="api-card-head">
                <div><h3>{item.title}</h3><code>{item.endpoint}</code></div>
                <a className="icon-only" href={url} target="_blank" rel="noreferrer" title="打开端点"><ExternalLink size={16} /></a>
              </div>
              <pre><code>{code}</code></pre>
              <button className="ghost icon-button" type="button" onClick={async () => { await copyText(code); setCopiedKey(item.key); }}>
                <Copy size={16} />{copiedKey === item.key ? "已复制" : "复制 curl"}
              </button>
              <FieldList fields={endpointFields[item.key] || []} />
            </article>
          );
        })}
      </div>
    </section>
  );
}

function FieldList({ fields }) {
  return (
    <dl className="field-list">
      {fields.map(([field, description]) => (
        <div key={field}>
          <dt><code>{field}</code></dt>
          <dd>{description}</dd>
        </div>
      ))}
    </dl>
  );
}

function apiExample(url) {
  return `curl -L "${url}"`;
}
function Downloads({ manifest }) {
  const [format, setFormat] = useState("");
  const formats = [...new Set(manifest.files.map((file) => file.format))];
  const files = format ? manifest.files.filter((file) => file.format === format) : manifest.files;
  return (
    <section className="band" id="downloads" aria-labelledby="downloads-title">
      <div className="section-head">
        <div><p className="eyebrow">Downloads</p><h2 id="downloads-title">数据下载</h2></div>
        <a className="button icon-button" href="downloads/checksums.txt"><Download size={16} />校验和</a>
      </div>
      <div className="inline-controls download-filter"><select value={format} onChange={(event) => setFormat(event.target.value)}><option value="">全部格式</option>{formats.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
      <DataTable rows={files} columns={[["title", "文件"], ["format", "格式"], ["bytes", "大小"], ["description", "用途"], ["sha256", "SHA256"], ["path", "下载"]]} limit={40} />
    </section>
  );
}

function Versions({ versions }) {
  return (
    <section className="band" id="versions" aria-labelledby="versions-title">
      <div className="section-head"><div><p className="eyebrow">Versions</p><h2 id="versions-title">版本与来源</h2></div></div>
      <div className="source-grid">
        <article><h3>数据来源</h3><p><a href="https://github.com/cn/GB2260">cn/GB2260</a> · <a href="https://github.com/yescallop/areacodes">yescallop/areacodes</a></p></article>
        <article><h3>口径</h3><p>生命周期主表以 areacodes 汇总为主，GB2260 的 gb、stats、mca 版本作为标准版本和来源快照保留。</p></article>
        <article><h3>引用</h3><p>使用数据时请保留来源项目链接、版本号和本项目发布版本。</p></article>
      </div>
      <DataTable rows={versions} columns={[["source", "来源"], ["revision", "版本"], ["file", "文件"]]} limit={160} />
    </section>
  );
}

function LoadingScreen() {
  return <main className="not-found"><h1>正在加载数据</h1><p>读取静态 API 和检索索引...</p></main>;
}

function ErrorScreen({ message }) {
  return <main className="not-found"><h1>站点数据加载失败</h1><p>{message}</p></main>;
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

