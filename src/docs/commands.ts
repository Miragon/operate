/**
 * Command discovery for `operate commands`: the groups of the catalog and the commands of one group
 * or of a search across all groups. Pure.
 */

import type { Catalog, Effect, OperationSpec } from '../catalog/types.js';

export interface GroupSummary {
  readonly group: string;
  readonly description: string;
  /** Number of commands in the group, presets (`suspend`, `activate`) included. */
  readonly commands: number;
}

export interface CommandSummary {
  /** Group and command name, e.g. `process-instance list`. */
  readonly command: string;
  readonly aliases: readonly string[];
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly effect: Effect;
  readonly summary: string;
  readonly deprecated: boolean;
}

export interface CommandFilter {
  /** Only commands of this group; an unknown group gives an empty list. */
  readonly group?: string;
  /**
   * Case-insensitive words that must each occur in the command, an alias, the operationId, the
   * summary or the path (`process instance` finds `process-instance list`).
   */
  readonly search?: string;
  readonly effect?: Effect;
}

/** Ordinal string order, independent of the locale. */
function compareText(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/** Every group with its description and number of commands, sorted by name. */
export function listGroups(catalog: Catalog): GroupSummary[] {
  return catalog.groups
    .map((group) => ({
      group: group.name,
      description: group.description,
      commands: catalog.operations.filter((operation) => operation.group === group.name).length,
    }))
    .sort((left, right) => compareText(left.group, right.group));
}

/** The texts `--search` looks at. */
function searchableTexts(operation: OperationSpec): string[] {
  return [
    `${operation.group} ${operation.name}`,
    ...operation.aliases,
    operation.operationId,
    operation.summary,
    operation.path,
  ];
}

function matchesSearch(operation: OperationSpec, search: string | undefined): boolean {
  if (search === undefined) return true;
  // one line per text, so that a word never matches across two of them
  const haystack = searchableTexts(operation).join('\n').toLowerCase();
  // runs of blanks give empty words, which match everything
  const words = search.toLowerCase().split(/\s/);
  return words.every((word) => haystack.includes(word));
}

function matches(operation: OperationSpec, filter: CommandFilter): boolean {
  return (
    (filter.group === undefined || operation.group === filter.group) &&
    (filter.effect === undefined || operation.effect === filter.effect) &&
    matchesSearch(operation, filter.search)
  );
}

function toSummary(operation: OperationSpec): CommandSummary {
  return {
    command: `${operation.group} ${operation.name}`,
    aliases: operation.aliases,
    operationId: operation.operationId,
    method: operation.method,
    path: operation.path,
    effect: operation.effect,
    summary: operation.summary,
    deprecated: operation.deprecated,
  };
}

/** Commands matching every given filter, sorted by group, then by command name. */
export function listCommands(catalog: Catalog, filter: CommandFilter): CommandSummary[] {
  return catalog.operations
    .filter((operation) => matches(operation, filter))
    .sort(
      (left, right) => compareText(left.group, right.group) || compareText(left.name, right.name),
    )
    .map(toSummary);
}
