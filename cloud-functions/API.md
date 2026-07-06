# GB2260 EdgeOne API

EdgeOne 部署后外部路径为 `/api/v1/...`。本地直接运行 Go 服务时路径为 `/v1/...`。

```powershell
cd cloud-functions
go run .
```

本地默认地址：

```text
http://127.0.0.1:9000/v1
```

EdgeOne 地址示例：

```text
https://your-domain.example/api/v1
```

## 通用响应

列表接口统一返回：

```json
{
  "items": [],
  "total": 0,
  "limit": 50
}
```

错误响应：

```json
{
  "error": "code must be 6 digits"
}
```

## 接口

| 方法 | 本地路径 | EdgeOne 路径 | 说明 |
| --- | --- | --- | --- |
| GET | `/v1/health` | `/api/v1/health` | 健康检查、运行时和数据统计 |
| GET | `/v1/areas/{code}` | `/api/v1/areas/{code}` | 按 6 位行政区划代码查询生命周期记录 |
| GET | `/v1/areas/{code}/children` | `/api/v1/areas/{code}/children` | 查询子级行政区 |
| GET | `/v1/search` | `/api/v1/search` | 按代码、名称、路径检索 |
| GET | `/v1/year/{year}` | `/api/v1/year/{year}` | 查询某年有效区划 |
| GET | `/v1/changes/{code}` | `/api/v1/changes/{code}` | 查询代码相关沿革变化 |
| GET | `/v1/history/{code}` | `/api/v1/history/{code}` | 查询来源版本历史 |
| GET | `/v1/plates/{prefix}` | `/api/v1/plates/{prefix}` | 查询车牌前缀 |
| GET | `/v1/versions` | `/api/v1/versions` | 查询来源版本清单 |

### GET /health

```powershell
curl "http://127.0.0.1:9000/v1/health"
```

### GET /areas/{code}

`code` 必须是 6 位数字。

```powershell
curl "http://127.0.0.1:9000/v1/areas/110101"
```

### GET /areas/{code}/children

查询参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `year` | 否 | 只返回该年有效的子级 |

```powershell
curl "http://127.0.0.1:9000/v1/areas/110000/children?year=2025"
```

### GET /search

查询参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `q` | 否 | 匹配代码、名称、路径 |
| `level` | 否 | `province` / `prefecture` / `county` |
| `status` | 否 | `active` / `retired` |
| `province` | 否 | 省级名称，如 `北京市` |
| `year` | 否 | 只返回该年有效记录 |
| `limit` | 否 | 默认 `50`，最大 `500` |

```powershell
curl "http://127.0.0.1:9000/v1/search?q=北京&status=active&limit=10"
```

### GET /year/{year}

查询参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `level` | 否 | `province` / `prefecture` / `county` |
| `province` | 否 | 省级名称 |
| `limit` | 否 | 默认 `200`，最大 `1000` |

```powershell
curl "http://127.0.0.1:9000/v1/year/2025?province=北京市&limit=20"
```

### GET /changes/{code}

同时匹配 `changes.code` 和 `changes.new_code` 中出现的代码。

```powershell
curl "http://127.0.0.1:9000/v1/changes/110103"
```

### GET /history/{code}

查询参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `source` | 否 | `gb` / `stats` / `mca` / `areacodes` |
| `limit` | 否 | 默认 `200`，最大 `1000` |

```powershell
curl "http://127.0.0.1:9000/v1/history/110101?source=gb&limit=3"
```

### GET /plates/{prefix}

`prefix` 支持普通车牌前缀，服务端会匹配数据中的正则模式。

```powershell
curl "http://127.0.0.1:9000/v1/plates/京A"
```

### GET /versions

```powershell
curl "http://127.0.0.1:9000/v1/versions"
```
