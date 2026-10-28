# Subscription login (macOS Chrome)

ChatGPT uses the Codex CLI. Grok uses an xAI device-code flow in this host and does not need the Codex CLI. Grok tokens are stored only in ~/Library/Application Support/LexiLoop/xai. This host does not read CC Switch, Grok CLI, or NewMax logins.

# ChatGPT OAuth (macOS Chrome)

Requires Node 20.3+ and Codex CLI at /opt/homebrew/bin/codex (override with LEXILOOP_CODEX).

Run `node native/install.cjs EXTENSION_ID` from this extension directory. Fully quit and reopen Chrome after installation. The registered executable is `~/Library/Application Support/LexiLoop/oauth-host`, not a script inside this folder.

In settings choose PDF AI authentication → ChatGPT / Codex OAuth. Click Login ChatGPT, finish the OpenAI browser flow, then Refresh status. Enter a model available to your Codex account, save, and use Test PDF AI.

Credentials are isolated under ~/Library/Application Support/LexiLoop/codex. Codex app-server manages OAuth login and refresh; the native host reads only its own credentials to call the Codex Responses endpoint. Tokens never go to Chrome or sync storage. NewMax and the user's normal Codex login are not imported or modified.

Only the registered extension ID can connect through Chrome native messaging. There is no general-purpose HTTP proxy. The Codex OAuth callback temporarily uses localhost:1455; finish or cancel other Codex/NewMax login attempts first if that port is busy.

PDF AI uses OAuth; word and page translation continue using the existing translation configuration. This integration depends on the Codex backend, so model availability and protocol changes may affect it. Live login and model access must be checked with the user's account.
