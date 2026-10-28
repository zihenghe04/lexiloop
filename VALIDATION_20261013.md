# LexiLoop 0.16.4 模型方案与Anthropic Messages 接入验证

日期：2026-10-13。

## 插件实现

- 后台直接 fetch，可选 OpenAI Chat Completions / Anthropic Messages。
- Messages 使用顶层 system、必填且可配置的 max_tokens、base64 图片 block；不发送原先固定的 temperature。
- 支持普通翻译、PDF 问答、截图、完整 JSON 与 SSE 文本增量；不会把 thinking、签名或工具 JSON 当成答案。
- Anthropic 兼容服务 Sonnet 5.5 预设填写协议、精确 Coding URL、翻译与 PDF 模型，不自动保存或替换密钥。
- 原有 OpenAI 与 ChatGPT OAuth 功能保留；没有引入 Claude Code 运行依赖。
- 模型设置改为“原方案 / Anthropic 兼容服务”卡片，常用项集中展示，高级参数默认收起；选择草稿后点击“保存并启用”才改变后台调用。
- 两套配置和本机密钥独立保存，切回原方案恢复地址、模型、OAuth 选择、超时、流式与回退。测试选中方案不借用另一套密钥，清除一套密钥保留另一套。
- 首次升级保留当前配置；已被 0.16.3 覆盖且没有快照的原配置无法自动恢复，界面明确提示重新填写。

## 自动化与界面

`node --test tests/*.test.cjs`：114 项，112 通过，0 失败，2 跳过（原有可选备份环境测试与 Codex native 集成测试）。其中 7 项新增测试覆盖完整配置往返恢复、旧配置迁移、未保存方案测试的密钥隔离、选中方案测试、单方案密钥清除、已覆盖原配置的提示与同步切换后的密钥选择。

JS 语法检查通过，manifest 版本为 0.16.4。使用真实 sidepanel.html 与隔离 Chrome API mock，在本地预览验证原方案到Anthropic再切回、草稿密钥暂存、各方案保存并启用、关闭设置后重新打开、原方案 OAuth 模型恢复与 Messages 高级参数。检查默认窗口以及 360 / 300 像素窄侧栏，页面和设置滚动区均无横向溢出。该预览仅使用虚拟测试密钥，不保存真实 Key，也不是实际 Chrome 扩展验收。本次 UI 修改未再次发起真实模型请求。

## 真实接口

经用户授权，仅使用本机 Claude 配置中现有的Anthropic Key 发送固定测试文本。密钥不写入项目、诊断输出或测试脚本。

1. 普通 `https://api.example.com/v1/messages`。
2. 本机原 Coding Base URL 对应的 `https://api.example.com/deployer/coding_*/v1/messages`。
3. 最终预设的 `https://api.example.com/deployer/coding_tatu/v1/messages`。
4. 按用户提供的最小示例原样请求：普通 `/v1/messages`，Authorization Bearer，Accept text/event-stream，model=claude-sonnet-5-5，messages=[user: Who are you?]，stream=true，max_tokens=1024；无额外 system、temperature 或 anthropic-version。

上述请求均返回 HTTP 503，错误为：

```text
Backend model deployer(s) ['CODING_TATU'] for this model do not support the current application (app_id=0).
```

该轮测试中的 Key / 模型 / 部署方组合拒绝了请求，目标模型在该轮真实可用验收中没有通过。此记录不判断之后的可用性，也不作为阻止保存配置或禁用模型的条件；后续可以直接使用保存的配置重试，若该错误持续出现再向平台核对权限。其他 Key 是否具有不同权限未验证。

## 应用更新

在 Chrome 扩展管理页重新加载此目录的 LexiLoop，再刷新已有阅读器页面。浏览器工具禁止访问 chrome://extensions，未代用户完成实际扩展重新加载。已有真实插件配置和密钥没有被这次测试改写。
