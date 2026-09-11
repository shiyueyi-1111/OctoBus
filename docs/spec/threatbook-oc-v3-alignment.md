---
title: ThreatBook OC V3 服务契约对齐
version: 1.0
date_created: 2026-09-11
owner: OctoBus ThreatBook 能力
tags: [octobus, threatbook, service-package, v3]
---

# 1. 目标

复用现有 `threatbook__cloudapi_v3` 和 `threatbook__claudsandbox_v3` 服务包，补齐文件风险分析业务实际需要的契约差异，不新建重复的 Node.js 服务。

# 2. 当前复用情况

沙箱服务已经提供：

- `UploadFile`
- `GetFileReport`
- `GetMultiEnginesReport`

云 API 服务已经提供：

- `IpReputation`
- `DomainQuery`

需要核对和补齐：

- 当前业务使用 `/v3/scene/ip_reputation` 和 `/v3/scene/dns`；
- 现有云 API 包使用 `/1.1.1/scene/ip_reputation` 和 `/1.1.1/domain/query`；
- 现有云 API 包没有失陷检测 `SceneDns`；
- 现有云 API 成功响应没有返回可归一化的 JSON 数据；
- 沙箱 `GetFileReport` 把 `sandbox_type` 当作必填，但现有业务允许不配置。

# 3. 契约调整

## 3.1 IpReputation

- 路径调整为 `/v3/scene/ip_reputation`；
- 成功响应的 `raw_json` 必须包含脱敏后的上游 JSON；
- 不把 API Key 写入响应；
- 保持请求字段 `resource`、`lang` 兼容。

## 3.2 DomainQuery

- 仅当当前账号确认支持对应接口时保留；
- 若确认 `v3/domain/query` 可用，路径使用 `/v3/domain/query`；
- 否则保留现有路径并明确记录外部能力限制，不得伪装成已支持；
- 成功响应的 `raw_json` 必须包含脱敏后的上游 JSON。

## 3.3 SceneDns

新增：

```text
ThreatBook_CloudAPI_V3.ThreatBook_CloudAPI_V3/SceneDns
```

请求：

```json
{
  "resource": "8.8.8.8",
  "lang": "zh"
}
```

调用 `/v3/scene/dns`，成功响应返回脱敏后的 `raw_json`。

## 3.4 沙箱报告

- `sandbox_type` 改为可选；
- 未提供时不要发送空查询参数；
- 保持 `GetFileReport` 返回 `summary`、`permalink` 和 `data`；
- `response_code=3/7` 的处理中状态必须让 Python 能识别为 `PENDING`，不能变成不可解释的普通错误。

# 4. 实施任务

1. 为 v3 路径、`SceneDns`、成功响应 JSON 和可选 `sandbox_type` 增加失败测试；
2. 最小修改 proto、handler、README 和 mock upstream；
3. 运行两个服务包的 focused tests、validate 和 pack check；
4. 不调用真实微步接口完成单元测试。

# 5. 验收标准

- 两个服务包现有测试不回归；
- 新测试覆盖 v3 路径、JSON 返回和可选 `sandbox_type`；
- API Key 不出现在成功响应、错误响应或日志中；
- 未确认的能力在 README 中明确标注；
- OC 可以继续通过 gRPC、Connect RPC、MCP 和 OpenAPI 暴露同一组一元方法。
