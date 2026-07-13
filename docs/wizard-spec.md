# 交互式安装 Wizard 规格（grill-me 会话产出）

> 2026-07-13 经由 /grill-me 审问式访谈定稿。目标：实现类似
> [mattpocock/skills](https://github.com/mattpocock/skills) 的 CLI 引导安装体验。
>
> **状态：已实现（Phase 1 + Phase 2，Phase 2 已按 `npx skills` 语义重构）。**
>
> **2026-07-13 需求澄清后的重大修订**：用户要的是复刻 `npx skills@latest add <repo>`
> 的 wizard 本身。`boss skills add` 已按其语义重构：
> - **默认装到项目目录（cwd）**，不再是 agent 的 home 目录；`--global` 才走 home 级安装 + `~/.boss/installed.json` manifest。
> - **完整移植 73-agent 注册表**（`src/skills/agent-registry.ts`）：`skillsDir === '.agents/skills'` 的 agent 构成
>   「Universal — always included」锁定组（安装时收敛为一份拷贝），其余为 Additional agents。
> - **自研 `searchMultiselect` 组件**（`src/skills/search-multiselect.ts`）：锁定区 + 实时搜索过滤 +
>   空格多选 + 滚动窗口（↑/↓ N more）+ Selected 摘要行，与 clack 符号体系无缝衔接。
> - **项目级 lockfile `skills-lock.json`**（`src/skills/project-lock.ts`），记录 source/ref/commit/dirs，
>   支撑 list/update/remove；另有 `~/.boss/last-selected-agents.json` 记忆上次 agent 选择。
> - BOSS 像素字 banner + 灰度渐变（`src/skills/banner.ts`）。
> - Phase 1 自装 wizard 不变。测试：`test/skills-manager/`（22 单测 + CLI 端到端），全套 697 用例绿。
>
> **第二次澄清（同日）**：最终确认的核心诉求是 `boss-skill` **自装**时呈现
> `npx skills add` 同款引导页。Phase 1 自装 wizard 已重写
> （`src/skills/self-install-wizard.ts`）：BOSS 像素 banner → `Found 1 skill`
> （BOSS 作为单个 skill）→ `5 agents` → searchMultiselect：已检测到的 agent
> 作为「Detected agents ── always included」锁定区，未检测到的在 Additional
> agents 可搜索勾选（勾选即凭空创建目录）→ 逐 agent 安装（重装时行内显示
> `vX → vY` 升级）、失败不中断、Codex hooks 合并与 Claude plugin 提示以
> `↳` 附注展示。安装目标保持 home 级不变（用户选择），触发条件不变
> （TTY 裸跑；非 TTY / --yes 走原自动安装）。

## 定位与阶段

**两阶段交付：**

- **Phase 1** — 把 `boss-skill` 自装流程 wizard 化（检测 agent → 选择目标 → 确认 → 安装），
  架构上预留 `source → discover → select → install` 四段抽象。
- **Phase 2** — 通用 skill 安装器：从任意 git 仓库发现 skills，多选后装入多个 agent。

## 已定决策

### 交互触发（Phase 1）

- `boss-skill` 裸跑：**stdin 为 TTY 时进入 wizard**；非 TTY（CI/管道）保持现有
  auto-detect 全量安装行为，零破坏。
- 提供 `--yes` / `--non-interactive` 显式跳过 wizard。

### TUI 技术选型

- 引入 **`@clack/prompts`**（放弃 boss-cli 的零运行时依赖原则，换取截图同款的
  多选、分组、spinner、步骤符号体验）。

### Agent 选择步

- **分组呈现**：`detect()` 为 true 的 agent 列在「已检测到」组并预勾选；
  未检测到的折叠在「其他 agent」组，可手动勾选（勾选后凭空创建其 skills 目录）。
- 现有 5 个 agent：OpenClaw、Codex、Antigravity、Hermes、Claude Code（plugin 方式）。

### 重复安装 / 升级

- 读取目标目录 `SKILL.md` frontmatter 的 `version:` 字段获取已装版本（已验证可行，
  当前为 `3.10.1`）。
- 已装 agent 显示 **版本差异（当前 → 新），逐个确认** 覆盖或跳过。

### 失败处理

- **逐个 agent 独立安装，失败不中断**：失败项标红继续下一个，结尾汇总
  成功/失败列表并给出重试命令。

### 附带动作呈现

- Codex 的 `hooks.json` 合并、Claude Code 的 plugin 注册：**在汇总确认页作为条目
  列出**（用户可见将发生什么），不单独询问。

## Phase 2 决策

### CLI 入口

- 新子命令组 **`boss skills`**：`add <source>` / `list` / `update` / `remove`。
- Phase 1 自装 wizard 仍走裸跑入口，两者互不干扰。

### 源格式（全部支持）

- GitHub URL 与 `owner/repo` 短写
- `@branch` / `@tag` / `@commit` 版本钉选
- 本地目录路径
- 任意 git URL（GitLab、私有 git 服务）

### 获取层

- **硬依赖 git 二进制**：统一 `git clone --depth 1`（`@ref` 时 fetch 指定 ref）。
  未安装 git 直接报错提示安装。私有仓库认证天然复用用户 git 凭据。

### Skill 发现规则

- **递归扫描仓库**，任何包含 `SKILL.md`（含 name/description frontmatter）的目录
  算一个 skill（Claude Code / mattpocock 事实标准）。

### 安装状态追踪

- **中心 manifest**（如 `~/.boss/installed.json`）：记录 skill 名、来源仓库、
  commit/版本、装到了哪些 agent 的哪些路径。支撑 `list` / `update` / `remove`。

### 同名冲突

- 同源同名 → 视为升级，不另问。
- **异源同名（或 manifest 无记录 = 用户手装的）→ wizard 弹确认：覆盖 / 跳过**。

## Wizard 流程草图（Phase 2 完整形态，Phase 1 为其子集）

```
boss skills add mattpocock/skills
◇ Source: https://github.com/mattpocock/skills.git
◇ Repository cloned          (git clone --depth 1, spinner)
◇ Found N skills             (递归扫 SKILL.md)
◇ Select skills to install   (multiselect, space to toggle)
◇ Which agents?              (分组: 已检测到[预勾选] / 其他)
◇ Summary                    (含版本差异、hooks/plugin 附带动作、冲突确认)
◇ Installing…                (逐个安装, 失败标红不中断)
◆ Done: 成功 x / 失败 y      (失败附重试命令; 写入 manifest)
```

## 实现注意点

- 四段抽象接口先行：`SourceResolver`（git/本地路径）→ `SkillDiscoverer`（扫 SKILL.md）
  → `SelectionUI`（clack）→ `Installer`（复用现有 copy / codex-copy / plugin 三种 method）。
  Phase 1 只实现 `Installer` + `SelectionUI`，source/discover 用内置 BOSS skill 桩实现。
- 非 TTY 分支必须在进任何 clack 调用之前判断（`process.stdin.isTTY`），
  否则 CI 中会挂起。
- `git clone` 落临时目录（`os.tmpdir()`），安装完成后清理；扫描时跳过 `.git`、
  `node_modules`。
- manifest 写入放在每个 agent 安装成功之后（与「失败不中断」语义一致，
  部分成功也要如实记录）。
