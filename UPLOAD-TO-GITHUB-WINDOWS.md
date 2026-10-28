# 将 Meetfolio 恢复源码上传到新 GitHub 账号（Windows）

**注意：这是恢复中的可编辑源码，不是完整 v0.6.0。** 请先不要公开宣称已发布 v0.6.0。

## 推荐：GitHub Desktop

1. 在 Windows 下载 `Meetfolio_GitHub_Recovery_Repository_2026-10-26.zip`，右键 **全部解压缩**，确认解压文件夹 **Meetfolio-GitHub-Recovery** 里直接能看到 `package.json`、`desktop/`、`web/`、`server/`、`README.md`。
2. 打开 GitHub Desktop 并登录有权发布的账号（GitHub 登录页面可确认身份）。
3. 菜单 **File → Add Local Repository... → Choose...**，选择 **Meetfolio-GitHub-Recovery** 文件夹。因原备份不带 `.git`，提示不是仓库时点击 **create a repository here**，创建本地 Git 仓库。Git ignore 选 **None**（目录已有 `.gitignore`），许可证选 **None**（已有 `LICENSE`），以免覆盖文件。若没有该按钮，也可以先通过 **File → New Repository** 新建相应本地仓库，再复制所有解压文件（包括隐藏的 `.gitignore`）进去。
4. 打开 **Changes** 页面，审阅没有密钥、录音、`.env` 等私人文件；填提交说明 `Recover editable Meetfolio source and v0.5.1 reference assets`，点击 **Commit to main**。
5. 点击 **Publish repository**。建议先保留 **Keep this code private**，检查远程仓库中文件结构后再判断是否公开。名称可用 `meetfolio-recovery`。
6. 打开 GitHub 网页，确认根目录看到 `package.json`、`desktop/`、`web/`、`server/`、`recovery-reference/`。不要只看见一个 ZIP 文件。

## 上传前检查

- 恢复包没有原始 Git 历史，发布后第一个提交是新的，不等于恢复以前的 PR 或分支。
- 原 GitHub 账号已暂停，此恢复仓库不代表封禁已解除；应继续保留本地与腾讯云离线备份，遵守 GitHub 的账户政策。
- `recovery-reference/v051-compiled/` 是编译结果，用于核对功能；不是可继续日常维护的 TypeScript 源码。
- `recovery-reference/v051-english-overlay/` 仍是未经 Windows 实机验收的补丁，不是正式 Windows 安装包。
- 历史 GitHub Actions 工作流已移入非活动参考目录，避免首次提交直接触发旧版有问题的自动构建。

## 为什么不推荐浏览器一次性上传？

GitHub 网页上传一次通常最多 100 个文件。本恢复仓库有 300 多个文件，GitHub Desktop 可以统一提交并保留目录结构。上传原始 ZIP 作为**单个文件**仅能存档，不能让 GitHub 将内部文件视为源代码。
