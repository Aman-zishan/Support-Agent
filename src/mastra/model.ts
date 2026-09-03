import { groq } from "@ai-sdk/groq";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import type { MastraModelConfig } from "@mastra/core/llm";

/**
 * One place that decides which LLM every agent uses.
 *
 * Workshop attendees turn up with whichever API key they already have, so this
 * auto-detects: set exactly one key in .env and it just works. Set
 * MODEL_PROVIDER to override when you have more than one.
 *
 *   MODEL_PROVIDER=groq|anthropic|openai|gemini   (optional — inferred from keys)
 *   MODEL_ID=<model>                              (optional — overrides the default)
 *
 * Swapping providers changes nothing else in this codebase. That is the point
 * of routing every agent through one function: agents, tools, workflows and
 * delegation all stay identical.
 *
 * Gemini goes through Mastra's built-in model router ("google/<model>"), which
 * reads GOOGLE_GENERATIVE_AI_API_KEY itself — no extra SDK package needed.
 */

export type Provider = "groq" | "anthropic" | "openai" | "gemini";

const PROVIDERS = ["groq", "anthropic", "openai", "gemini"] as const;

/** Defaults chosen to work on each provider's standard tier. */
const DEFAULT_MODEL: Record<Provider, string> = {
	// Fast and free-tier friendly — the workshop default.
	// NOTE: Groq retired llama-3.3-70b-versatile; gpt-oss-120b is the current
	// large tool-calling model on the free tier. Check console.groq.com/docs/models
	// before the workshop — Groq rotates these.
	groq: "openai/gpt-oss-120b",
	anthropic: "claude-opus-5",
	openai: "gpt-4o",
	// Free-tier friendly, strong tool calling. Routed via Mastra as "google/<id>".
	gemini: "gemini-3.6-flash",
};

const ENV_KEY: Record<Provider, string> = {
	groq: "GROQ_API_KEY",
	anthropic: "ANTHROPIC_API_KEY",
	openai: "OPENAI_API_KEY",
	gemini: "GOOGLE_GENERATIVE_AI_API_KEY",
};

function isProvider(p: string): p is Provider {
	return (PROVIDERS as readonly string[]).includes(p);
}

function hasKey(p: Provider): boolean {
	const v = process.env[ENV_KEY[p]];
	// Treat the .env.example placeholder as "not set" so a half-filled file
	// does not silently select the wrong provider.
	return Boolean(v && v.trim() && !v.startsWith("your-api-key"));
}

export function resolveProvider(): Provider {
	const explicit = process.env.MODEL_PROVIDER?.trim().toLowerCase();
	if (explicit) {
		if (!isProvider(explicit)) {
			throw new Error(
				`MODEL_PROVIDER="${explicit}" is not supported. Use ${PROVIDERS.join(", ")}.`,
			);
		}
		if (!hasKey(explicit)) {
			throw new Error(
				`MODEL_PROVIDER=${explicit} but ${ENV_KEY[explicit]} is not set in .env`,
			);
		}
		return explicit;
	}

	const found = PROVIDERS.filter(hasKey);
	if (found.length === 1) return found[0];
	if (found.length > 1) {
		throw new Error(
			`Multiple API keys set (${found.map((p) => ENV_KEY[p]).join(", ")}). ` +
				`Set MODEL_PROVIDER to pick one.`,
		);
	}
	throw new Error(
		`No API key found. Set one of ${Object.values(ENV_KEY).join(", ")} in .env — ` +
			`see .env.example.`,
	);
}

/** The model every agent in this project uses. */
export function supportModel(): MastraModelConfig {
	const provider = resolveProvider();
	const modelId = process.env.MODEL_ID?.trim() || DEFAULT_MODEL[provider];

	switch (provider) {
		case "groq":
			return groq(modelId);
		case "anthropic":
			return anthropic(modelId);
		case "openai":
			return openai(modelId);
		case "gemini":
			// Mastra model router — accepts "google/<model>" and handles auth itself.
			return `google/${modelId}`;
	}
}

/** Printed once at startup so it is obvious which provider is live. */
export function describeModel(): string {
	try {
		const provider = resolveProvider();
		const modelId = process.env.MODEL_ID?.trim() || DEFAULT_MODEL[provider];
		return `${provider} / ${modelId}`;
	} catch (err) {
		return `UNCONFIGURED — ${(err as Error).message}`;
	}
}
