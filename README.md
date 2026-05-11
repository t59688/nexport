# NexPort

[English](./README.md) | [简体中文](./README.zh-CN.md)

NexPort is a native desktop app for managing SSH port forwarding workflows with a clean, operator-friendly UI.

Built with Tauri v2, Rust, React, and Tailwind CSS, it is designed for scenarios like:

- A can SSH into B
- B can reach C inside a private LAN
- A needs to access C's SSH or any other TCP port through B

In practice, NexPort helps you create and manage rules such as:

```text
A:local-port -> B:ssh -> C:target-port
```

## Features

- Native desktop experience on Windows, macOS, and Linux
- Manage multiple SSH forwarding rules in one place
- Local port availability check before start
- SSH host fingerprint trust flow with explicit known_hosts-style prompts
- Built-in connection testing for bind port, SSH authentication, and target reachability
- Realtime log panel for troubleshooting
- Tray mode and launch-on-startup support
- Rule import / export for backup and migration
- Compact, desktop-oriented UI with custom title bar styling

## Typical Use Cases

- Reach a private SSH server behind a jump host
- Forward database, Redis, HTTP, gRPC, or custom TCP services
- Keep repeatable tunnel rules for daily operations
- Give teammates a simpler desktop workflow instead of hand-written SSH commands

## Tech Stack

- Tauri v2
- Rust
- React 19
- Tailwind CSS 4
- Vite

## Development

Requirements:

- Node.js 20+
- Rust stable

Install dependencies:

```bash
npm ci
```

Run in development mode:

```bash
npm run tauri:dev
```

Build the frontend only:

```bash
npm run build
```

Build the desktop app:

```bash
npm run tauri:build
```

## Release

This repository includes a GitHub Actions release workflow for tagged builds.

- Push a tag like `v0.0.1`, or
- Run the `Release` workflow manually and provide an existing tag

The workflow builds platform packages and publishes a GitHub Release.

## Project Status

NexPort is focused on practical SSH tunnel management with a polished desktop UI and production-oriented backend behavior, including non-blocking tunnel handling and better multi-tunnel concurrency.

