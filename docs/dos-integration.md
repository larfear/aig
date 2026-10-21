# 发布者适配示例：DOS

DOS 使用自己的审核和发布工具，再将用户选定的最终公开内容同步到 AIG。这是通用发布者接入示例，不是 Core 依赖；本仓库不包含 DOS 的源代码、数据库、凭据或内部账本。

## 阅读入口

- [通用发布者接入](publisher-integration.md)：配置、完整请求、回执、失败与重试。
- [HTTP 契约](access-contract.md)与[资源 Schema](../schemas/resource.schema.json)。
- [本地开发](local-development.md)与[自动验收](verification.md)。

## 发布者侧要求

1. 从既有人工审核与发布确认后的最终快照取得正文，不自动挑选内部研究内容，不重新解析 X。
2. 两个出口复用相同最终正文。是否在 X 成功后同步，由发布工具明确选择；不把该策略写进 AIG Core。
3. X 与 AIG 单独记录结果。AIG 待同步、未知、成功、失败和撤回应可区分；AIG 重试不能重发 X，也不能重新生成正文或时间。
4. 保存稳定 AIG ID、来源键、连续 AIG revision 和精确 payload。内部草稿版本可能跳号，不能直接当作 AIG 投递版本。
5. 更新/撤回保持同一身份；以当前回执版本和状态显示结果。旧版 `unchanged` 不代表当前已公开。
6. 默认关闭同步，逐条确认公开范围。保存设置本身不应自动公开历史内容。

凭据只使用该发布者自己的 scope；不把 Cloudflare 管理凭据或其他发布者 token 交给适配器。不公开内部稿件路径或数据库连接。

## 合成本地联调

在 AIG 仓库准备单独目录，并启动回环 Worker：

```sh
npm run publisher:prepare -- --publisher-id urn:aig:publisher:dos --directory .local/dos-local
npm run publisher:serve -- --directory .local/dos-local --content-mode public --port 8787
```

`public` 在这里用于验证配置分支；联调输入仍为 `synthetic: true`，来源使用 `.invalid`。DOS 指向 `http://127.0.0.1:8787`，读取该目录中自己的 `publisher-credentials.json`，禁用真实 X 发送或使用模拟出口。

由 DOS 自身发起并证明：首次发布、同版重试、409 冲突、更新、错误凭据/跨范围拒绝、服务重启后读取、撤回 410、Feed 移除和旧请求不恢复正文。用最终快照生成期望文件，再调用：

```sh
npm run acceptance:read -- --expect /absolute/path/to/synthetic-expectation.json
```

通用一键 `acceptance:local` 证明 AIG 契约，不替代 DOS 适配器实际发起请求的证据。验收结束停止本地服务。

## 可复制的适配任务

> 请阅读 AIG 仓库中的 docs/publisher-integration.md、docs/access-contract.md、schemas/resource.schema.json 和本附录。在发布者项目中实现可选 AIG 通道，使用服务端提供的地址、publisher_id 和独立 token。保留最终审核，两个出口复用同一正文；AIG 独立保存精确 payload、结果和重试，支持连续版本与撤回。先以 synthetic:true、回环 Worker/本地 D1 和模拟 X 完成本地生命周期及失败验收，使用 acceptance:read 核对正文、来源、版本和状态。不要修改 AIG 核心或把发布者私有数据导入仓库。正式公网同步与实际 X 发送由运营者另行开启。
