import { promises as fs } from "node:fs";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

type ListEntry = {
  path: string;
  type: "file" | "folder";
};

type SearchMatch = {
  path: string;
  line: number;
  text: string;
};

type FrontmatterData = Record<string, string>;

function normalizeVaultRoot(vaultRoot: string): string {
  const normalized = path.resolve(vaultRoot);
  return normalized.endsWith(path.sep) ? normalized.slice(0, -1) : normalized;
}

function toPosixRelative(vaultRoot: string, absolutePath: string): string {
  const relative = path.relative(vaultRoot, absolutePath);
  return relative.split(path.sep).join("/");
}

function assertWithinVault(vaultRoot: string, absolutePath: string): void {
  const normalizedRoot = normalizeVaultRoot(vaultRoot);
  const normalizedPath = path.resolve(absolutePath);

  if (
    normalizedPath !== normalizedRoot &&
    !normalizedPath.startsWith(`${normalizedRoot}${path.sep}`)
  ) {
    throw new Error("Requested path is outside the configured vault root.");
  }
}

function resolveScopedPath(vaultRoot: string, requestedPath?: string): string {
  const normalizedRoot = normalizeVaultRoot(vaultRoot);
  const raw = requestedPath && requestedPath.trim().length > 0 ? requestedPath : ".";
  const absolutePath = path.resolve(normalizedRoot, raw);
  assertWithinVault(normalizedRoot, absolutePath);
  return absolutePath;
}

function isMarkdownFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".md" || ext === ".markdown";
}

async function collectEntries(
  vaultRoot: string,
  rootPath: string,
  recursive: boolean,
  includeFiles: boolean,
  includeFolders: boolean,
): Promise<ListEntry[]> {
  const results: ListEntry[] = [];

  async function walk(currentPath: string) {
    const dirEntries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of dirEntries) {
      const fullPath = path.join(currentPath, entry.name);
      assertWithinVault(vaultRoot, fullPath);
      const relativePath = toPosixRelative(vaultRoot, fullPath);

      if (entry.isDirectory()) {
        if (includeFolders) {
          results.push({ path: relativePath, type: "folder" });
        }

        if (recursive) {
          await walk(fullPath);
        }
      } else if (entry.isFile()) {
        if (includeFiles) {
          results.push({ path: relativePath, type: "file" });
        }
      }
    }
  }

  await walk(rootPath);
  results.sort((a, b) => a.path.localeCompare(b.path));
  return results;
}

function parseFrontmatter(markdownText: string): FrontmatterData | null {
  if (!markdownText.startsWith("---\n")) {
    return null;
  }

  const endMarkerIndex = markdownText.indexOf("\n---\n", 4);
  if (endMarkerIndex === -1) {
    return null;
  }

  const raw = markdownText.slice(4, endMarkerIndex).trim();
  if (!raw) {
    return {};
  }

  const frontmatter: FrontmatterData = {};
  for (const line of raw.split(/\r?\n/)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key) {
      frontmatter[key] = value;
    }
  }

  return frontmatter;
}

async function collectMarkdownFiles(
  vaultRoot: string,
  searchRoot: string,
  results: string[],
): Promise<void> {
  const entries = await fs.readdir(searchRoot, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(searchRoot, entry.name);
    assertWithinVault(vaultRoot, fullPath);

    if (entry.isDirectory()) {
      await collectMarkdownFiles(vaultRoot, fullPath, results);
    } else if (entry.isFile() && isMarkdownFile(fullPath)) {
      results.push(fullPath);
    }
  }
}

async function searchMarkdown(
  vaultRoot: string,
  query: string,
  searchPath?: string,
  caseSensitive = false,
  maxResults = 100,
): Promise<SearchMatch[]> {
  const searchRoot = resolveScopedPath(vaultRoot, searchPath);
  const markdownFiles: string[] = [];
  await collectMarkdownFiles(vaultRoot, searchRoot, markdownFiles);

  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: SearchMatch[] = [];

  for (const file of markdownFiles.sort((a, b) => a.localeCompare(b))) {
    const content = await fs.readFile(file, "utf8");
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const haystack = caseSensitive ? line : line.toLowerCase();

      if (haystack.includes(needle)) {
        matches.push({
          path: toPosixRelative(vaultRoot, file),
          line: i + 1,
          text: line,
        });
      }

      if (matches.length >= maxResults) {
        return matches;
      }
    }
  }

  return matches;
}

export function createObsidianReadOnlyMcpServer(vaultRoot: string): Server {
  const normalizedRoot = normalizeVaultRoot(vaultRoot);
  const server = new Server(
    {
      name: "novara-obsidian-readonly",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "listVaultEntries",
        description:
          "List files and folders under the configured Obsidian vault path. Read-only.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            recursive: { type: "boolean" },
            includeFiles: { type: "boolean" },
            includeFolders: { type: "boolean" },
          },
        },
      },
      {
        name: "readMarkdownFile",
        description:
          "Read a Markdown file from the configured Obsidian vault path. Read-only.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            includeFrontmatter: { type: "boolean" },
          },
          required: ["path"],
        },
      },
      {
        name: "searchMarkdownText",
        description:
          "Search text across Markdown files in the configured Obsidian vault path. Read-only.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            path: { type: "string" },
            caseSensitive: { type: "boolean" },
            maxResults: { type: "number" },
          },
          required: ["query"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "listVaultEntries": {
        const scopedPath = resolveScopedPath(normalizedRoot, args?.path as string | undefined);
        const recursive = (args?.recursive as boolean | undefined) ?? false;
        const includeFiles = (args?.includeFiles as boolean | undefined) ?? true;
        const includeFolders = (args?.includeFolders as boolean | undefined) ?? true;

        if (!includeFiles && !includeFolders) {
          throw new Error("At least one of includeFiles/includeFolders must be true.");
        }

        const stats = await fs.stat(scopedPath);
        if (!stats.isDirectory()) {
          throw new Error("path must point to a folder.");
        }

        const entries = await collectEntries(
          normalizedRoot,
          scopedPath,
          recursive,
          includeFiles,
          includeFolders,
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  vaultRoot: normalizedRoot,
                  scopedPath: toPosixRelative(normalizedRoot, scopedPath) || ".",
                  count: entries.length,
                  entries,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      case "readMarkdownFile": {
        const requestedPath = args?.path as string | undefined;
        if (!requestedPath) {
          throw new Error("path is required");
        }

        const scopedPath = resolveScopedPath(normalizedRoot, requestedPath);

        if (!isMarkdownFile(scopedPath)) {
          throw new Error("Only Markdown files are allowed (.md, .markdown).");
        }

        const stats = await fs.stat(scopedPath);
        if (!stats.isFile()) {
          throw new Error("path must point to a file.");
        }

        const includeFrontmatter = (args?.includeFrontmatter as boolean | undefined) ?? true;
        const content = await fs.readFile(scopedPath, "utf8");
        const frontmatter = includeFrontmatter ? parseFrontmatter(content) : null;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  path: toPosixRelative(normalizedRoot, scopedPath),
                  size: stats.size,
                  frontmatter,
                  content,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      case "searchMarkdownText": {
        const query = args?.query as string | undefined;
        if (!query || query.trim().length === 0) {
          throw new Error("query is required");
        }

        const searchPath = args?.path as string | undefined;
        const caseSensitive = (args?.caseSensitive as boolean | undefined) ?? false;
        const maxResults = Math.max(1, Math.min(1000, Number(args?.maxResults ?? 100)));

        const matches = await searchMarkdown(
          normalizedRoot,
          query,
          searchPath,
          caseSensitive,
          maxResults,
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  vaultRoot: normalizedRoot,
                  query,
                  caseSensitive,
                  maxResults,
                  count: matches.length,
                  matches,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  return server;
}

export async function startObsidianReadOnlyMcpServer(vaultRoot: string): Promise<Server> {
  const normalizedRoot = normalizeVaultRoot(vaultRoot);
  const stats = await fs.stat(normalizedRoot);
  if (!stats.isDirectory()) {
    throw new Error(`Vault root is not a directory: ${normalizedRoot}`);
  }

  const server = createObsidianReadOnlyMcpServer(normalizedRoot);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}
