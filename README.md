<div align="center">

# GB2260 Open Data

GB/T 2260 行政区划代码、历史沿革、版本快照与车牌前缀映射。

[![CI](https://img.shields.io/github/actions/workflow/status/xihan123/gb2260/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/xihan123/gb2260/actions/workflows/ci.yml)
[![GitHub Pages](https://img.shields.io/github/actions/workflow/status/xihan123/gb2260/pages.yml?branch=main&style=flat-square&label=Pages)](https://github.com/xihan123/gb2260/actions/workflows/pages.yml)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=flat-square&logo=python&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white)
![Data](https://img.shields.io/badge/latest-2025-126a5c?style=flat-square)
[![License](https://img.shields.io/badge/license-CC0--1.0-lightgrey?style=flat-square)](./LICENSE)

[快速开始](#快速开始) · [数据产物](#数据产物) · [静态站点](#静态站点) · [工作流](#工作流)

</div>

## 项目简介

本仓库把 [`cn/GB2260`](https://github.com/cn/GB2260) 与 [`yescallop/areacodes`](https://github.com/yescallop/areacodes) 的县级以上行政区划数据整理为可下载文件、SQLite 数据库和浏览器端静态 API。

当前构建覆盖到 `2025` 年，包含：

- `6,824` 条生命周期记录。
- `3,212` 条当前有效记录。
- `21,455` 条沿革变化记录。
- `452,183` 条历史来源版本记录。
- `376` 条车牌前缀映射。

## 快速开始

```powershell
python scripts/fetch_sources.py
python scripts/build_database.py
npm install
python scripts/build_site.py
```

查询示例：

```powershell
python scripts/query.py code 110101
python scripts/query.py year 2025 --province 北京市
python scripts/query.py changes 110103
python scripts/query.py history 110101 --source areacodes --limit 3
python scripts/query.py plate 京A
```

根目录入口等价于查询脚本：

```powershell
python main.py code 110101
```

## 数据产物

构建结果位于 `data/build/`，发布下载文件位于 `site/public/downloads/`。

| 文件 | 格式 | 内容 |
| --- | --- | --- |
| `areas.csv` | CSV | 生命周期主表，含代码、名称、层级、父级、状态、启用/弃用年份、新代码 |
| `areas.json` | JSON | 按行政区划代码索引的结构化数据 |
| `areas.dat` | DAT | UTF-8 制表符分隔紧凑表 |
| `areas.sqlite` | SQLite | 离线关系数据库与查询索引 |
| `changes.csv` | CSV | 新增、撤销、改名、旧新代码映射 |
| `versions.csv` | CSV | 上游版本清单 |
| `plate_codes.csv` | CSV | 车牌前缀映射 |
| `source_areas.csv` | CSV | GB2260 各来源版本快照 |

## 静态站点

站点源码位于 `site/src/`，构建产物位于 `site/public/`。

```powershell
python -m http.server 8000 -d site/public
```

站点提供数据下载、SHA256 校验、行政区划检索、层级浏览、历史归属查询、年份对比、车牌前缀查询和静态 API 调试。

## 静态 API

- `api/manifest.json`
- `api/latest.json`
- `api/search-index.json`
- `api/changes.json`
- `api/plates.json`
- `api/versions.json`
- `api/stats.json`
- `api/schema.json`
- `api/history-index.json`
- `api/areas/{province_code}.json`
- `api/history/{code}.json`

示例：

```powershell
curl -L "https://xihan123.github.io/gb2260/api/history/110101.json"
```

## 项目结构

```text
.
├── .github/workflows/     # CI、GitHub Pages、数据更新、Release
├── cloud-functions/       # EdgeOne / Go API 示例服务
├── data/raw/              # 上游原始数据快照
├── data/build/            # 规范化后的数据产物
├── scripts/               # 数据拉取、构建、站点生成和查询脚本
├── site/src/              # React + Vite 静态站点源码
├── site/public/           # 可直接发布的静态站点与下载文件
├── main.py                # 查询脚本入口
├── package.json           # 前端构建依赖
└── vite.config.js         # Vite 构建配置
```

## 工作流

- `持续集成`：编译 Python 脚本，构建数据和站点，运行烟测查询和 Go API 测试。
- `更新数据`：每周一自动拉取上游数据，变更后提交 `data/raw`、`data/build`、`cloud-functions/data`、`site/public`。
- `部署 GitHub Pages`：推送到 `main` 或 `master` 后构建并发布 `site/public`。
- `发布数据`：打 tag 或手动触发，上传 CSV、JSON、DAT、SQLite、完整 ZIP 和校验文件到 GitHub Release。

## 数据来源与许可

- [`cn/GB2260`](https://github.com/cn/GB2260)
- [`yescallop/areacodes`](https://github.com/yescallop/areacodes)

本仓库自有整理脚本、静态站点和整理产物采用 [CC0 1.0 Universal](./LICENSE) 发布。脚本会在 `data/raw/` 保存原始文件，使用生成数据时请同时遵守上游项目许可证和数据来源说明。



