# Meetfolio v0.5.1 已编译资源（非原始源码）

本文件包从用户自己的 0.5.1 Windows 安装程序中提取关键 Electron 主进程/预加载脚本、app.asar、生产前端 UI 和 X-ASR 脚本。**不是 Windows 安装包，不是 v0.6.0 源码，也没有 .git 或完整 npm 源代码。**

- `v051_compiled_reference/recovered-app/dist/main.cjs`：Electron 编译后主进程
- `v051_compiled_reference/recovered-app/dist/preload.cjs`：Electron 编译后预加载桥
- `v051_compiled_reference/resources/ui/`：中文版生产 UI，保留未改动的原件
- `v051_compiled_reference/resources/xasr/asr/`：服务于本机 X-ASR 的已编译 JS
- `v051_compiled_reference/resources/app.asar`：原始 ASAR

这里没有完整 Windows 运行时 DLL，也不是可直接启动的软件。用户已拥有原版安装 ZIP，请继续从原安装包正常安装。若要测试英文界面，使用单独的 `Meetfolio_v051_English_Overlay_Preview.zip`。若要继续编程，请同时保管原来的 `Meetfolio_Incremental_Reconstruction_Stage1.zip`（可编辑但较旧），不可把两个来源混为同一源码版本。
