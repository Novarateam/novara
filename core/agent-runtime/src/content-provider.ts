// AI provider adapter for the Content Agent (A-014). Server-side only: the API
// key is read from the environment at call time and never returned, logged,
// or persisted anywhere by this module.
const DEFAULT_MODEL = "gpt-4o-mini";
const REQUEST_TIMEOUT_MS = 20000;
const MAX_CONTENT_LENGTH = 6000;

export type ContentProposal = {
  summary: string;
  platform: string;
  hook: string;
  title: string;
  caption: string;
  hashtags: string[];
  angle: string;
  confidence: number;
  reasons: string[];
  humanReviewRequired: true;
  productionPlan?: ContentProductionPlan;
};

export type ContentProductionPlan = {
  contentScript?: string;
  narrationScript?: string;
  visualPlan?: Array<{ sequence: number; description: string; durationSeconds?: number }>;
  requiredMediaType?: "short-form-video";
  aspectRatio?: string;
  targetDurationSeconds?: number;
  captionRequirements?: { burnedIn: boolean; language?: string; style?: string };
};

export type ContentProviderRequestArgs = {
  content: string;
  objective: string;
  apiKey: string;
  model: string;
};

export type ContentProviderRequester = (args: ContentProviderRequestArgs) => Promise<unknown>;

function readApiKey(env: NodeJS.ProcessEnv): string {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Content AI provider is not configured: OPENAI_API_KEY is missing.");
  }
  return apiKey;
}

async function requestFromOpenAi({ content, objective, apiKey, model }: ContentProviderRequestArgs): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: 700,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are Novara's Content Agent. Analyse the supplied content and propose ONE social-media post concept. " +
              'Respond with ONLY a single JSON object with these required keys: summary (string), platform (string), hook (string), ' +
              "title (string), caption (string), hashtags (array of strings, no # symbol), angle (string), confidence (number between 0 and 1), " +
              "reasons (array of strings). You may additionally include productionPlan only when the supplied content supports truthful production details. " +
              "productionPlan may include contentScript (non-empty string), narrationScript (non-empty string), visualPlan (array of scenes with positive sequence, non-empty description, and optional positive durationSeconds), " +
              'requiredMediaType (exactly "short-form-video"), aspectRatio (non-empty string), targetDurationSeconds (positive number), and captionRequirements (object with burnedIn boolean and optional non-empty language/style). ' +
              "Omit any productionPlan field you cannot support truthfully. Do not invent production details. Do not include any other keys, commentary, or text outside the JSON object.",
          },
          {
            role: "user",
            content: `Objective: ${objective || "Produce a social-media post proposal."}\n\nContent to analyse:\n${content}`,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // Never include request headers (which would carry the API key) in the error.
      throw new Error(`Content AI provider request failed with status ${response.status}.`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Content AI provider response is missing a valid "${field}" field.`);
  }
  return value.trim();
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new Error(`Content AI provider response is missing a valid "${field}" array field.`);
  }
  return value.map((item) => (item as string).trim());
}

function requireConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('Content AI provider response is missing a valid "confidence" field between 0 and 1.');
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, field);
}

function optionalPositiveNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Content AI provider response is missing a valid positive "${field}" number.`);
  }
  return value;
}

function optionalProductionPlan(value: unknown): ContentProductionPlan | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error('Content AI provider response has an invalid "productionPlan" object.');
  }

  const plan = value as Record<string, unknown>;
  let visualPlan: ContentProductionPlan["visualPlan"];
  if (plan.visualPlan !== undefined) {
    if (!Array.isArray(plan.visualPlan)) {
      throw new Error('Content AI provider response has an invalid "productionPlan.visualPlan" array.');
    }
    visualPlan = plan.visualPlan.map((scene, index) => {
      if (!scene || typeof scene !== "object" || Array.isArray(scene)) {
        throw new Error(`Content AI provider response has an invalid "productionPlan.visualPlan[${index}]" scene.`);
      }
      const raw = scene as Record<string, unknown>;
      const sequence = raw.sequence === undefined
        ? index + 1
        : optionalPositiveNumber(raw.sequence, `productionPlan.visualPlan[${index}].sequence`)!;
      return {
        sequence,
        description: requireString(raw.description, `productionPlan.visualPlan[${index}].description`),
        ...(optionalPositiveNumber(raw.durationSeconds, `productionPlan.visualPlan[${index}].durationSeconds`) !== undefined
          ? { durationSeconds: optionalPositiveNumber(raw.durationSeconds, `productionPlan.visualPlan[${index}].durationSeconds`) }
          : {}),
      };
    });
  }

  let captionRequirements: ContentProductionPlan["captionRequirements"];
  if (plan.captionRequirements !== undefined) {
    if (!plan.captionRequirements || typeof plan.captionRequirements !== "object" || Array.isArray(plan.captionRequirements)) {
      throw new Error('Content AI provider response has an invalid "productionPlan.captionRequirements" object.');
    }
    const raw = plan.captionRequirements as Record<string, unknown>;
    if (typeof raw.burnedIn !== "boolean") {
      throw new Error('Content AI provider response is missing a valid "productionPlan.captionRequirements.burnedIn" boolean.');
    }
    captionRequirements = {
      burnedIn: raw.burnedIn,
      ...(optionalString(raw.language, "productionPlan.captionRequirements.language") !== undefined ? { language: optionalString(raw.language, "productionPlan.captionRequirements.language") } : {}),
      ...(optionalString(raw.style, "productionPlan.captionRequirements.style") !== undefined ? { style: optionalString(raw.style, "productionPlan.captionRequirements.style") } : {}),
    };
  }

  if (plan.requiredMediaType !== undefined && plan.requiredMediaType !== "short-form-video") {
    throw new Error('Content AI provider response has an invalid "productionPlan.requiredMediaType" value.');
  }

  return {
    ...(optionalString(plan.contentScript, "productionPlan.contentScript") !== undefined ? { contentScript: optionalString(plan.contentScript, "productionPlan.contentScript") } : {}),
    ...(optionalString(plan.narrationScript, "productionPlan.narrationScript") !== undefined ? { narrationScript: optionalString(plan.narrationScript, "productionPlan.narrationScript") } : {}),
    ...(visualPlan !== undefined ? { visualPlan } : {}),
    ...(plan.requiredMediaType === "short-form-video" ? { requiredMediaType: "short-form-video" } : {}),
    ...(optionalString(plan.aspectRatio, "productionPlan.aspectRatio") !== undefined ? { aspectRatio: optionalString(plan.aspectRatio, "productionPlan.aspectRatio") } : {}),
    ...(optionalPositiveNumber(plan.targetDurationSeconds, "productionPlan.targetDurationSeconds") !== undefined ? { targetDurationSeconds: optionalPositiveNumber(plan.targetDurationSeconds, "productionPlan.targetDurationSeconds") } : {}),
    ...(captionRequirements !== undefined ? { captionRequirements } : {}),
  };
}

/** Validates and normalizes a raw provider payload. Rejects anything malformed rather than guessing. */
export function parseProviderPayload(payload: unknown): ContentProposal {
  if (!payload || typeof payload !== "object") {
    throw new Error("Content AI provider returned a malformed response envelope.");
  }

  const choices = (payload as Record<string, unknown>).choices;
  const firstChoice = Array.isArray(choices) ? choices[0] : undefined;
  const message = firstChoice && typeof firstChoice === "object" ? (firstChoice as Record<string, unknown>).message : undefined;
  const rawContent = message && typeof message === "object" ? (message as Record<string, unknown>).content : undefined;

  if (typeof rawContent !== "string" || rawContent.trim().length === 0) {
    throw new Error("Content AI provider response did not contain a message body.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new Error("Content AI provider response body was not valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Content AI provider response body was not a JSON object.");
  }

  const record = parsed as Record<string, unknown>;

  return {
    summary: requireString(record.summary, "summary"),
    platform: requireString(record.platform, "platform"),
    hook: requireString(record.hook, "hook"),
    title: requireString(record.title, "title"),
    caption: requireString(record.caption, "caption"),
    hashtags: requireStringArray(record.hashtags, "hashtags"),
    angle: requireString(record.angle, "angle"),
    confidence: requireConfidence(record.confidence),
    reasons: requireStringArray(record.reasons, "reasons"),
    // Always true for this milestone, regardless of what the provider returned.
    humanReviewRequired: true,
    ...(optionalProductionPlan(record.productionPlan) !== undefined ? { productionPlan: optionalProductionPlan(record.productionPlan) } : {}),
  };
}

export type GenerateContentProposalOptions = {
  requester?: ContentProviderRequester;
  env?: NodeJS.ProcessEnv;
  model?: string;
};

/** Makes one real, bounded AI request and returns a validated structured proposal. Never falls back to fake content. */
export async function generateContentProposal(
  content: string,
  objective: string,
  options: GenerateContentProposalOptions = {},
): Promise<ContentProposal> {
  const trimmedContent = content.trim();
  if (!trimmedContent) {
    throw new Error("Content Agent requires non-empty content to analyse.");
  }
  if (trimmedContent.length > MAX_CONTENT_LENGTH) {
    throw new Error(`Content Agent input exceeds the maximum supported length of ${MAX_CONTENT_LENGTH} characters.`);
  }

  const env = options.env ?? process.env;
  const apiKey = readApiKey(env);
  const model = options.model ?? (env.OPENAI_MODEL_ID?.trim() || DEFAULT_MODEL);
  const requester = options.requester ?? requestFromOpenAi;

  const payload = await requester({ content: trimmedContent, objective, apiKey, model });
  return parseProviderPayload(payload);
}
