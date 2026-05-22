# pi-web-search

A pi extension that provides provider-native web search across Google Gemini, OpenAI, and Anthropic, plus Gemini-native URL Context analysis.

## Features

- **🔍 Web Search** - Provider-native web search across Google Gemini, OpenAI Responses, and Anthropic Messages
- **📄 URL Context** - Gemini-native analysis of up to 20 public URLs, including web pages, documents, images, and YouTube videos
- **🧾 Search telemetry** - Tool results include provider, search queries, result URLs, citations, and whether native search metadata was actually observed
- **🔗 Canonicalized Google grounding links** - Gemini grounding redirect URLs are resolved to their underlying destination URLs when possible

## Installation

```bash
pi install npm:pi-web-search
```

## Release highlights for v1.2.0

- `web_search` now follows the current model across Google Gemini, OpenAI Responses, and Anthropic Messages
- `url_context` is explicitly Gemini-only and is removed from the active tool set for non-Gemini models
- Provider-native search telemetry now exposes queries, URLs, citations, and verification metadata in tool `details`
- Gemini grounding redirect URLs are resolved to canonical destination URLs when possible
- Real test scripts now read configuration from `.env` / `.env.example`
- The package now ships source-only TypeScript entrypoints for pi; no `dist/` build output is required in the project or published package

## Behavior notes

- `web_search` follows the **currently selected model** when that model exposes a supported native search API.
- `web_search` supports Google Gemini, OpenAI Responses, Anthropic Messages, and compatible proxy providers exposing those APIs.
- `url_context` is intentionally **Gemini-only**. When the current model is not Gemini-compatible, the extension removes `url_context` from the active tool set and the executor also fast-fails with a clear unsupported-provider message as a second safety net.
- If `web_search` returns only plain text and does **not** return native search metadata, the tool output includes a warning and marks the result as ungrounded in `details`.
- If `url_context` does not return verified URL-context metadata, the tool output includes an explicit warning so the caller can distinguish a best-effort summary from a verified retrieval.
- For Gemini grounding results, the extension attempts to resolve Google redirect URLs to the final destination URL before returning `sources` / `searchResults`.

## Tool matrix

| Tool | Google Gemini | OpenAI Responses | Anthropic Messages | Proxy providers exposing those APIs |
|---|---|---|---|---|
| `web_search` | ✅ | ✅ | ✅ | ✅ |
| `url_context` | ✅ | ❌ | ❌ | ✅, but only when the selected model is Gemini-compatible |

## Configuration

No special configuration required. Configure or login to any of the following model providers in pi, and it will be automatically detected and used:

### For `web_search`

- google
- google-generative-ai
- openai
- anthropic
- compatible proxy providers whose selected model API is OpenAI Responses, Anthropic Messages, or Google Generative AI

### For `url_context`

- google
- google-generative-ai
- compatible proxy providers whose selected model API is Google Generative AI

## Verification scripts

Create a local `.env` first, ideally by copying `.env.example`. Real-test scripts read all configuration from environment variables instead of hardcoding any provider or extension.

```bash
# Mock/unit parsing tests
npm test

# Real multi-provider web_search verification using models from .env
node tests/real-web-search.mjs

# Real Gemini url_context verification using model from .env
# Passes when url_context either returns verified metadata/URLs
# or emits the explicit unverified-warning path.
node tests/real-url-context.mjs
```

Example `.env` keys:

```bash
PI_BIN=pi
PI_WEB_SEARCH_EXTENSION=./src/index.ts
PI_PROVIDER_EXTENSIONS=/path/to/provider-extension.ts
PI_WEB_SEARCH_MODEL_OPENAI=provider/model-openai
PI_WEB_SEARCH_MODEL_ANTHROPIC=provider/model-anthropic
PI_WEB_SEARCH_MODEL_GOOGLE=provider/model-google
PI_URL_CONTEXT_MODEL=provider/model-google
```

Recommended setup:

```bash
cp .env.example .env
# then edit .env with models/extensions available in your local pi setup
```
