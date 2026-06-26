# Bilibili 评论展开助手

一款用于 Bilibili 视频页面的用户脚本（UserScript），能够一键展开评论楼中楼的全部子回复，并提供排序、对话链查看、视频链接识别以及可选的 AI 反对意见生成等增强功能。脚本采用暗色主题，模仿 B 站原生评论样式，力求无缝融入页面。

- 版本：2.5.6
- 授权：CC-BY-NC-4.0
- 匹配页面：`https://www.bilibili.com/video/*`
- 运行时机：`document-end`

## 功能特性

### 评论展开
- 在每条评论的「查看更多回复」区域旁注入「展开全部」按钮，点击后弹出瀑布流式面板。
- 通过 B 站官方接口 `/x/v2/reply/reply` 分页抓取，默认并发 10、单页 20 条、最多 100 页（上限约 2000 条回复）。
- 内置 5 分钟接口缓存（未登录状态下生效），降低重复请求开销。
- 自动重试机制：失败最多重试 3 次，间隔 1 秒，超时 10 秒。

### 排序与浏览
- 支持按热度、按时间两种排序方式。
- 时间排序支持正序 / 倒序切换（默认倒序，最新在前）。
- 自动按时间顺序分配楼层号，便于定位上下文。

### 对话链侧边浮层
- 点击单条回复可打开「回复对话」浮层，展示该回复所在的完整对话链。
- 浮层支持拖拽移动、最大化 / 还原、关闭，且会自动避免超出视口边界。

### 视频链接识别
- 识别评论中的完整视频链接、`b23.tv` 短链、纯 `BV` 号与 `av` 号。
- 短链通过跳转解析补全为真实 BV / av 号。
- 渲染为 B 站风格的可点击链接卡片，并异步加载视频标题，悬浮显示。

### 表情符号支持
- 仅使用当前回复自带的 `emote` 映射进行渲染，避免跨回复表情错位。
- 生成与 B 站原生一致的表情 HTML 结构与样式。

### AI 反对意见生成（可选）
- 在设置面板中填入 OpenAI 兼容 API 参数后，可开启「一键生成反对意见」。
- 每条回复下显示 AI 按钮，支持两种任务模式：
  - **单楼层反驳**：仅针对目标楼层发言生成一段反驳。
  - **作者全集反驳**：针对目标作者在当前楼层的全部发言生成统一反驳。
- 提供两种提示词风格：
  - 强硬辩驳（直切要点）
  - 口语自适应（AI 自行决定）
- 支持两种接口类型：`responses` 与 `chat/completions`。
- AI 结果在独立侧边浮层展示，支持拖拽与最大化。

### 其他
- 暗色主题，整体配色贴近 B 站原生暗色模式。
- 通过脚本管理器菜单可打开设置面板、切换调试日志。
- 页面切换 / 卸载时自动清理资源与监听器。
- 暴露全局调试接口 `window.bilibiliCommentExpand`，便于排查问题。

## 安装

1. 在浏览器中安装用户脚本管理器，例如：
   - Tampermonkey
   - Violentmonkey
2. 打开脚本管理器的新建脚本编辑器，将 `bilibili-comment-waterfall.user.js` 的全部内容粘贴进去并保存。
   - 或直接将文件拖入脚本管理器的导入界面（如管理器支持）。
3. 打开任意 B 站视频页面（`https://www.bilibili.com/video/...`），脚本将自动加载。
4. 滚动到评论区，在评论的「查看更多回复」旁即可看到「展开全部」按钮。

## 使用说明

### 展开评论
- 在视频评论区找到目标评论，点击其操作栏中新增的「展开全部」按钮。
- 弹出面板中将列出该评论下的全部子回复，可在顶部切换「按热度 / 按时间」排序。

### 查看对话链
- 在弹窗列表中点击任意一条回复，右侧将浮出「回复对话」面板，展示该回复所在的完整对话上下文。
- 通过面板头部按钮可最大化、还原或关闭浮层；浮层可拖拽移动。

### 配置 AI 反对意见
1. 点击脚本管理器图标，选择「⚙️ 评论展开助手设置」。
2. 在设置面板中填写：
   - **OPENAI API Key**：你的接口密钥。
   - **请求基础地址**：如 `https://api.openai.com/v1`，可替换为兼容服务的地址。
   - **接口类型**：`responses` 或 `chat/completions`。
   - **模型名称**：如 `gpt-4o-mini`。
3. 勾选「开启一键生成反对意见」并保存。
4. 此后每条回复下会出现 AI 按钮，点击即可在右侧浮层中生成反对意见，可在弹窗顶部切换提示词风格与任务模式。

### 调试日志
- 在脚本管理器菜单中点击「🪵 开启 / 关闭调试日志」即可切换。
- 开启后，浏览器控制台会输出带有 `[Bilibili评论展开助手 <时间戳>]` 前端的日志，便于排查。

## 配置项说明

脚本通过 `GM_getValue / GM_setValue` 持久化设置，存储键为 `bili_comment_expand_settings_v1`，默认值如下：

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `openAIApiKey` | string | `''` | OpenAI 兼容 API 密钥 |
| `openAIBaseUrl` | string | `''` | 请求基础地址 |
| `openAIEndpointType` | string | `'responses'` | 接口类型：`responses` / `chat/completions` |
| `openAIModel` | string | `''` | 模型名称 |
| `enableAiRebuttal` | boolean | `false` | 是否开启 AI 反对意见按钮 |
| `enableDebugLogs` | boolean | `false` | 是否开启调试日志 |

内部行为常量（位于脚本顶部 `CONFIG`）：

| 常量 | 默认值 | 说明 |
| --- | --- | --- |
| `API_BASE` | `https://api.bilibili.com` | 评论接口基础地址 |
| `COMMENT_TYPE` | `1` | 评论类型，1 表示视频评论 |
| `MAX_RETRIES` | `3` | 请求失败最大重试次数 |
| `RETRY_DELAY` | `1000` | 重试间隔（毫秒） |
| `REQUEST_TIMEOUT` | `10000` | 单次请求超时（毫秒） |
| `REPLY_PAGE_SIZE` | `20` | 单页回复数 |
| `REPLY_MAX_PAGES` | `100` | 回复最大抓取页数 |
| `REPLY_FETCH_CONCURRENCY` | `10` | 回复抓取并发数 |

## 技术实现

脚本整体采用单文件 IIFE 结构，主要模块如下：

- **`Utils`**：调试日志、Toast 提示、Cookie 读取、HTML 转义、表情与视频链接处理、短链解析等工具函数。
- **`BilibiliCommentAPI`**：封装评论回复接口，负责分页抓取、并发调度与缓存。
- **`DOMWatcher`**：监听评论区 DOM 变化，自动注入「展开全部」按钮，并在按钮丢失时重新附加。
- **`BilibiliCommentExpandController`**：主控制器，统筹设置面板、按钮事件、弹窗渲染、排序、对话链与 AI 反对意见浮层。
- **入口**：根据 `document.readyState` 决定立即执行或等待 `DOMContentLoaded`，并在 `beforeunload` 时清理资源。

请求层面通过 `GM_xmlhttpRequest` 发起跨域调用（用于短链解析与 AI 接口），评论接口则使用页面原生 `fetch` 并携带 `credentials: 'include'` 以复用登录态。

## 权限说明

脚本在元数据中声明了以下权限：

| 权限 | 用途 |
| --- | --- |
| `GM.registerMenuCommand` | 注册设置面板与调试日志开关菜单 |
| `GM_xmlhttpRequest` | 跨域请求短链解析与 AI 接口 |
| `GM_getValue` / `GM_setValue` | 持久化用户设置 |
| `unsafeWindow` | 与页面上下文交互 |
| `@connect *` | 允许 `GM_xmlhttpRequest` 访问任意域名（短链跳转与自定义 AI 服务地址） |

## 兼容性

- 浏览器：需支持用户脚本管理器（Tampermonkey / Violentmonkey 等）。
- 页面：仅作用于 `https://www.bilibili.com/video/*`。
- 依赖：无外部库，纯原生 JavaScript 实现。

## 目录结构

```
bilibiliwaterfall/
├── bilibili-comment-waterfall.user.js   # 脚本主文件
└── README.md                            # 项目说明
```

## 许可证

本项目采用 [CC-BY-NC-4.0](https://creativecommons.org/licenses/by-nc/4.0/) 协议，仅供学习与个人非商业用途使用。
