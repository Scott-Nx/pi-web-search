# pi-web-search

Provider-native web search for [pi](https://github.com/earendil-works/pi-coding-agent), across Google Gemini, OpenAI, and Anthropic, plus Gemini-only URL Context analysis.

## Tools

### `web_search`

Search the web using your currently selected model. Automatically picks the right provider API:

| Provider | API |
|---|---|
| Google Gemini | Grounding with Google Search |
| OpenAI | Responses API web search |
| Anthropic | Messages API web search |

Supports passing up to 20 additional URLs to analyze alongside the query.

### `url_context`

Gemini-only. Analyze up to 20 public URLs — web pages, documents, images, and YouTube videos. Uses Gemini's native URL Context retrieval with verified metadata.

When using `google-generative-ai`, YouTube URLs are passed as `file_data` for native video understanding.

## Install

```bash
pi install npm:pi-web-search
```

## Usage

No extra config needed. Just configure any supported provider in pi and the tools auto-detect it.

`url_context` is automatically removed from active tools when using a non-Gemini model.

## Test

```bash
cp .env.example .env   # edit with your models
npm test               # unit tests
npm run test:real:web-search
npm run test:real:url-context
```

## License

MIT
