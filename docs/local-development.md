# 本地功能开发与试用

文件源和 Workers/本地 D1 均支持通用发布者。默认只允许合成内容，显式 public 模式允许真实与合成资源。以下试用保持回环地址和 synthetic:true，不需要云账号，不部署远端或发送其他渠道内容。

## 安装和完整测试

```sh
npm ci
npm run verify
```

`verify` 依次执行工具、类型、6 份样例、环境探针、文件/D1/HTTPS/真实发布者能力测试，最后执行 `acceptance:local`。全部在本机运行，不调用云端；少量假数据设 synthetic false 验证正式模式，公开样例仍为 true。HTTPS 使用 OpenSSL 临时测试 CA，不关闭证书验证。结束后停止临时服务、清理数据库和密钥，摘要在 `.local/functional-check.json`、`.local/prelaunch-check.json` 和 `.local/publisher-acceptance/latest.json`。

本地使用已锁定 Wrangler，无需云账号或付款方式。依赖以 package-lock.json 为准。

## 路径一：不启用托管，读取发布者文件源

初始化演示目录，发布两个通用发布者的内容：

```sh
npm run setup:local
npm run demo:publish -- --file examples/resources/demo-announcement-001.json --source .local/demo/source
npm run demo:publish -- --file examples/resources/demo-note-001.json --source .local/demo/source
npm run dev:file
```

在另一终端读取：

```sh
npm run client:read -- --url http://127.0.0.1:8787/
npm run client:read -- --url http://127.0.0.1:8787/ --id demo-announcement-001
```

执行更新、读取，再撤回：

```sh
npm run demo:publish -- --file examples/scenarios/demo-announcement-001-updated.json --source .local/demo/source
npm run client:read -- --id demo-announcement-001
npm run demo:publish -- --file examples/scenarios/demo-announcement-001-withdrawn.json --source .local/demo/source
npm run client:read -- --id demo-announcement-001
```

文件发布工具写源，网关只读源，不另建正文库。发布工具串行锁定目录并原子替换完整资源；源缺失、损坏、超限和符号链接明确失败，不从请求接收任意本机路径或上游 URL。文件工具只识别当前版本的幂等重试，已被后续版本替代的旧提交返回冲突。

此路径用于通用 Core 的本地验证，不代表部署了公网文件源。原有格式可以由其他源适配器映射，当前没有实现任意网站抓取或自动平台接入。

## 路径二：本地 D1 托管

先停止文件网关（Ctrl+C），再启动托管：

```sh
npm run setup:local
npm run db:hosting:migrate
npm run dev:hosting
```

`setup:local` 仅为两个合成发布者生成独立随机密钥，保存到忽略的 `.local/publisher-credentials.json` 和 `.dev.vars`，首次创建使用 0600 权限，不打印密钥。重复运行保留已有密钥。它不注册 Cloudflare 账号，不生成云管理员 Token，不配置外部发布工具。该 `.dev.vars` 条目由初始化工具管理，其他已有条目保留。

迁移使用 `--local` 和 `.local/cloudflare/state/`。`migrations/0001_hosting.sql` 创建当前资源表和版本记录表；`dev/db/environment.sql` 仍只是环境诊断表，两者分开。

在另一终端依次同步和读取：

```sh
npm run demo:publish -- --file examples/resources/demo-announcement-001.json --url http://127.0.0.1:8787/
npm run demo:publish -- --file examples/resources/demo-note-001.json --url http://127.0.0.1:8787/
npm run client:read -- --id demo-announcement-001
npm run demo:publish -- --file examples/scenarios/demo-announcement-001-updated.json --url http://127.0.0.1:8787/
npm run client:read -- --id demo-announcement-001
npm run demo:publish -- --file examples/scenarios/demo-announcement-001-withdrawn.json --url http://127.0.0.1:8787/
npm run client:read -- --id demo-announcement-001
```

上述示例是一个递增的版本序列：首次 1、更新 2、撤回 3。若已跑到版本 3，不要把重放旧文件误认为重新发布；D1 对已知同版本同内容返回 `unchanged`，并在回执中指出当前版本仍是 3。重新公开需要新的连续版本，而不是回退版本。文件路径按上一节规则拒绝旧版本。

所有成功同步回执只含资源 ID、提交版本、`outcome`、`current_revision` 和 `current_status`。`stored` 表示版本已保存；`unchanged` 表示已知同内容重试。回执不替代客户端读取核对。超时或请求失败应核对当前状态或以同一版本重试，不自行增加版本，不联动 X 发送。

停止并重新启动 `dev:hosting` 后，本地 D1 内容仍可读取。发布 CLI 退出后也可读取；这是同机持久化证据，不是独立网络或真实云服务可用性证据。

## 已实现的最小接口

| 方法与路径 | 行为 |
| --- | --- |
| `GET /manifest.json` | 只宣告资源和 JSON Feed；其他扩展均为 false |
| `GET /feed.json` | 当前发布内容的完整主文本及资源链接、版本、来源和表示列表 |
| `GET /items/{id}.json` | 发布资源 200，撤回墓碑 410，缺失 404 |
| `PUT /publish/items/{id}.json` | 仅托管模式，Bearer 授权后同步 published 或 withdrawn 资源 |

具体语义见[访问契约](access-contract.md)。GET 不产生发布动作；文件模式没有公开写入接口。撤回墓碑不含正文、标题或扩展，Feed 移除条目；没有公开的历史版本、数据库或配置路由。历史正文仍在私有 D1 版本记录中用于幂等核对，当前撤回属于停止对外提供，不是物理擦除。

## 必要防护与限制

- 密钥由服务端绑定发布者 ID，调用方不能自行改所有者；写入、更新和撤回使用相同校验。
- 托管请求 120 次/60 秒，错误鉴权共享计数 5 次/60 秒，触发时返回 429 和 Retry-After；有效密钥不受错误鉴权计数阻断。Workers 原生限速按运行位置生效，不能当作严格全球配额或账单上限。
- 同步请求及单个规范化资源最多 256 KiB；响应最多 2 MiB。文件源最多 100 个当前资源，D1 Feed 最多 100 个已发布资源。超限明确失败，不截断正文或悄悄省略条目；首版没有分页。
- 默认 synthetic 模式只接受 `synthetic: true`；public 模式支持真实/合成资源及逐项标记。已发布资源至少有一份 original 的 text/plain 或 text/markdown 内联正文。其他表示原样保留，URL 不会被服务端抓取；仅 URL、二进制和 R2 上传待后续实际需求再支持。
- 核心使用既有 Schema 预生成静态校验器，Workers 请求处理不动态编译代码；中文、换行、空白、组合字符和 emoji 解码后保持原值。
- 本地只监听 127.0.0.1，CLI 默认拒绝非回环地址；上线准备工具可用 `--target` 显式允许一个 HTTPS origin。非回环 HTTP、地址不匹配与跳转仍拒绝，真实域名 TLS 和云端防护仍待独立验收。

本地密钥、数据库、测试运行数据、生成文件和日志留在忽略路径。CLI 不在命令行传递密钥。当前没有登录页面、多级角色、签名体系、订阅、观测平台或后台任务。

## 后续使用

单发布者配置、完整 payload、回执与独立读取检查见[发布者指南](publisher-integration.md)，适配示例见[DOS 接入](dos-integration.md)。

云端运行按[部署准备](prelaunch-local.md)与[受控验收](controlled-launch-plan.md)分别操作。本地命令不继承云凭据，也不自动将维护者入口或其他实例作为测试目标。国内托管按实际需求扩展，当前不搭建双区域同步。
