import type { ExtensionContext, AgentToolUpdateCallback } from "@mariozechner/pi-coding-agent";
import { type Model } from "@mariozechner/pi-ai";
import { TextEncoder, TextDecoder } from "util";

// --- Provider Configuration ---

type ProviderConfig = {
    searchTool: string;
    urlContextTool: string;
    buildRequest: (model: Model<any>, body: any, projectId?: string) => { url: string; headers: Record<string, string>; body: any };
};

const PROVIDERS: Record<string, ProviderConfig> = {
    "google-generative-ai": {
        searchTool: "google_search",
        urlContextTool: "url_context",
        buildRequest: (model, body) => ({
            url: `${model.baseUrl}/models/${model.id}:streamGenerateContent?alt=sse`,
            headers: {
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
            },
            body
        })
    },
    "google-gemini-cli": {
        searchTool: "googleSearch",
        urlContextTool: "urlContext",
        buildRequest: (model, body, projectId) => ({
            url: `${model.baseUrl}/v1internal:streamGenerateContent?alt=sse`,
            headers: {
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
                "User-Agent": "google-cloud-sdk vscode_cloudshelleditor/0.1",
                "X-Goog-Api-Client": "gl-node/22.17.0",
                "Client-Metadata": JSON.stringify({ ideType: "IDE_UNSPECIFIED", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" }),
            },
            body: { project: projectId, model: model.id, request: body }
        })
    },
    "google-antigravity": {
        searchTool: "googleSearch",
        urlContextTool: "urlContext",
        buildRequest: (model, body, projectId) => ({
            url: `${model.baseUrl}/v1internal:streamGenerateContent?alt=sse`,
            headers: {
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
                "User-Agent": "antigravity/1.15.8 darwin/arm64",
                "X-Goog-Api-Client": "gl-node/22.17.0",
                "Client-Metadata": JSON.stringify({ ideType: "IDE_UNSPECIFIED", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" }),
            },
            body: {
                project: projectId,
                model: model.id,
                request: body,
                requestType: "agent",
                userAgent: "antigravity",
                requestId: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
            }
        })
    }
};

export function getConfig(model: Model<any>): ProviderConfig {
    return PROVIDERS[model.provider] || PROVIDERS[model.api] || PROVIDERS["google-generative-ai"];
}

// --- Auth Compatibility Layer ---

type ResolvedAuth = 
    | { ok: true; apiKey?: string; headers?: Record<string, string>; }
    | { ok: false; error: string; };

/**
 * Get API key and headers for a model.
 * Compatible with both new pi versions (getApiKeyAndHeaders) and old versions (getApiKey).
 */
async function getAuth(ctx: ExtensionContext, model: Model<any>): Promise<ResolvedAuth> {
    const registry = ctx.modelRegistry as any;
    
    // Try new API first (pi >= 0.63.0)
    if (typeof registry.getApiKeyAndHeaders === 'function') {
        return await registry.getApiKeyAndHeaders(model);
    }
    
    // Fallback to old API (pi < 0.63.0)
    if (typeof registry.getApiKey === 'function') {
        const apiKey = await registry.getApiKey(model);
        if (apiKey === undefined || apiKey === null) {
            return { ok: false, error: "No API key configured for model" };
        }
        return { ok: true, apiKey };
    }
    
    return { ok: false, error: "Model registry does not support API key retrieval" };
}

// --- Streaming API Call ---

export interface StreamResult {
    text: string;
    groundingMetadata?: any;
    urlContextMetadata?: any;
}

export async function callApiStream(
    ctx: ExtensionContext,
    model: Model<any>,
    body: any,
    onUpdate?: AgentToolUpdateCallback,
    signal?: AbortSignal
): Promise<StreamResult> {
    const config = getConfig(model);
    const auth = await getAuth(ctx, model);
    if (!auth.ok) {
        throw new Error(auth.error || "Failed to get API key and headers");
    }

    // Extract projectId from apiKey for internal Google APIs (gemini-cli, antigravity)
    // These providers return apiKey as JSON: {projectId, token}
    let projectId: string | undefined;
    if (model.api !== "google-generative-ai" && auth.apiKey) {
        try {
            const parsed = JSON.parse(auth.apiKey);
            projectId = parsed.projectId;
        } catch {
            // Not a JSON string, ignore
        }
    }

    const req = config.buildRequest(model, body, projectId);

    // Handle auth
    if (auth.headers) {
        Object.assign(req.headers, auth.headers);
    }
    if (auth.apiKey) {
        if (model.api === "google-generative-ai") {
            req.headers["x-goog-api-key"] = auth.apiKey;
        } else {
            const parsed = JSON.parse(auth.apiKey);
            req.headers["Authorization"] = `Bearer ${parsed.token}`;
        }
    }

    const response = await fetch(req.url, {
        method: "POST",
        headers: req.headers,
        body: JSON.stringify(req.body),
        signal
    });

    if (!response.ok) {
        throw new Error(`API error (${response.status}): ${await response.text()}`);
    }

    if (!response.body) {
        throw new Error("No response body");
    }

    // Parse SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let accumulatedText = "";
    let groundingMetadata: any;
    let urlContextMetadata: any;
    let currentEventData = "";
    let currentEventName = "";

    while (true) {
        if (signal?.aborted) {
            throw new Error("Request was aborted");
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
            // Empty line indicates end of an event
            if (line === "" || line === "\r") {
                if (currentEventData) {
                    // Process the complete event
                    let chunk: any;
                    try {
                        chunk = JSON.parse(currentEventData);
                    } catch {
                        currentEventData = "";
                        currentEventName = "";
                        continue;
                    }

                    // Check for error in chunk (API errors are sent via SSE stream)
                    if (chunk.error) {
                        const errorMsg = chunk.error.message || JSON.stringify(chunk.error);
                        throw new Error(`API error (${chunk.error.code || chunk.error.status || 'unknown'}): ${errorMsg}`);
                    }

                    // Unwrap response for internal APIs
                    const data = chunk.response || chunk;
                    const candidate = data.candidates?.[0];

                    if (candidate?.content?.parts) {
                        for (const part of candidate.content.parts) {
                            if (part.text) {
                                accumulatedText += part.text;
                                // Stream update
                                onUpdate?.({
                                    content: [{ type: "text", text: accumulatedText }],
                                    details: { streaming: true }
                                });
                            }
                        }
                    }

                    // Capture metadata from final chunk
                    if (candidate?.groundingMetadata) {
                        groundingMetadata = candidate.groundingMetadata;
                    }
                    // Handle both camelCase and snake_case
                    if (candidate?.urlContextMetadata || candidate?.url_context_metadata) {
                        urlContextMetadata = candidate.urlContextMetadata || candidate.url_context_metadata;
                    }
                }
                currentEventData = "";
                currentEventName = "";
                continue;
            }

            // Parse SSE field
            if (line.startsWith("data:")) {
                const data = line.slice(5).trim();
                currentEventData = currentEventData ? currentEventData + "\n" + data : data;
            } else if (line.startsWith("event:")) {
                currentEventName = line.slice(6).trim();
                // Check for error event type
                if (currentEventName === "error") {
                    // Next data line should contain error details
                }
            } else if (line.startsWith("id:")) {
                // Event ID, can be ignored for now
            } else if (line.startsWith(":")) {
                // Comment line, ignore
            }
        }
    }

    return {
        text: accumulatedText || "No answer available.",
        groundingMetadata,
        urlContextMetadata
    };
}

// --- Citation Processing (byte-safe) ---

export function applyCitations(text: string, groundingMetadata: any): { text: string; sources: { title: string; url: string }[] } {
    const chunks = groundingMetadata?.groundingChunks || [];
    const supports = groundingMetadata?.groundingSupports || [];

    const sources = chunks
        .filter((c: any) => c.web)
        .map((c: any) => ({ title: c.web.title || "Unknown", url: c.web.uri || "" }));

    if (!supports.length || !sources.length) return { text, sources };

    // Collect insertions, sort descending
    const insertions = supports
        .filter((s: any) => s.segment?.endIndex !== undefined && s.groundingChunkIndices?.length)
        .map((s: any) => ({
            index: s.segment.endIndex,
            marker: s.groundingChunkIndices.map((i: number) => `[${i + 1}]`).join("")
        }))
        .sort((a: any, b: any) => b.index - a.index);

    // Byte-safe insertion
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const bytes = encoder.encode(text);

    const parts: Uint8Array[] = [];
    let lastIndex = bytes.length;

    for (const ins of insertions) {
        const pos = Math.min(ins.index, lastIndex);
        if (pos < lastIndex) parts.unshift(bytes.subarray(pos, lastIndex));
        parts.unshift(encoder.encode(ins.marker));
        lastIndex = pos;
    }
    if (lastIndex > 0) parts.unshift(bytes.subarray(0, lastIndex));

    const total = parts.reduce((acc, p) => acc + p.length, 0);
    const final = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        final.set(part, offset);
        offset += part.length;
    }

    return { text: decoder.decode(final), sources };
}
