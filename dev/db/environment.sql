-- Diagnostic table only. This is not a content schema or production migration.
CREATE TABLE IF NOT EXISTS aig_environment_probe (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL
);

INSERT INTO aig_environment_probe (id, body)
VALUES ('synthetic-probe', 'AIG 合成本地环境检查
第二行：完整保存；不代表业务链路验收。
https://publisher.invalid/environment')
ON CONFLICT(id) DO UPDATE SET body = excluded.body;
