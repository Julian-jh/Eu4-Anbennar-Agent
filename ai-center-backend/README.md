# Data → Sources 后端

本地管理员可通过 Data → Sources 页面或 FastAPI 交互文档测试 PostgreSQL 草稿连接、保存来源、同步表目录，并按权限查看字段或样例。API 和同步 worker 共用一个平台元数据库。来源账号用于读取另外配置的目标库。其他前端菜单仍运行演示流程。

## 在 Windows 启动

准备 Python 3.12、一个空的 PostgreSQL 平台库及一个来源库。平台连接账号需要在平台库建表和执行迁移的权限。来源连接使用独立的只读账号，需要登录、目标 schema 的 USAGE 和所需表的 SELECT；使用密码认证，保留行级策略。开发时仅在回环地址使用专用测试凭据。

在 PowerShell 中进入后端目录，首次安装依赖并初始化本机配置。

```powershell
Set-Location -LiteralPath 'D:\Eu4&Anbennar Agent\ai-center-backend'
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m sources init
```

初始化默认在当前用户目录的 `.eu4-sources` 建立加密密钥、幂等签名密钥、权限清单以及 30 天有效的本机管理员 token。让运行账号独占该目录的文件权限，密钥独立于平台数据库备份。再次启动复用同一目录，初始化只接受新目录。所有命令支持在子命令前传 `--profile <路径>`。

在两个终端中都设置平台连接地址，使用实际创建的平台账号和数据库名称。下面使用示例值，URL 中的密码若含保留字符需做 URL 编码。可用进程的环境配置注入实际值。

```powershell
$env:SOURCES_DATABASE_URL = 'postgresql+psycopg://platform_user:DEV_PASSWORD@127.0.0.1:5432/ai_center'
```

本机无 TLS 的测试来源需在两个终端中显式启用 `$env:SOURCES_ALLOW_INSECURE_LOOPBACK = '1'`，表单中选 `local-development`。默认允许的来源主机为 `localhost,127.0.0.1,::1`、端口为 `5432`。对于其他目标，在 API 和 worker 进程配置 `SOURCES_ALLOWED_HOSTS`、`SOURCES_ALLOWED_NETWORKS`、`SOURCES_ALLOWED_PORTS`，均为逗号分隔清单。远程来源用 `workspace-default` 和受信任的 CA，必要时用 `SOURCES_SSLROOTCERT` 指定 CA 文件。源端连接同时核验目标主机名、解析地址和端口。

双击项目根目录的 `start-frontend.bat` 可一次启动管理前端、API 和 worker。工作台位于 [Data → Sources](http://127.0.0.1:63074/#/data/catalog)。启动器将 `local-development` 用作本机回环来源可选的 TLS 策略。可将平台连接 URL 作为单行保存到配置目录的 `platform.url`，由该目录的文件权限保护；显式设置的 `SOURCES_DATABASE_URL` 优先。使用 Docker 承载平台库时，先启动 Docker Desktop 和相应数据库容器。

也可以分开运行。第一个终端升级平台库并启动 API。

```powershell
.\.venv\Scripts\python.exe -m sources migrate
.\.venv\Scripts\python.exe -m sources serve
```

第二个终端从相同目录启动 worker。

```powershell
.\.venv\Scripts\python.exe -m sources worker
```

独立运行 API 时，打开 [本地 API 交互文档](http://127.0.0.1:8000/docs)，在 **Authorize** 中填写用户目录 `.eu4-sources/admin.token` 文件中的 token。API 默认绑定 `127.0.0.1:8000`，根路径提供同一套管理前端。双击工作台启动器时，前端与 API 都在 63074。如需部署到其他机器，入口须配置 HTTPS。

## 验证一次真实来源

| 顺序 | 交互文档中的操作 | 应看到的结果 |
|---|---|---|
| 1 | POST `/api/v1/source-connection-tests`，提交 connection、一次性 password 和新的 `Idempotency-Key` | 得到测试 ID、状态和耗时。列表中没有因此增加来源。 |
| 2 | POST `/api/v1/sources`，提交 name、corpus 和同一 connection。需要后台连接时，显式传入 `credential.action=replace` 和 `credential.password` | 响应 201，记下来源 id、响应头 ETag。详情只披露是否已配置凭据。 |
| 3 | POST `/api/v1/sources/{id}/sync-runs`，打开响应 Location | worker 发布完整目录后，运行状态为 `succeeded`，可通过 `/assets` 浏览表及视图。 |
| 4 | 打开某个资产的详情，再对表调用 `/assets/{asset_id}/preview` | 详情含字段。默认样例最多 15 行，每个值都被遮罩。视图提供字段详情。 |
| 5 | PATCH 来源，提交当前 `If-Match`、新幂等键和 `{"preview_columns":{"<asset UUID>":["country"]}}`，再用 L4 身份请求 `?mode=raw` | 获准的 country 显示原值，其他字段继续遮罩。空放行清单时请求原值返回 403。 |

每个写请求用独立的幂等键，同一次操作重试时复用原键。来源的每次成功编辑返回新的 ETag。要导入仓库的表由 Datasets 选择。上述步骤只登记连接和读取目录。

## 设置查看权限

初始化生成的 `actors.json` 为单机凭据清单。每个主体有稳定的 `id`、`workspace`、`expires_at`、高熵随机 token 的 SHA-256 十六进制摘要和 `grants`。只给持有人原 token，清单存摘要。部署也可用 `SOURCES_ACTORS_FILE` 指定受控清单。移除文件中的主体或权限，对后续请求即时生效。CLI 和 API 共用同一套能力。

| 能力 | 可执行操作 |
|---|---|
| `catalog`、`fields`、`preview_masked`、`preview_raw` | 依次对应目录、字段、脱敏样例、获准列原值；较高级包含较低级。 |
| `manage`、`credentials`、`preview_policy` | 分别允许管理来源、随变更保存或解除凭据、随变更维护原值列清单。后二者更新来源时都需配合 manage。 |
| `test`、`sync`、`runs` | 分别允许执行连接测试、提交同步和查看运行详情。 |

例如，负责确认目录范围的人员可仅授予 `fields`；排查数据格式时可授予 `preview_masked`；负责同步的自动化账号可授予 `sync` 与 `runs`。每个数据源的列清单用稳定资产 ID 绑定；角色的原值权限和资产放行清单须同时满足。

## 运行回归测试

使用专用的可丢弃 PostgreSQL 实例。测试会新建并清理带随机名称的数据库、schema 或角色，并会写入用于测试的已迁移平台库。测试用管理员 DSN 使用 psycopg 支持的 `postgresql://` 格式。不要指向日常使用的数据。

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
$env:SOURCES_TEST_ADMIN_DSN = 'postgresql://test_admin:DEV_PASSWORD@127.0.0.1:5432/postgres'
$env:SOURCES_TEST_DATABASE_URL = 'postgresql+psycopg://test_admin:DEV_PASSWORD@127.0.0.1:5432/disposable_platform'
$env:SOURCES_DATABASE_URL = $env:SOURCES_TEST_DATABASE_URL
.\.venv\Scripts\python.exe -m sources migrate
.\.venv\Scripts\python.exe -m pytest -q tests
```

HTTP 测试从空库执行 Alembic 迁移，通过真实源端账号验证草稿、同步和分级预览。平台数据库集成测试覆盖并发、回滚、权限绑定、运行重领和快照发布。设计契约见 [后端开发要求](design/backend-requirements.md) 和 [PostgreSQL Sources](design/sources-postgresql.md)。
