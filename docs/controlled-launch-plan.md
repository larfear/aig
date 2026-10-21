# 受控云端验收

本文件供运营者验证自己的 Workers + D1 实例。受控指内容、入口、时段和主动请求量明确；公网内容仍可被匿名获取，不是私密测试。维护者实例当前状态见[上线记录](production-launch-20261021.md)，本步骤不是它的实时状态记录。

先完成本地回归和[部署准备](prelaunch-local.md)。使用专用测试资源、新随机 token、synthetic:true 内容和 `.invalid` 来源；不导入真实稿件、其他项目凭据或本地数据库。

## 准备与责任

| 项目 | 要求 |
| --- | --- |
| 发布者 | 两个通用合成发布者，独立凭据，不发送外部渠道内容 |
| 存储 | 自己账号下的专用 D1，迁移和绑定明确 |
| 公网 | 一个选定 HTTPS 子域名，默认/预览关闭，不开放本地源 |
| 读取方 | 无发布凭据的客户端；独立网络与发布机分别记录 |
| 用量 | 建议主动测试不超过 500 次请求、10MB 数据，不持续压测 |
| 收尾 | 合成内容撤回，若仅临时测试则移除绑定、停用测试 Secret |

请求量是人工执行预算，不是平台自动费用上限。账号、域名、套餐和用量归运营者管理，见[账号与预算](platform-and-budget.md)。

## 独立双发布者测试配置

```sh
npm run validation:prepare -- --directory .local/controlled-validation
```

编辑生成的 target.json，填写自己真实的账号、D1 和唯一 HTTPS origin，再生成计划和离线包：

```sh
npm run validation:plan -- --directory .local/controlled-validation
npm run validation:bundle -- --directory .local/controlled-validation
```

该配置默认为 synthetic，包含两个演示发布者。它与单发布者 production profile 不同；三阶段脚本要求这两个 scope 及 synthetic 网关标记。不要直接对单发布者 public 实例运行该脚本。

部署与开放由运营者按计划显式执行，指南见[部署准备](prelaunch-local.md)。使用测试目录对应的配置、数据库名和 secrets，不要混入其他实例。

## 三阶段脚本

以下 publish/withdraw 会写入目标实例，read 只读。首次选择新的 run 路径；存在时拒绝重开，避免覆盖投递记录。

```sh
npm run validation:check -- --phase publish --target .local/controlled-validation/target.json --credentials .local/controlled-validation/publisher-credentials.json --run .local/controlled-validation/runs/first/run.json
npm run validation:check -- --phase read --target .local/controlled-validation/target.json --run .local/controlled-validation/runs/first/run.json
npm run validation:check -- --phase withdraw --target .local/controlled-validation/target.json --credentials .local/controlled-validation/publisher-credentials.json --run .local/controlled-validation/runs/first/run.json
```

publish 验证两发布者写入、完整读取、重试、冲突、更新及部分权限错误；withdraw 撤回第一项、检查墓碑和旧请求不恢复，第二项仍保持可读。read 可在独立环境重复执行，不接受发布凭据。最终由运营者将剩余测试资源按连续版本撤回，不能误以为 withdraw 阶段已自动清空所有测试内容。

给独立读取方的文件只包括所选合成 run.json 和仅含 origin 的 target；不要复制整个目录。发布机断网后立即和 15 分钟后可再执行 read。结果保存在运行文件旁的 `.reports/`。

## 验收项目

| 项目 | 验证与通过条件 |
| --- | --- |
| A1 入口范围 | 有效 HTTPS、唯一目标、能力准确，无匿名数据库/管理/历史入口 |
| A2 完整交付 | 原文、来源、ID、版本、空白和字符一致 |
| A3 独立读取 | 无 token 的独立客户端读取；所在地和网络另记 |
| A4 持久化 | 发布端退出/断网后仍可读，分别记录时间 |
| A5 版本与幂等 | 同版同内容 unchanged，冲突与跳号拒绝 |
| A6 部署持久性 | 在明确需要并允许再部署时确认内容保留 |
| A7 更新 | 同 ID 新版正文与 Feed 同步，旧版不回退 |
| A8 撤回 | 410 墓碑、无正文、Feed 移除、旧请求不恢复 |
| A9 权限 | 缺失/错误 token 与跨发布者操作拒绝 |
| A10 基础限速 | 小量、有限窗口测试 429 与恢复，不用压力测试替代功能验收 |
| A11 收尾与费用 | 移除临时绑定后新 HTTPS 不返回内容，测试 Secret 停用，保留资源和持续费用明确 |

脚本只覆盖其实际发起的检查，不能自动把 A1–A11 全部标为通过。云端再部署、独立网络、15 分钟离线、限速窗口和账单须分别证明；本地成功不计作这些项目通过。

## 控制台创建应用与关联 GitHub

关联 GitHub 是可选自动构建/部署路径，与买域名、开通套餐、生成本地配置是不同操作。当前参考流程由运营者使用独立配置部署。仓库 CI 只做本地回归，不更新 Worker；如果以后开启 Cloudflare Git 集成，须另外明确分支、环境、Secret 和部署触发规则。

关闭临时入口必须显式移除 Custom Domain，再核对默认/预览、其他路由和新 HTTPS 连接。空 routes 不自动移除已有绑定，详见[关闭步骤](prelaunch-local.md#关闭测试入口)。
