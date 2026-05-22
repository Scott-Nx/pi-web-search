import type { ExtensionContext, AgentToolResult } from "@earendil-works/pi-coding-agent";
import { type Model } from "@earendil-works/pi-ai";
import { truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import { getProviderKind } from "./api.ts";

// --- Formatting ---

export function formatResult(text: string, details: any): AgentToolResult<any> {
    const { content, truncated } = truncateHead(text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
    return {
        content: [{ type: "text", text: content + (truncated ? "\n\n[Truncated]" : "") }],
        details
    };
}

// --- Model Selection ---

function isSupportedSearchModel(model: Model<any> | undefined): model is Model<any> {
    if (!model) return false;
    return getProviderKind(model) !== "unsupported";
}

function providerPriority(model: Model<any>): number {
    const priorities = [
        "google",
        "google-generative-ai",
        "openai",
        "anthropic",
    ];
    const providerIndex = priorities.indexOf(model.provider);
    if (providerIndex >= 0) return providerIndex;
    return priorities.length;
}

function modelPriority(model: Model<any>): number {
    const id = model.id;
    const patterns = [
        /gemini-3.*flash/i,
        /gemini-2\.5.*flash/i,
        /gemini-2\.0.*flash/i,
        /gemini.*flash/i,
        /gpt-5\..*mini/i,
        /gpt-4\.1.*mini/i,
        /gpt-4o-mini/i,
        /claude.*haiku/i,
        /claude.*sonnet/i,
    ];
    const patternIndex = patterns.findIndex((pattern) => pattern.test(id));
    return patternIndex >= 0 ? patternIndex : patterns.length;
}

export async function getModel(ctx: ExtensionContext): Promise<Model<any> | undefined> {
    // Use the current model first so the tool follows the user's selected provider.
    // This lets pi --provider openai/anthropic/google automatically pick the matching API.
    if (isSupportedSearchModel(ctx.model)) {
        return ctx.model;
    }

    const models = ctx.modelRegistry.getAvailable().filter(isSupportedSearchModel);
    if (models.length === 0) return undefined;

    return models.sort((a, b) => {
        const byProvider = providerPriority(a) - providerPriority(b);
        if (byProvider !== 0) return byProvider;
        return modelPriority(a) - modelPriority(b);
    })[0];
}

// --- Error Results ---

export function missingConfigResult(ctx: ExtensionContext): AgentToolResult<any> {
    const current = ctx.model ? `${ctx.model.provider} (${ctx.model.api})` : "none";
    const msg = `No supported web-search model configuration found. Current model: ${current}. Configure or select a supported provider: google-generative-ai, openai, or anthropic.`;
    return { content: [{ type: "text", text: `Failed: ${msg}` }], details: { error: "missing_config" } };
}

export function errorResult(e: Error): AgentToolResult<any> {
    return { content: [{ type: "text", text: `Error: ${e.message}` }], details: { error: true } };
}
