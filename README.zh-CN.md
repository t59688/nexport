# NexPort

[English](./README.md) | [简体中文](./README.zh-CN.md)

NexPort 是一个用于管理 SSH 端口转发的原生桌面应用，界面简洁，适合长期日常使用。

它基于 Tauri v2、Rust、React 和 Tailwind CSS 构建，主要面向这样的网络场景：

- A 可以通过 SSH 连接到 B
- B 可以访问局域网中的 C
- A 需要通过 B 访问 C 的 SSH 或任意 TCP 端口

实际效果可以理解为：

```text
A:本地端口 -> B:ssh -> C:目标端口
```

## 功能特性

- 支持 Windows、macOS、Linux 的原生桌面体验
- 在一个界面中管理多条 SSH 转发规则
- 启动前检测本地监听端口是否被占用
- 提供明确的主机指纹信任流程，类似 known_hosts
- 内置连接测试，可检查本地端口、SSH 认证和目标端口可达性
- 实时日志面板，便于排障
- 支持托盘常驻与开机自启
- 支持规则导入 / 导出，方便备份与迁移
- 偏桌面软件风格的紧凑界面与自定义窗口栏

## 典型使用场景

- 通过跳板机访问内网 SSH
- 转发数据库、Redis、HTTP、gRPC 或其他 TCP 服务
- 保存需要反复使用的隧道规则
- 用桌面软件替代手写 SSH 命令，提高协作和操作效率

## 技术栈

- Tauri v2
- Rust
- React 19
- Tailwind CSS 4
- Vite

## 本地开发

环境要求：

- Node.js 20+
- Rust stable

安装依赖：

```bash
npm ci
```

启动开发环境：

```bash
npm run tauri:dev
```

仅构建前端：

```bash
npm run build
```

构建桌面应用：

```bash
npm run tauri:build
```

## 发布

仓库已包含 GitHub Actions 发布工作流。

- 推送形如 `v0.0.1` 的 tag，或
- 手动运行 `Release` 工作流，并指定一个已存在的 tag

工作流会自动构建各平台安装包并发布到 GitHub Release。

## 项目状态

NexPort 当前重点是提供更稳定、更适合生产环境的 SSH 隧道管理体验，包括非阻塞的后端处理方式，以及更好的多隧道并发支持。

