# Eu4-Anbennar-Agent

完成一次后端配置后，在 Windows 双击根目录的 `start-frontend.bat`，即可在同一地址打开前端和 Sources API。启动器检查平台库迁移并运行目录同步 worker。保留服务窗口，按 Ctrl+C 停止。重复双击会打开正在运行的工作台。[本地 Sources 页面](http://127.0.0.1:63074/#/data/catalog) · [首次配置](ai-center-backend/README.md)

在 Data → Sources 粘贴本机访问令牌登录。默认令牌文件为 `%USERPROFILE%\.eu4-sources\admin.token`。下面的 PowerShell 命令将令牌复制到剪贴板。页面刷新后需要重新登录。

```powershell
Set-Clipboard -Value (Get-Content -Raw -LiteralPath "$env:USERPROFILE\.eu4-sources\admin.token").Trim()
```

首次登录的空工作区会显示空列表。选择 **Add source**，输入 PostgreSQL 连接参数。测试草稿、显式保存凭据后，可以在详情同步并预览表。数据集导入、其他连接器和工作台其余菜单目前仍使用前端演示流程。

在 VS Code 中打开整个项目文件夹，打开 `start-frontend.bat` 后点击右上角的 **Run Code** 也可启动。在项目根目录的终端中，可以直接运行 `.\start-frontend.bat`。
