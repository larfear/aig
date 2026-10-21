# AIG · 智能体信息网关

[![Local verification](https://github.com/larfear/aig/actions/workflows/ci.yml/badge.svg)](https://github.com/larfear/aig/actions/workflows/ci.yml)

**继续使用原有发布工具，同时让智能体直接读取同一份内容。**

[English](README.md) · [发布者接入](docs/publisher-integration.md) · [HTTP 契约](docs/access-contract.md) · [部署准备](docs/prelaunch-local.md)

AIG（Agent Information Gateway）是独立、通用的发布者侧网关。发布者自行选择公开内容，通过自己控制的 HTTP 地址向智能体交付完整正文、来源、版本和撤回状态。原有 X、网站或其他发布渠道继续由发布工具管理。

AIG 优先复用已有内容源。只有本地内容时，可选 Workers + D1 托管模块保存公开副本，无需暴露本地文件或数据库。Core 不依赖 DOS、X 或集中式内容平台；当前提供文件源和 D1 适配器，其他网站/CMS 需要另行适配。

AIG 保持原文，不自动摘要、改写、评价事实或验收消费者理解质量。

## 当前能力与状态

- 匿名读取 manifest、JSON Feed 和完整资源。
- 使用限定发布者范围的独立凭据，提交、更新和撤回内容。
- 稳定 ID、连续版本、幂等重试及明确冲突响应。
- 原样保留纯文本 / Markdown、来源和合成内容标记。
- 撤回返回 HTTP 410 墓碑，Feed 移除正文；D1 私有历史用于幂等核对。
- 可选 D1 持久保存、本地发布/读取 CLI 和自动生命周期验收。
- HTTPS 目标校验、大小限制和基础请求/鉴权失败限速。

项目处于早期参考实现阶段，契约为 **`0.1-draft`**，后续可能有不兼容变更。

维护者实例：[manifest](https://aig.signalcask.com/manifest.json) · [Feed](https://aig.signalcask.com/feed.json)。2026-10-21 已只读核对匿名 manifest、Feed 和资源详情可达。该实例由发布者自用，写入需要运营方配置，不提供公众注册上传。

本地测试、云端功能、网络可达性及实际采用分别记录；入口在线不等于全球可达、压力测试通过或已被陌生智能体采用。见[验证说明](docs/verification.md)与[上线记录](docs/production-launch-20261021.md)。

## 本地快速开始

需要 Node.js **24.14+ 的 24.x 版本**、npm、Git 和 OpenSSL。本地命令不需要云账号或付款。

```sh
git clone https://github.com/larfear/aig.git
cd aig
npm ci
npm run verify
npm run setup:local
npm run db:hosting:migrate
npm run dev:hosting
```

另一个终端执行合成内容的发布、读取、更新和撤回：

```sh
npm run demo:publish -- --file examples/resources/demo-announcement-001.json --url http://127.0.0.1:8787/
npm run client:read -- --id demo-announcement-001
npm run demo:publish -- --file examples/scenarios/demo-announcement-001-updated.json --url http://127.0.0.1:8787/
npm run demo:publish -- --file examples/scenarios/demo-announcement-001-withdrawn.json --url http://127.0.0.1:8787/
npm run client:read -- --id demo-announcement-001
```

最后读取为撤回墓碑，不返回旧正文。重发版本 1 不会恢复内容。Ctrl+C 停止服务，本地数据和密钥位于忽略路径。

也可只运行 `npm run acceptance:local`：自动启动独立回环 Worker/本地 D1，以合成内容检查发布、更新、重启、撤回和旧请求五个读取节点，结束后清理本轮数据库与密钥。文件源方式见[本地开发](docs/local-development.md)。

## 接口与限制

| 接口 | 权限 | 用途 |
| --- | --- | --- |
| `GET /manifest.json` | 匿名 | 能力和地址 |
| `GET /feed.json` | 匿名 | 当前已发布内容目录 |
| `GET /items/{id}.json` | 匿名 | 完整资源 200 / 撤回墓碑 410 |
| `PUT /publish/items/{id}.json` | 发布者 Bearer token | 发布、更新或撤回完整资源 |

默认只接收 `synthetic: true`，服务端显式 public 才允许真实资源；public 模式中仍逐条保留标记。首次版本为 1，实际更新和撤回连续加 1，重试保持完整 payload。公开读取和写入凭据分离。

当前要求 original 的纯文本或 Markdown 内联正文；URL 表示不自动抓取。请求/资源最多 256 KiB、响应最多 2 MiB，D1 Feed 最多 100 条已发布资源。超限明确报错，不截断；尚无分页、二进制上传、R2、MCP、订阅、搜索或自动发现。撤回不等于物理擦除历史或撤销他人已取得的副本。

## 文档导航

- [项目架构与三类实施场景](docs/project-plan.md)
- [发布者配置、请求、重试和验收](docs/publisher-integration.md)
- [访问契约](docs/access-contract.md)与[资源 Schema](schemas/resource.schema.json)
- [本地环境](docs/environment.md)与[本地试用](docs/local-development.md)
- [部署准备](docs/prelaunch-local.md)、[受控验证步骤](docs/controlled-launch-plan.md)和[技术选型与预算](docs/platform-and-budget.md)
- [托管附加模块](docs/hosting-addon.md)、[验证边界](docs/verification.md)与[后续计划](docs/next-steps.md)
- [DOS 适配示例](docs/dos-integration.md)、[贡献说明](CONTRIBUTING.md)和[安全报告](SECURITY.md)

## 许可证

采用 [MIT 许可证](LICENSE)，© 2026 larfear。
