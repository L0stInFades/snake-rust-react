# Rust + React 高性能网页贪吃蛇

这是一个把 **Rust 游戏逻辑编译为 WebAssembly**，再由 **React + TypeScript** 渲染的网页小游戏。项目目标是：

- 保持经典贪吃蛇玩法不变
- 逻辑层用 Rust 写得更快更稳定
- 前端负责画面、键盘交互和状态显示
- 提供一个可用的“作弊/调试菜单”

项目包含三条主线：

- `engine/`：Rust 核心引擎（WebAssembly）
- `frontend/`：Vite + React + TypeScript 前端
- 根目录 `package.json`：把编译和启动串起来的脚本

## 目录结构

- `engine/Cargo.toml`
  - Rust 库配置
- `engine/src/lib.rs`
  - 贪吃蛇核心逻辑：棋盘、移动、撞墙、得分、作弊状态
- `frontend/src/App.tsx`
  - 游戏主循环、键盘控制、绘制、菜单状态
- `frontend/src/styles.css`
  - 网格、标题、提示、作弊菜单样式（含无敌模式高亮）
- `frontend/src/main.tsx`
  - React 挂载点
- `frontend/vite.config.ts`
  - Vite 配置

---

## 一、先决条件

你至少需要：

- Node.js 18+
- npm
- Rust + cargo
- wasm 工具链（`wasm32-unknown-unknown`）
- wasm 打包工具：`wasm-pack`

安装顺序（一次性执行）：

```bash
# 安装 rust（如果还没有）
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 安装 wasm 目标
rustup target add wasm32-unknown-unknown

# 安装 wasm-pack
cargo install wasm-pack
```

---

## 二、安装依赖

```bash
cd /Users/Apple/snake-rust-react
npm install --prefix frontend
```

这条命令只安装前端依赖。Rust 端用 cargo 依赖在 `engine/Cargo.toml`，用 wasm-pack 打包时自动读取。

---

## 三、运行（本地开发）

### 常用命令

- `npm run dev:local`
  - 先编译 Rust（生成 WASM）再启动 Vite
  - 强制监听 `127.0.0.1:5173`
  - 遇到端口问题时最稳妥
- `npm run dev`
  - 使用默认主机，启动开发服务器
- `npm run build`
  - 生产构建：先打包 Rust 再构建前端
- `npm run preview`
  - 预览构建产物

### 启动步骤

```bash
cd /Users/Apple/snake-rust-react
npm run dev:local
```

启动后，在浏览器打开：

- `http://127.0.0.1:5173/`

> 如果你之前遇到 “localhost 拒绝连接” 或 “ERR_CONNECTION_REFUSED”，优先用 `127.0.0.1`，并确认端口已启动。

### 本地端口冲突（快速处理）

如果 5173 被占用，先杀掉旧进程：

```bash
lsof -i :5173
kill <PID>
```

然后重新运行 `npm run dev:local`。

---

## 四、玩法说明

### 基本玩法

- 方向控制：
  - `W/A/S/D`
  - 或方向键 `↑/↓/←/→`
- `Esc`
  - 暂停 / 继续
- 游戏目标：
  - 吃到食物成长，积分提升
- 画面刷新来自 WASM 状态，每帧只重绘网格，不做重算整图

### 作弊（调试）菜单

按键 **`\`（反斜杠键）** 打开菜单。

特点：

- 默认不弹显式文字提示，界面内即可看见当前菜单与状态。
- 菜单出现时会暂时暂停游戏（返回原样继续）
- 菜单项与状态支持自由组合开关

菜单三项：

1. **无敌模式**
   - 开启后：碰撞墙体/自己身体不再立即死亡
   - 无敌状态有独立视觉风格（游戏内高亮提示）
2. **10 倍得分**
   - 每次吃食物加分 ×10
3. **随机增长**
   - 每次吃食物后，尾部额外随机增长 1~6 个单元

菜单操作：

- `W/↑`：上一个
- `S/↓`：下一个
- `Enter`：切换当前选项（第一次开启，第二次关闭）
- `Esc`：退出菜单

> 该机制允许“任意组合”，例如同时开启无敌 + 10 倍，或只开随机增长。

---

## 五、项目怎么运行起来（简要原理）

### 1) Rust 负责“规则判断”

在 `engine/src/lib.rs` 中，`Game` 结构体保存整局状态：

- 棋盘（`Vec<u8>`）
- 蛇身体（`VecDeque<u16>`）
- 方向、速度、食物、得分
- 特性开关（无敌、得分倍率、随机增长）

每次 `tick()`：

- 计算下一格
- 判断是否死亡或吃到食物
- 更新分数/长度
- 写回线性内存中的棋盘状态

### 2) 前端负责“读取 + 绘制 + 控制”

- `frontend/src/App.tsx` 每帧读取 `Game` 当前内存（`board_ptr`）
- 按不同值绘制格子颜色：空白、蛇身、蛇头、食物
- 接收键盘事件，控制方向和菜单
- 将 `status`、`score`、最高分等 UI 信息渲染出来

### 3) 为什么这样快

- 游戏状态在 Rust 内存中连贯更新，前端只做视图映射
- `VecDeque` 做头尾高效出入队，适合“蛇移动”这种场景
- `reset / tick / set_direction` 较轻量，适配持续高频刷新

---

## 六、开发与调试

### 看到“页面无响应”时的检查顺序

1. 确认端口服务是否启动：

```bash
npm run dev:local
```

2. 看浏览器访问地址是否一致（务必是 `127.0.0.1:5173`）
3. 看终端有无打包错误，尤其 `wasm-pack` 阶段
4. 杀掉占用端口进程后重启

### 修改样式

- 菜单样式在 `frontend/src/styles.css`
- 想改网格大小/颜色，只改 `CELL_SIZE` 与 CSS
- 想改按键文本可改 `App.tsx` 内 UI 文案

### 常见风险点

- 若直接双击 `index.html` 打开，不会启动 Vite dev server（无法访问模块）
- `localhost` 与 `127.0.0.1` 在部分环境解析差异存在，建议按前文地址
- 调整 `tick_interval_ms` 可改变难度（值越小，游戏越快）

---

## 七、常用脚本

```bash
# 启动开发（推荐）
npm run dev:local

# 只构建（不运行）
npm run build

# 预览构建结果
npm run preview
```

---

## 八、贡献说明（可选）

如果你要继续改这个仓库：

- 想优化性能：先改 `engine` 的状态更新逻辑，再考虑前端批量绘制优化
- 想改功能：优先在 `engine` 增加公开 setter，再在 `App.tsx` 绑定快捷键
- 想加音效：放在前端 `requestAnimationFrame` 间隔里触发，避免阻塞主循环

## 九、许可证

本项目使用自定义 `GDH` 许可证：

- 12 岁以下用户（未成年人）：按 MIT 协议授权
- 12 岁及以上用户：按 GPLv3 授权

完整条款见根目录 [`LICENSE`](./LICENSE)（Markdown 文档）。

说明：项目本身不做年龄认证，发布与分发方应遵守本仓库许可证约定并在接入层承担用户年龄合规责任。
