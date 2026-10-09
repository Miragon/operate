/** Renders the catalog file content from the spec and its patches. Shared by generator and tests. */

import { buildCatalog } from './build-catalog.js';
import type { OpenApiDocument } from './openapi.js';
import { type PatchOperation, applyPatch } from './patches.js';

export const SPEC_URL =
  'https://raw.githubusercontent.com/operaton/operaton-mcp/refs/heads/main/resources/operaton-rest-api.json';

/** Parses the spec and applies the RFC 6902 patches. */
export function patchedSpec(specText: string, patchText: string): OpenApiDocument {
  return applyPatch(
    JSON.parse(specText) as OpenApiDocument,
    JSON.parse(patchText) as PatchOperation[],
  );
}

/** The content of `src/generated/catalog.json`: indent 1 and a trailing newline. */
export function renderCatalog(specText: string, patchText: string): string {
  return `${JSON.stringify(buildCatalog(patchedSpec(specText, patchText), SPEC_URL), null, 1)}\n`;
}
