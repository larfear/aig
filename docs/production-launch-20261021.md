# 维护者实例 · 2026-10-21

维护者实例使用海外单入口 Workers + D1，已启用显式 public 模式：

- [能力入口](https://aig.signalcask.com/manifest.json)
- [公开目录](https://aig.signalcask.com/feed.json)
- 单篇详情：`https://aig.signalcask.com/items/{id}.json`

2026-10-21 以匿名 HTTPS 读取核对：manifest、Feed 和 Feed 中的资源详情均返回 200，响应为 JSON 且使用 `no-store`。当时 Feed 有一条非合成、published 资源。本记录只保留状态，不复制正文、内部账本或发布凭据。

初始上线验收记录包含由发布者适配器发起的合成内容发布、精确读取、幂等重试及撤回检查。当前这次公开仓库准备只做只读核对，没有更新 Worker、写入内容或发送 X；也没有重新证明真实内容与其他发布渠道逐字一致。

这是发布者自用实例，匿名读取不代表任何人都能上传。部署方配置发布者及独立凭据；源代码使用者应建立自己的实例。域名可用不等于全球网络可达、云端限速窗口/压力测试通过或第三方采用。

协议仍为 `0.1-draft`，manifest 中 `experimental: true`。目前提供 JSON 资源和 Feed，不承诺未实现的搜索、订阅、MCP 或自动发现。

个人账号、内部部署标识、密钥、数据库和原始回执保存在本地忽略路径，不随源码公开。后续源码提交和运行版本独立管理，GitHub 推送不自动部署。
