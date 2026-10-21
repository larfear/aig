# 发布者接入说明

当前实现支持任意发布者 URI 和独立发布凭据，内容沿用 `aig-resource/0.1-draft`。AIG 负责保存和完整交付已选定的公开正文；内容选择、审核、X 等其他渠道的发布和重试仍由发布者工具负责。无需读取发布者数据库或开放本地源。

先以合成内容在本地验证，再由运营方启用自己的正式入口。下文命令默认不创建云资源；部署见[部署准备](prelaunch-local.md)，特定发布工具的适配示例见[DOS 接入](dos-integration.md)。

## 服务端配置与运行标记

| 配置 | 行为 |
| --- | --- |
| `AIG_CONTENT_MODE=synthetic`，省略时也是此值 | 只接受 `synthetic: true`；非合成写入 422，源中意外存在非合成数据时详情/Feed 明确 503，不静默公开或省略 |
| `AIG_CONTENT_MODE=public` | 允许真实资源和合成资源共存；仍逐条保留 `synthetic`，调用方不能通过请求改变服务端模式 |
| `AIG_PUBLISHERS_JSON`，Secret | 数组，每项包含 `publisher_id` 与独立随机 `token`：32 字节随机值编码为 64 个小写十六进制字符；1–10 个发布者，拒绝重复 ID 或重复密钥。缺失/错误配置不能写入 |

public 模式本地仍只绑定回环，公网入口由部署配置单独控制。正式模式的 manifest.synthetic 和 Feed._aig.synthetic 为 false，表示服务不再限于合成内容；这不表示 Feed 中每项都是真实内容。每个 Feed item 的 `_aig.synthetic` 和详情 `synthetic` 标识该资源，合成示例始终为 true。Feed 的新字段为兼容性新增字段，Schema 允许它；详情中的标记为必需字段，旧 Feed 缺少逐项标记时读取检查器以详情核对，并忽略不相关扩展。`experimental` 继续为 true，契约仍为草案。

发布凭据由运营方在本地生成并交给相应发布者，只能操作绑定的 publisher.id。不将 Cloudflare OAuth、账号管理权限或其他发布者凭据交给发布工具；不在设置页明文回显或日志打印 token。云端启用时使用独立的新正式凭据；不要复用已经停用的测试密钥。

## 本地准备，不创建云资源

以下命令在 AIG 仓库执行，可供任何发布工具联调：

```sh
npm run publisher:prepare -- --publisher-id urn:publisher:example --directory .local/example-publisher
npm run publisher:serve -- --directory .local/example-publisher --content-mode public --port 8787
```

prepare 只在指定 `.local` 目录生成 `publisher-credentials.json`、`secrets.json` 与 `.dev.vars`，文件权限 0600，不输出密钥。重复执行保留原密钥，目录已属于另一发布者时拒绝覆盖。`secrets.json` 为以后运营方部署所用，发布工具只需自己的 publisher_id 和 token；配置生成本身不上传文件。

serve 只启动 `127.0.0.1` Worker，自动应用本地 D1 迁移，使用该目录的配置/密钥/持久化状态；不读取云 OAuth、不登录、不操作远端 D1。Ctrl+C 停止服务，本地状态保留供下次联调。若 8787 已被占用，改用另一端口并同步修改发布工具地址。公开路由、workers.dev 和预览关闭。文件源方式也支持显式 `--content-mode public`，不要求启用 D1。

本地联调正文使用合成数据。启动 public 模式仅验证能力配置；联调 payload 仍使用 `synthetic: true`。自动回归中的少量 `synthetic: false` 资源也是明确标记的人工假数据，只验证正式模式分支，绝不导出真实稿件。

## 通用正式发布者离线配置

`publisher:prepare` 新增可选 `--target` 和 `--content-mode`，为任意发布者生成独立部署配置。默认仍为 synthetic；显式 public 才允许非合成资源。此工具只写本地忽略目录，不登录、不部署、不创建云资源或开放域名。

目标 JSON 格式沿用 `dev/validation-target.example.json`：唯一 HTTPS origin、account_id、worker_name、database_name、database_id、request_namespace_id 和 auth_namespace_id。示例中的 `.invalid` 和全零标识仅用于离线夹具，不证明域名或账号可用；真实目标值以后另行核对。

```sh
npm run publisher:prepare -- --publisher-id urn:publisher:your-publication --directory .local/formal-publisher --target /absolute/path/to/target.json --content-mode public
npm run validation:plan -- --directory .local/formal-publisher
npm run validation:bundle -- --directory .local/formal-publisher
```

任意发布工具都可使用自己的 publisher URI，核心不识别特定发布者。public 首次准备要求新目录，拒绝复用已生成的本地/测试发布密钥。重复准备同一配置保留密钥；改变目标、发布者、模式或资源绑定时拒绝覆盖，需使用新目录。

生成文件：

| 文件 | 用途 |
| --- | --- |
| `deployment-profile.json` | `aig-publisher-deployment/1`，绑定一个发布者、目标和 content_mode，离线状态 `enabled: false` |
| `publisher-credentials.json`、`secrets.json`、`.dev.vars` | 仅该发布者的新凭据和本机配置，0600；不含云管理权限 |
| `target.json` | 规范化后的唯一 HTTPS origin 和明确资源标识 |
| `wrangler.closed.json` | 指定 content mode，routes 为空，workers.dev 与 preview 均关闭 |
| `wrangler.public.json` | 同一绑定的单域名候选配置；生成文件不代表已应用 |
| `source-snapshot.json`、`bundle/` | 显式 bundle 时产生的源码/锁文件/产物摘要和离线构建，不包含发布密钥 |

`validation:plan` 识别此通用单发布者配置，输出 `commands_NOT_EXECUTED`，不执行其中的远端命令。
`validation:bundle` 只运行固定 `deploy --dry-run`，封装清除云凭据、关闭遥测。原两个演示发布者的验证路径继续兼容。
`enabled: false` 是离线准备状态；以后真正公开服务仍须核对云资源、凭据和域名，并另行授权。空 routes 配置不会自动解除已经存在的 Custom Domain，关闭已有入口必须显式移除绑定并复测。

自动回归覆盖任意发布者、public/closed 配置、0600、重复保留密钥、拒绝目标/模式/scope 变化、禁止复用测试密钥、离线 plan/dry-run、构建产物不含 token。测试输入均为人工夹具，不需要真实内容或云操作。

## 请求与资源

发布、更新和撤回均使用 `PUT /publish/items/{id}.json`。请求头为 `Content-Type: application/json` 和 `Authorization: Bearer <token>`；读取 manifest、Feed、详情无需凭据。公网使用 HTTPS，当前本地回环可用 HTTP。写入遇到跳转不能跟随并转发 token。

将以下合成资源保存到忽略路径 `.local/example-publisher/publish.json`。这里的发布者和来源标识仅演示通用接口：

```json
{
  "schema_version": "aig-resource/0.1-draft",
  "id": "example-synthetic-note-001",
  "publisher": { "id": "urn:publisher:example", "name": "Example 合成联调" },
  "source": { "system": "example", "record_id": "synthetic-note-001", "public_url": "https://publisher.example.invalid/synthetic-note-001" },
  "revision": 1,
  "status": "published",
  "published_at": "2026-10-19T00:00:00Z",
  "updated_at": "2026-10-19T00:00:00Z",
  "synthetic": true,
  "representations": [
    { "media_type": "text/plain", "derivation": "original", "content_text": "【合成联调】同一份最终正文。\n保留中文、换行和首尾空白。  " }
  ]
}
```

```sh
npm run publisher:send -- --file .local/example-publisher/publish.json --url http://127.0.0.1:8787/ --credentials .local/example-publisher/publisher-credentials.json
npm run client:read -- --url http://127.0.0.1:8787/ --id example-synthetic-note-001
```

发布 CLI 默认也只允许合成资源，真实内容须额外显式指定 `--content-mode public`；这不替代服务端模式和凭据校验。发布工具自己实现 HTTP 客户端时，不依赖这个 CLI，也不需要 TypeScript。

| 字段 | 发布者必须维持的规则 |
| --- | --- |
| id | 稳定、全网关不冲突的映射，正则 `^[a-z0-9][a-z0-9-]{0,95}$`。重试不能重新生成 ID；原稿 ID 不合规则时由发布工具保存映射 |
| publisher.id | 与服务端凭据 scope 完全相同；name 为发布者提供的显示名 |
| source | system 与 record_id 标识同一来源，后续不可改变；public_url 可省略或指向已公开地址，不填本地路径、数据库连接或未公开链接 |
| published_at | 首次公开时间，后续不可变；updated_at 为本次内容版本时间，重试保持原值 |
| revision | 首次 1，实际更新/撤回连续加 1；网络重试不加版本 |
| synthetic | 合成联调为 true，真实内容为 false；同一 ID 后续不能切换标记 |
| representations | 发布资源至少一份 original 的 text/plain 或 text/markdown 内联正文；正文按最终公开快照原样发送，不 trim、总结或截断 |

新版本 2 使用同一 ID/来源/首次时间，更新正文和 updated_at；撤回版本 3 使用 `status: withdrawn`、非空 withdrawal_reason、`representations: []`，保持身份字段。可省略标题和扩展。撤回不使用 DELETE，公开详情为 410 墓碑，Feed 移除该 ID；私有 D1 历史仍保留用于重试核对。重新公开需要新的连续版本和明确发布动作。

AIG revision 是这条资源的投递序号，不直接沿用发布工具内部可能跳号的草稿版本。同一 ID 按序同步；上一次结果未知时先核对，再推进下一版。首次同步尚未成功时，不能把 withdrawn 作为首版；也不能只凭本地取消动作就宣称 AIG 已撤回。

单次请求/规范化资源最多 256 KiB、响应最多 2 MiB、当前 Feed 最多 100 个已发布资源。超限会明确失败，不自动分页、截断或替换。URL 表示不会自动抓取，纯 URL、二进制及 R2 上传暂不支持。更多规则见[访问契约](access-contract.md)。

## 回执、失败和重试

成功 HTTP 200 回执包含 id、revision、outcome、current_revision、current_status。`stored` 为保存新版本；`unchanged` 为精确的历史/当前版本重试。幂等比较规范化 JSON，正文中的空白和每个版本的时间不能变化。

例如重试版本 1 时可能返回 `revision: 1, outcome: unchanged, current_revision: 3, current_status: withdrawn`：这只确认旧版曾被接受，当前仍撤回。发布工具不能因此显示“当前已公开”。超时后的状态未知，应 GET 核对或重发完全相同的版本，不生成新版本，不触发其他渠道重发。

| HTTP 状态 | 处理 |
| --- | --- |
| 400 / 415 / 422 | 检查 JSON、Content-Type、Schema、路径 ID、时间、正文及服务端模式；修正前不盲目重试 |
| 401 / 403 | 检查独立密钥、发布者 scope 和已有资源所有者；不自动换成管理员凭据 |
| 409 | 核对同版本冲突、连续版本、身份与时间；不覆盖、不自动跳号 |
| 413 | 明确提示内容过大，交由发布者决定；不静默截断 |
| 429 | 遵守 Retry-After，有限重试；保持原 payload |
| 502 / 503 / 网络超时 | 保留待同步或结果未知状态，核对服务和当前资源；有限重试，失败不能显示发布成功 |

基本错误正文为 `{"error":{"code":"..."}}`；不含 token。写入回执和读取核对各自记录，X 的成功/失败不由 AIG 判定。

## 无凭据的自动读取验收

验收基于最终公开快照，而非模型摘要。发布工具另保存以下格式的期望文件：schema_version 为 `aig-reader-expectation/1`、origin 为唯一服务 origin、gateway_synthetic 对应服务端模式、resources 为完整预期资源对象数组。撤回时放入对应的完整撤回资源，检查器会比较最小墓碑并检查 Feed 已移除。

可以从刚才的合成输入生成期望，再执行只读检查：

```sh
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const resource = JSON.parse(readFileSync('.local/example-publisher/publish.json', 'utf8'));
writeFileSync('.local/example-publisher/reader-expectation.json', JSON.stringify({
  schema_version: 'aig-reader-expectation/1', origin: 'http://127.0.0.1:8787',
  gateway_synthetic: false, resources: [resource]
}, null, 2) + '\n', { mode: 0o600 });
NODE
npm run acceptance:read -- --expect .local/example-publisher/reader-expectation.json
```

该命令不接受 `--credentials`、不读取发布密钥、不写资源或期望文件；验证 manifest/Feed origin 和模式、完整资源、正文、来源、版本、逐项合成标记、撤回 410、Feed 成员及 no-store。成功退出 0，失败非零。未知的其他发布条目不纳入所选资源的验收。

验证自己的公网实例时，在独立运行环境准备同一只读工具，只交付公开期望文件和仅含 origin 的 target 文件：

```sh
npm run acceptance:read -- --expect /path/to/public-expectation.json --target /path/to/origin.json
```

非回环必须用显式 target 允许的 HTTPS origin，拒绝其他域名、HTTP 或跳转；不关闭证书校验。检查器只报告已访问目标，不会凭响应来自某个边缘节点就断言客户端位于海外。外部执行环境及所在地、发布机断网 15 分钟等仍需实际验证，不要求真人参与。

## 一条命令完成通用本地联调

```sh
npm run acceptance:local
```

自动创建临时独立发布者和密钥、只在回环启动 public 模式 Worker/本地 D1、使用全部为 true 的合成资源，通过发布 CLI 和无凭据读取 CLI 验证发布、幂等/409、更新、重启持久化、撤回、旧请求不恢复，共五个读取检查点。结束后关闭服务并清理本轮运行数据库/密钥，合成输入、只读期望和报告保留在 `.local/publisher-acceptance/run-*/`，最新摘要为 `.local/publisher-acceptance/latest.json`。

此命令不启动发布者项目、不发送 X、不访问云资源或推送 GitHub。它证明通用接入契约；具体发布工具仍需通过自身适配器实际发起请求并验收。
