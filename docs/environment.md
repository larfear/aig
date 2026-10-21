# 本地开发环境

## 必要工具

- Node.js 24.14+ 的 24.x 版本；仓库固定版本为 24.14.0。
- npm；`packageManager` 声明 npm 11.9.0，使用 `package-lock.json`。
- Git、OpenSSL（本机 HTTPS 测试生成短期证书）。

维护者在 macOS 上完成本地回归；GitHub CI 使用 Ubuntu。其他操作系统需要自行核对运行时与文件权限行为。

## 安装与检查

```sh
npm ci
npm run doctor
npm run verify
```

`.npmrc` 使用项目内缓存、精确版本，并禁用依赖生命周期脚本。Wrangler、TypeScript、Ajv 等由锁文件管理。`doctor` 核对工具与已安装依赖版本；`verify` 同时运行类型、Schema、功能及本地生命周期检查。

需要保存环境摘要时运行 `npm run doctor -- --write`，结果位于忽略的 `.local/environment.json`。无需云账号、API Token 或付款方式。

## 目录

| 路径 | 内容 |
| --- | --- |
| `src/core/` | 资源、模式、发布者和 HTTP 通用规则 |
| `src/adapters/` | 文件与 D1 源 |
| `src/worker.ts` | Workers 托管入口 |
| `src/client.ts`、`src/reader-check.ts` | 读取客户端与精确验收 |
| `scripts/` | 发布、读取、本地启动、部署准备和检查工具 |
| `schemas/`、`examples/` | 草案契约与合成样例 |
| `migrations/` | 托管数据库迁移 |
| `tests/` | 本地功能、HTTPS、发布者与部署配置回归 |
| `.local/`、`.cache/`、`.wrangler/` | 生成配置、密钥、本地数据库、缓存和报告，均不提交 |

`wrangler.local.jsonc` 是环境探针，`wrangler.hosting.local.jsonc` 是本地托管配置。全零 D1 ID 仅作本地占位，不对应可用云数据库。

本地封装固定使用 `--local` 与回环监听，清除继承的 Cloudflare/AIG 配置，使用项目隔离的 CLI 状态。它不会部署远端资源。实际部署应使用[独立准备配置](prelaunch-local.md)，不要把本地配置直接作为生产配置上传。
