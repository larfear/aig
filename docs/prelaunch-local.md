# 部署准备与运营步骤

本地运行不需要云账号；部署是单独的运营操作。下面命令是部署指南，`verify`、`publisher:prepare`、`validation:plan` 和 `validation:bundle` 不会执行真实部署。请使用自己的账号、数据库、域名与新凭据，不复用维护者实例的内部配置。

## 1. 先完成本地复现

```sh
npm ci
npm run verify
```

参考云配置采用 Workers Paid + D1，CPU 上限 50ms，默认域名和预览关闭。Free 套餐存在，但当前配置未按其 CPU 等限制完成验收。账号与预算见[平台选择](platform-and-budget.md)。

## 2. 准备自己的云资源

需要 Cloudflare 账号、可管理的域名/DNS、适用套餐、专用 D1 以及管理这些资源的部署凭据。发布者 token 与云管理凭据分开。

运营者可使用项目锁定的 CLI 登录并创建 D1；以下两条会访问 Cloudflare，第二条会创建资源：

```sh
node node_modules/wrangler/bin/wrangler.js login
node node_modules/wrangler/bin/wrangler.js d1 create aig-hosted
```

核对账号和授权权限后操作；已有专用数据库时无需重复创建。记录返回的数据库名和 UUID，并从自己的账号取得 account ID。域名应已由同一 Cloudflare 账号管理。

## 3. 生成单发布者配置

```sh
mkdir -p .local
cp dev/validation-target.example.json .local/deployment-target.json
```

编辑该文件，填入自己的唯一 HTTPS origin、account_id、worker_name、database_name、database_id 及两个不同的限速 namespace ID。不要把示例 `.invalid`、全零账号/D1 或别人的目标直接用于部署。示例值仅通过格式验证，不证明资源可用。

在新目录生成正式发布者配置：

```sh
npm run publisher:prepare -- --publisher-id urn:publisher:example --directory .local/production --target .local/deployment-target.json --content-mode public
npm run validation:plan -- --directory .local/production
npm run validation:bundle -- --directory .local/production
```

首次 public 准备要求新目录，拒绝复用本地测试密钥。重复准备同配置保留密钥，目标、scope 或模式变化则拒绝覆盖。省略 `--content-mode public` 时默认为 synthetic。

| 生成文件 | 用途 |
| --- | --- |
| `publisher-credentials.json` | 单发布者身份和随机 token，0600 |
| `secrets.json`、`.dev.vars` | Secret 上传格式与本地配置，0600 |
| `target.json` | 唯一 HTTPS origin 与明确资源绑定 |
| `deployment-profile.json` | 离线配置；`enabled:false` 不代表云端实时状态 |
| `wrangler.closed.json` | 首次无入口配置，routes 为空，workers.dev/预览关闭 |
| `wrangler.public.json` | 相同 Worker/绑定，增加唯一 Custom Domain |
| `bundle/`、`source-snapshot.json` | dry-run 产物与源码/锁文件摘要，不包含发布 token |

`validation:plan` 仅打印 `commands_NOT_EXECUTED`；`validation:bundle` 固定执行 `deploy --dry-run`，清除继承的云凭据并关闭遥测。生成文件全部放在忽略的 `.local/`，不要整体分享给发布者。

## 4. 运营者执行迁移、部署和开放

下面会修改真实云资源。确认目标、域名无冲突、公开范围与预算后，按顺序执行：

```sh
node node_modules/wrangler/bin/wrangler.js d1 migrations apply aig-hosted --remote --config .local/production/wrangler.closed.json
node node_modules/wrangler/bin/wrangler.js deploy --config .local/production/wrangler.closed.json --secrets-file .local/production/secrets.json
```

第一条中的 `aig-hosted` 必须与自己的 database_name 一致。先在控制台核对 DB、模式、Secret、限速绑定及默认/预览关闭，再开放唯一域名：

```sh
node node_modules/wrangler/bin/wrangler.js triggers deploy --config .local/production/wrangler.public.json
```

Custom Domain 操作可能影响冲突 DNS 记录，应事先核对。Secret 上传方式见 [Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)，域名配置见 [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)。GitHub CI 不执行这些操作，也不保存生产 Secret。

## 5. 验证自己的实例

先用 synthetic:true 的完整资源验证发布、读取、同版重试、更新、撤回与旧请求；仍使用该发布者的 scope。可复用[发布者指南](publisher-integration.md)的输入，把 URL 改为自己配置的 target，显式给出凭据文件：

```sh
npm run publisher:send -- --file .local/example-publisher/publish.json --target .local/production/target.json --credentials .local/production/publisher-credentials.json
npm run client:read -- --target .local/production/target.json --id example-synthetic-note-001
```

只有运营者明确选择真实内容时，输入才设 synthetic:false，并给发布 CLI 增加 `--content-mode public`。服务端也须是 public 模式；两者互不替代。

匿名读取验收用 `acceptance:read`，仅交付 origin 和选定公开资源的期望文件，不交付 token。实例开在 public 模式时 `gateway_synthetic` 为 false，即使测试资源仍为 true。自动双发布者云验证另见[受控验证](controlled-launch-plan.md)，不要把其双发布者配置与上述单发布者凭据混用。

公网写入回执不替代独立读取。按实际需要在独立网络、发布机离线后再次读取；不要以边缘节点位置推定客户端所在地。

## 关闭测试入口

先停止发布端同步，再在控制台或 Custom Domains API **移除指定域名绑定**。锁定 Wrangler 的空 `routes: []` 不会自动删除已有 Custom Domain，不能只部署 closed 配置就宣称已下线。

核对默认/预览 URL 与其他路由，使用新 HTTPS 连接复测 manifest、Feed 和资源不再返回 AIG。必要时同时用缓存 DNS 地址测试，仍保留正确 SNI 与证书验证。停用测试发布 Secret，保留或清理数据库按运营策略执行。关入口不自动取消 Paid 或清除历史。
