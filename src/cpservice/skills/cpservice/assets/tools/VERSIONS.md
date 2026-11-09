# assets/tools 二进制来源

| 文件 | 版本 | 来源 | sha256 |
|---|---|---|---|
| `openixcli` | 0.2.4 | 由 `~/Downloads/OpenixCLI.zip` 源码构建：`cargo build --release`（Rust 1.93.0，release profile 已 strip；依赖 libusb-1.0）。上游 MIT，许可证见 `LICENSE.openixcli`。 | `bd6e47c8b61e7386056f1865c19eced80f06d68e0e74109c1e36f8b07008611a` |
| `rk_upgrade_tool` | v2.22（`Upgrade Tool v2.22`） | 复制自主机 `/usr/bin/rk_upgrade_tool`（Rockchip upgrade_tool，静态链接 x86-64 ELF）。 | `1e5ae18432087dfa7f03704efd9c2a4d383f82edd031850b2ab536a2d22e7cad` |

- 重新构建 `openixcli`：

  ```bash
  unzip -q ~/Downloads/OpenixCLI.zip -d /tmp/openixcli-src
  cd /tmp/openixcli-src/OpenixCLI
  CARGO_HOME=/tmp/openixcli-cargo cargo build --release
  install -m 755 target/release/openixcli <插件>/skill/assets/tools/openixcli
  sha256sum <插件>/skill/assets/tools/openixcli   # 记回本文件
  ```

- `flash.sh` 解析顺序：`FLASH_TOOLS_DIR` → 本目录 → `PATH` → `/usr/bin`；`RK_UPGRADE_TOOL` / `OPENIXCLI` 环境变量可覆盖。
