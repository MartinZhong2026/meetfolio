# Meetfolio 0.2.0-preview.1 安装与验收

这是源码重建后的跨平台预览版，不是历史 v0.6.0 的正式发行。未经用户确认不公开发布 Release。

## 下载与校验

仅使用本阶段 Draft PR 对应成功构建的 `meetfolio-preview-windows-x64`、`meetfolio-preview-macos-arm64`、`meetfolio-preview-macos-x64` Actions 产物，或仓库所有者可见的 Draft Release。Actions 下载通常需要登录 GitHub，并有保留期限；Draft Release 附件在正式发布前不对公众开放。

每份产物含安装包、`BUILD.json`、`SHA256SUMS.txt` 与本说明。核对版本、架构、源提交和 SHA-256。Windows 使用 `Get-FileHash 文件名 -Algorithm SHA256`；macOS 使用 `shasum -a 256 文件名`。校验和用于发现文件变化，不替代发行者签名。

## Windows x64

运行 `Meetfolio-0.2.0-preview.1-windows-x64-setup.exe`，建议选择仅当前用户。应用名/快捷方式为 **Meetfolio Preview**，程序为 `MeetfolioPreview.exe`。数据在 `%LOCALAPPDATA%\Meetfolio Preview`，与旧 Meetfolio 分开，不能覆盖安装旧程序目录。

此预览 EXE 没有 Authenticode 证书。Windows/组织策略可能阻止运行；先核验来源和 SHA，遵循系统明确提示，组织禁止时联系管理员。不关闭 SmartScreen、防病毒或 UAC。自动测试的静默安装、正常窗口启动和卸载不等于交互安装向导、提权和所有设备已验收。

## macOS

- Apple Silicon 下载 `macos-arm64.dmg`；Intel 下载 `macos-x64.dmg`。最低声明版本为 macOS 15，实际 CI 使用 macOS 15 Runner，其他系统版本仍需人工验收。
- 挂载 DMG，将 **MeetfolioPreview.app** 拖至你的 Applications 目录；ZIP 是相同架构 App 的替代分发。不要用错误架构或将两个架构混装成一个 App。
- 应用仅有 **ad-hoc 本地签名**，没有 Apple Developer ID、没有 Apple 公证，本预览也未启用 Hardened Runtime；不能宣称受信任正式发行。没有加入放宽库校验或任意可执行内存的 entitlement。Gatekeeper 对下载隔离文件可能阻止打开。仅按 Apple 的系统提示核验来源并处理；组织策略禁止时停止。不要运行关闭 Gatekeeper、移除隔离属性、关闭 SIP 等命令。
- CI 会验证 DMG 挂载、App 复制、架构、代码签名完整性、正常启动及离线文件处理。Runner 上没有下载隔离的启动成功不能证明用户下载后的 Gatekeeper 放行，也不能替代物理麦克风权限验收。
- 数据在 `~/Library/Application Support/Meetfolio Preview`；与旧应用分开。删除预览 App 不删除该目录。

## 模型与核心流程

1. 打开 **Model & Settings**，下载 X-ASR 模型，或通过 **Import model** 导入对应官方压缩包；应用会校验摘要再加载。说话人模型也需一次显式下载或离线导入。模型不会打进安装包，许可与来源见安装资源中的 licenses 及仓库第三方说明。
2. Windows 长音频需要可选下载/导入固定版本 FFmpeg GPL ZIP；不随安装包分发。macOS 使用随 App 从本仓库源码构建的 AVFoundation 辅助程序，使用系统 WAV/MP3/M4A 解码器，不下载或执行 Windows FFmpeg。
3. 选择 **Import audio → Choose recording**，确认处理许可后开始。原生路径上限 120 分钟 / 2 GiB；小文件浏览器回退仍为 64 MiB / 20 分钟。原文件只读，应用保存单声道 16 kHz WAV 副本；请另行保留原文件。
4. 转录、说话人标记和时间戳都可能有误。逐句回放、修改文字、纠正说话人并查看 **Needs review**。验证 TXT/Markdown/DOCX 导出可打开，中文/英文未损坏。时间戳不是字级强制对齐，重叠发言无法保证分离准确。
5. 推理每两分钟保存检查点。取消后重启，在 **Continue unfinished work** 继续，并核对已修改文字和说话人。解码阶段中断不支持压缩文件字节级续传；可保留/恢复已保存 WAV 后重试。
6. 一次性设置完成后断开系统网络，再测试中文、英文、混合语音、多人交替和重叠，以及 60～120 分钟真实访谈。自动化使用公开/合成音频，不能给出真实听辨准确率承诺。
7. 接入真实麦克风/耳机，首次授权、拒绝后重试、暂停继续、拔插设备、休眠唤醒和安装卸载均需人工验收。macOS Runner 的文件导入不是实际麦克风权限测试。

## 数据与卸载

卸载/删除 App 默认保留 Preview 数据；这不是备份。JSON 不包含 WAV、模型或检查点；导出 JSON 和各 WAV 并安全保存。预览数据未加密、不自动同步。旧应用数据不自动迁移，完整音频备份恢复不属于本阶段。不要用重要访谈作为首次试用数据。

旧 `recovery-reference` 编译资产不随新安装包交付。跨平台打包结果、测试状态、签名状态及源提交以对应 Actions 作业和 BUILD.json 为准；失败或未运行的平台不得仅凭文件存在宣称已验证。
