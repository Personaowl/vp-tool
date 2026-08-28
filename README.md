# vp-tool

用于 ACM/ICPC 队伍训练的轻量虚拟比赛协作工具。队员可以进入同一个房间，同步查看和编辑多个 C++ 代码文件、按代码文件管理测试用例、共享 PDF 题面和白板内容。

## 功能

- 房间链接与用户名加入页，显示在线队员
- 多个共享 C++ 文件，可切换查看和编辑
- 每个代码文件独立的共享测试用例
- 本机 C++ 编译、运行与实时语法检查
- 题面 PDF 上传、切换和删除
- 共享白板，支持画笔、橡皮擦、笔刷大小、颜色和深浅背景
- WebSocket 心跳与自动重连
- 导出当前代码或全部代码文件

## 环境

- Node.js 18 或更高版本
- pnpm（推荐通过 Corepack 安装）
- 可选：g++，用于本机 C++ 编译、运行和语法检查
- 可选：cloudflared，用于让非局域网成员访问

安装依赖：

```powershell
corepack enable
pnpm install
```

若 pnpm 提示 `esbuild` 的构建脚本被忽略，执行：

```powershell
pnpm approve-builds
```

在列表中允许 `esbuild`，然后重新运行 `pnpm install`。

## 本地开发

在项目根目录运行：

```powershell
pnpm dev
```

打开：

```text
http://localhost:5173/room/demo
```

同一局域网内的队友可以使用 Vite 输出的 `Network` 地址，并在末尾加上 `/room/demo`。开发模式同时启动 Vite（5173）和后端（8787），适合本机调试。

## 供远程队友使用

远程测试推荐构建前端并只运行后端。后端会同时提供页面、API 和 WebSocket，监听 `8787` 端口。

### 1. 构建并启动

终端 1：

```powershell
pnpm build
pnpm dev:server
```

看到以下日志表示服务已启动：

```text
VP server listening at http://localhost:8787
```

本机访问：

```text
http://localhost:8787/room/demo
```

### 2. 创建临时 Cloudflare Tunnel

终端 2：

```powershell
cloudflared tunnel --url http://localhost:8787
```

如果 `cloudflared` 未加入环境变量，可以使用完整路径：

```powershell
C:\develop\cloudflared\cloudflared.exe tunnel --url http://localhost:8787
```

日志会给出一个临时地址，例如：

```text
https://example.trycloudflare.com
```

把下列完整房间链接发给队友：

```text
https://example.trycloudflare.com/room/demo
```

`trycloudflare.com` 是临时 Quick Tunnel：每次启动地址可能变化，且没有长期可用性保障。使用期间必须保持后端和 `cloudflared` 两个终端窗口运行，电脑也不能休眠。

## 房间使用

1. 打开房间链接，例如 `/room/demo`。
2. 输入用户名并加入房间。
3. 在左侧代码页通过 `+` 创建 C++ 文件；所有人会看到同一组文件。
4. 右侧测试区的用例属于当前代码文件，会同步给房间成员。
5. 在题面页上传或选择 PDF；删除操作会影响整个房间。
6. 在画板页绘制或清空内容；白板内容同样是共享的。
7. 使用顶部的“导出”或“全部导出”下载代码到当前浏览器设备。

房间状态仅保存在正在运行的服务进程内。重启后端会清空代码、测试用例和白板；已上传的 PDF 会保留在 `uploads` 目录中。

## 网络说明

项目使用 WebSocket 同步内容，前端已包含心跳和自动重连。Quick Tunnel 适合临时联机测试；需要固定地址和更稳定的长期使用时，建议改用 Cloudflare Named Tunnel，或将后端部署到不会休眠的云服务器。

## 常用命令

```powershell
# 开发模式：前端和后端同时启动
pnpm dev

# 生产构建
pnpm build

# 只运行后端（提供已构建的页面）
pnpm dev:server
```
