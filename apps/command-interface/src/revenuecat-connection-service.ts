import { replaceLocalEnvEntries } from "./local-connection-config.ts";

// Direct RevenueCat REST API v2 configuration. Deliberately separate from the RevenueCat MCP
// connection used by Hermes: this module owns its own environment keys and reads nothing else.
const REVENUECAT_API_BASE_URL = "https://api.revenuecat.com/v2";

export type RevenueCatConnectionResult = {
  configured: boolean;
  projectName: string;
  projectId: string;
  test: "untested" | "successful" | "failed";
  httpStatus?: number;
  reason?: string;
  selectionRequired?: boolean;
  projects?: RevenueCatProject[];
};

export type RevenueCatProject = {
  id: string;
  name: string;
};

const REASON_BY_STATUS: Record<number, string> = {
  400: "Invalid request.",
  401: "API key is invalid or not authenticated. RevenueCat API v2 requires a V2 secret API key.",
  403: "API key does not have permission for this request.",
  404: "Project/resource could not be found.",
  429: "Rate limit reached. Please retry later.",
};

async function describeFailure(response: Response, apiKey: string, fallback: string): Promise<string> {
  let detail = "";
  try {
    const body = await response.text();
    try {
      const parsed = JSON.parse(body) as { message?: string; error?: string; detail?: string };
      detail = parsed.message ?? parsed.error ?? parsed.detail ?? "";
    } catch {
      detail = body;
    }
  } catch {
    detail = "";
  }
  const safeDetail = detail.replaceAll(apiKey, "<redacted>").replace(/\s+/g, " ").trim().slice(0, 160);
  const base = REASON_BY_STATUS[response.status] ?? fallback;
  return safeDetail ? `${base} (${safeDetail})` : base;
}

/** Never returns the API key. Only the non-secret project identifier and a configured flag. */
export function readRevenueCatConnectionStatus(env: NodeJS.ProcessEnv = process.env): RevenueCatConnectionResult {
  const configuredProject = env.REVENUECAT_PROJECT_ID?.trim() ?? "";
  return {
    configured: Boolean(env.REVENUECAT_API_KEY?.trim()),
    projectName: env.REVENUECAT_PROJECT_NAME?.trim() || (configuredProject.startsWith("proj") ? "" : configuredProject),
    projectId: configuredProject.startsWith("proj") ? configuredProject : "",
    test: "untested",
  };
}

export function saveRevenueCatConnection(envPath: string, apiKey: string, projectId: string, projectName: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!apiKey.trim()) throw new Error("RevenueCat API key is required.");
  if (!projectId.trim().startsWith("proj")) throw new Error("RevenueCat Project ID must be an ID returned by the RevenueCat API.");
  const values = { REVENUECAT_API_KEY: apiKey.trim(), REVENUECAT_PROJECT_ID: projectId.trim(), REVENUECAT_PROJECT_NAME: projectName.trim() };
  replaceLocalEnvEntries(envPath, values, env);
  Object.assign(env, values);
}

export async function configureRevenueCatConnection(envPath: string, apiKeyInput: string, selectedProjectId: string | undefined, env: NodeJS.ProcessEnv = process.env, requester: typeof fetch = fetch): Promise<RevenueCatConnectionResult> {
  const apiKey = apiKeyInput.trim() || env.REVENUECAT_API_KEY?.trim();
  if (!apiKey) throw new Error("RevenueCat API key is required.");

  const listed = await listRevenueCatProjects(apiKey, requester);
  if ("failure" in listed) return listed.failure;
  const { projects, httpStatus } = listed;
  const selectedProject = selectedProjectId ? projects.find((project) => project.id === selectedProjectId) : projects.length === 1 ? projects[0] : undefined;
  if (!selectedProject) {
    if (projects.length > 1 && !selectedProjectId) {
      return { configured: Boolean(env.REVENUECAT_API_KEY?.trim()), projectName: "", projectId: "", test: "untested", httpStatus, reason: "Select the RevenueCat project to connect.", selectionRequired: true, projects };
    }
    return { configured: Boolean(env.REVENUECAT_API_KEY?.trim()), projectName: "", projectId: "", test: "failed", httpStatus, reason: selectedProjectId ? "The selected project is not visible to this API key." : "No RevenueCat projects are visible to this API key." };
  }

  saveRevenueCatConnection(envPath, apiKey, selectedProject.id, selectedProject.name, env);
  return { configured: true, projectName: selectedProject.name, projectId: selectedProject.id, test: "untested", httpStatus };
}

/** Read-only List Projects call. Creates, modifies, refunds, and grants nothing. */
export async function testRevenueCatConnection(env: NodeJS.ProcessEnv = process.env, requester: typeof fetch = fetch): Promise<RevenueCatConnectionResult> {
  const apiKey = env.REVENUECAT_API_KEY?.trim();
  const configuredProject = env.REVENUECAT_PROJECT_ID?.trim() ?? "";
  const projectId = configuredProject.startsWith("proj") ? configuredProject : "";
  const projectName = env.REVENUECAT_PROJECT_NAME?.trim() || (projectId ? "" : configuredProject);
  if (!apiKey) return { configured: false, projectName, projectId, test: "untested" };

  try {
    const listed = await listRevenueCatProjects(apiKey, requester);
    if ("failure" in listed) return listed.failure;
    const { projects, httpStatus } = listed;
    const matchedProject = projectId ? projects.find((project) => project.id === projectId) : projects.length === 1 ? projects[0] : undefined;
    if (!matchedProject && projects.length > 1) {
      return { configured: true, projectName, projectId, test: "failed", httpStatus, reason: "Authentication succeeded. Select the RevenueCat project to connect.", selectionRequired: true, projects };
    }
    if (!matchedProject) {
      return { configured: true, projectName, projectId, test: "failed", httpStatus, reason: `Authentication succeeded but project ${projectName || projectId || "configuration"} is not visible to this API key.` };
    }
    return { configured: true, projectName: matchedProject.name, projectId: matchedProject.id, test: "successful", httpStatus, reason: "API authentication and project access: OK." };
  } catch {
    return { configured: true, projectName, projectId, test: "failed", reason: "RevenueCat could not be reached from this machine." };
  }
}

async function listRevenueCatProjects(apiKey: string, requester: typeof fetch): Promise<{ projects: RevenueCatProject[]; httpStatus: number } | { failure: RevenueCatConnectionResult }> {
  const response = await requester(`${REVENUECAT_API_BASE_URL}/projects`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
  if (!response.ok) {
    return { failure: { configured: true, projectName: "", projectId: "", test: "failed", httpStatus: response.status, reason: await describeFailure(response, apiKey, "RevenueCat rejected the request.") } };
  }
  try {
    const payload = await response.json() as { items?: unknown; data?: unknown };
    const entries = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : Array.isArray(payload?.data) ? payload.data : [];
    const projects = entries.flatMap((entry) => {
      const { id, name } = entry as { id?: unknown; name?: unknown };
      return typeof id === "string" && id.startsWith("proj") ? [{ id, name: typeof name === "string" ? name : "Unnamed project" }] : [];
    });
    return { projects, httpStatus: response.status };
  } catch {
    return { projects: [], httpStatus: response.status };
  }
}
