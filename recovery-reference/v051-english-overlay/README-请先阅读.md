# Meetfolio v0.5.1 → English UI Preview｜用户操作指南

**本文件不是官方 v0.6.0 安装包，也不包含 Windows EXE 或 Mac DMG。**

这是一套从用户提供的 **Meetfolio v0.5.1 Windows x64 正式安装文件** 中恢复原始已构建前端，并翻译其 UI 文案制作的**英文界面预览补丁**。原 Electron 主进程、X-ASR、WAV 录音、PDF/DOCX 提取、原生音频回放等程序没有修改，安装后软件版本仍显示 **v0.5.1**。翻译后的 UI 有待 Windows 实机验收，不能当作已重现官方 v0.6.0。

## 安装前（重要）

1. 用你原有的 `Meetfolio-0.5.1-windows-x64-setup.exe` 安装 v0.5.1。**不要尝试用这个 ZIP 代替 Windows 安装程序**。
2. 打开原版 Meetfolio → 模型与设置 → 导出 **JSON 备份**。**JSON 不包含 WAV 录音**；重要音频请另行复制录音目录。
3. 关闭 Meetfolio，包括托盘/后台进程。如软件已启动，运行补丁脚本将拒绝修改。
4. 不要关闭 Defender、SmartScreen、Gatekeeper 等系统保护，不要使用来源不明的补丁。

## 方法 A｜使用本 ZIP 内的 PowerShell 安装脚本

1. 把本 ZIP **全部解压**到自己的电脑，例如下载目录里的 `Meetfolio-v051-English-Preview`。
2. 在解压文件夹打开 Windows PowerShell，执行 `./Install-English-Preview.ps1`。
3. 如果曾选择“为所有用户安装”，可能需要有权修改程序安装目录的账户。脚本不会自动获取管理员权限；若提示拒绝访问，请不要强行绕过系统保护。
4. 脚本会核对原始中文版主 UI JS 的 SHA-256；只支持与当前上传的 v0.5.1 构建一致的安装版本。脚本先在 **文档** 文件夹保存完整 UI 备份，然后替换 `index.html`、`sw.js` 并复制新的英文 JS 资源。
5. 再打开 Meetfolio。首先用**虚构数据**测试准备、录音、中文/英文 ASR、人工笔记、逐句播放、JSON/MD/PDF 导出和重新启动。

如果系统不允许运行 PowerShell 脚本，可选择手动方法（见下），**不要求改变全局执行策略**。

## 方法 B｜手动安装（不运行脚本）

原安装目录通常是以下路径之一：

- 当前用户安装：`%LOCALAPPDATA%\Programs\Meetfolio\resources\ui\`
- 全部用户安装：`C:\Program Files\Meetfolio\resources\ui\`

**只有当目录中确实存在 `index.html` 和 `assets\index-IyWnOIEo.js` 时才继续。**

1. 先把原来整个 `resources\ui` 文件夹复制到一个独立备份目录（不能覆盖原文件）。
2. 将 ZIP 中 `resources\ui\index.html` 复制到安装目录的 `resources\ui\index.html`，允许替换。
3. 将 ZIP 中 `resources\ui\sw.js` 复制到安装目录对应位置，允许替换。
4. 将 ZIP 中 `resources\ui\assets\index-english-b561f2b979.js` 放入安装目录的 `resources\ui\assets\`。
5. **不要删除**原始 `index-IyWnOIEo.js`、原始 CSS、原生 DLL、`app.asar` 或 X-ASR 文件。
6. 打开软件，检查英文界面。若出现异常，关闭软件并从备份目录恢复原始 `resources\ui` 文件夹。

## 回滚

- 如果用脚本安装，备份目录会在安装成功时显示，并写入 `BACKUP_LOCATION.txt`（不含隐私数据）。运行 `./Restore-Chinese-Backup.ps1 -BackupDir "完整备份文件夹路径"` 即可恢复原始文件。
- 如果采用手动方法，关闭 Meetfolio 后从你刚保存的备份中恢复 `resources\ui`。
- 安装包会保持 v0.5.1，若重新安装 v0.5.1，软件文件也可能恢复为中文版。

## 已验证 / 未验证

**已验证：** 原始 ZIP 的 CRC 与安装包 SHA-256；NSIS 内嵌资源能被解包；`app.asar` 的主进程、预加载脚本 SHA-256 与归档头一致；翻译覆盖 399 个含中文文本节点；英文 UI JS 语法校验通过；翻译前后 JavaScript AST 节点、调用表达式、字符串节点数量完全一致；`index.html` 与 Service Worker 指向正确的新文件。

**未验证：** 在真实 Windows 硬件上运行补丁、实际麦克风和 X-ASR、WAV 录音回放、SmartScreen/权限、首次安装与卸载、macOS。没有进行官方 v0.6.0 二进制逐字节对比。

**隐私说明：** 此补丁不会新增上传数据的逻辑，原本的软件本地研究资料可能仍未加密；不要将真实访谈数据用于公开调试。
