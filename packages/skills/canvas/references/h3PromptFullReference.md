# H3 全参考提示词模式

仅当多类参考素材共同约束生成内容时使用。正文用英文组织，原对白、歌词和画面文字保留原语言。小场景或单镜头不因模板而扩写无关内容；复杂生成通常需要充分描述镜头中的主体、位置、环境、光线、动作变化、运镜和声音。

六段按以下顺序组织：

1. `subject_definitions`：定义会在成片中复用的角色、场景、道具、风格和姿态；每个标签说明它代表什么及来自哪些素材。
2. `summary`：一段英文摘要，以方括号任务类型开头，例如 `[reference generation]`、`[video editing + audio reuse]`。
3. `retention_analysis`：逐项说明引用内容在成片中的出现位置和保留关系。
4. `detailed_description`：按播放顺序逐镜写画面、动作、声音和对白。
5. `overall_soundscape`：概括环境声和动作声。
6. `non_diegetic_music`：说明观众听到的配乐；无配乐时写 `N/A`。

## 标签与关系

- `<Subject N>` 表示会在成片中复用的可见内容；`<Picture N>` 表示具体关键帧或构图锚点；`<Video N>` 表示剪辑、续写或整体时间结构来源；`<Audio N>` 表示独立音频或被启用的同步音轨。
- 同一标签在六段中含义保持不变，编号分别按图片、视频、音频类别与实际连接顺序对应。只用于角色/场景外观的图片写入 `<Subject N>` 定义，不要误当关键帧。
- 视觉关系使用 `fully_preserved`、`partially_preserved`、`attribute_transfer`、`weak_reference`；音频关系使用 `fully_copy`、`partially_copy`、`reference`、`weak_reference`。
- 镜头正文中的对白用 `<d>[语言]原文</d>`，说话人 ID 保持稳定；不得因模板翻译或改写用户对白。

这六段是全参考模式的组织规范，不是 RunningHub API 的 JSON 字段。每次仍以视频节点上真实连接的素材、时长和画幅为准；不要凭提示词声称设置了硬首尾帧锁定。
