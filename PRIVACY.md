# LexiLoop 数据与权限说明

## 本地数据

词库、来源网址、批注、文献资料、论文知识页和 PDF AI 会话保存在浏览器本地存储；本地 PDF 和全文索引保存在 IndexedDB。插件不再按固定文档、会话、词条和回答数量自动删减这些记录，并申请 `unlimitedStorage` 权限；实际容量仍受设备可用空间约束。备份会将这些信息导出到用户选择保存的 JSON 文件，请像原始文献一样妥善保管。

备份不包含 API Key、OAuth 令牌、浏览器 Cookie 或供应商配置。恢复采用替换方式，导入前保存一个本地快照，可以通过“恢复上次数据”撤销。当前备份上限 100 MB；恢复期间应关闭其他 LexiLoop 页面以避免并发写入。

## 网络传输

触发翻译时，选中文字会发送到已配置的翻译服务。PDF AI 会发送问题、有限的历史上下文和检索出的 PDF 片段；使用截图提问时还会发送截图。OAuth 模式通过本地辅助程序访问 ChatGPT/Codex 服务。文献元数据查询可能向 Crossref/arXiv 发送检索标识。数据处理还受对应服务商的条款约束。

## 认证

选择Anthropic 兼容服务 预设后，翻译与 PDF AI 由插件后台直接请求 `api.example.com` 的 Anthropic Messages 接口。预设不会自动保存密钥；API Key 仅在用户保存时进入本机扩展存储。插件不会读取本机 Claude Code 的密钥，也不会启动 Claude Code。

API Key 保存在本机扩展存储，不同步。OAuth 登录由本机 Codex app-server 管理，凭据独立保存在 LexiLoop 的应用数据目录；不会导入 NewMax 或默认 Codex 账号的凭据，令牌不传给页面。

“原方案”与“Anthropic 兼容服务”分别保留配置与本机密钥。切换草稿不会立即修改实际调用，只有“保存并启用”才生效；测试选中方案不会使用另一套方案的密钥，清除密钥只影响选中的方案。当前启用的非敏感配置仍存入 Chrome 同步设置，两套方案的配置快照保存在本机。

## 权限用途

- 网页访问权限：注入划词功能、获取 PDF、访问用户配置的翻译接口。
- tabs/webRequest：识别并接管网页 PDF、跳回来源页面。
- storage：持久化设置、词库和阅读数据。
- unlimitedStorage：避免较长的会话和文献库触及 Chrome 默认的本地存储配额。
- clipboardRead/offscreen：PDF 快捷键读取用户已复制的选区。
- clipboardWrite：用户点击后复制 AI 回答。
- downloads：保存 PDF 等导出文件。
- nativeMessaging：扩展与本地 OAuth 辅助程序通信。
- contextMenus/sidePanel：右键翻译和个人中心。

目前没有实现云同步、团队共享或后台正文遥测。清除扩展数据不会自动移除本地 OAuth 辅助程序的数据；请先在插件里退出登录。卸载辅助程序可移除 Chrome NativeMessagingHosts 中的 com.lexiloop.oauth.json 注册文件。
