/**
 * `--fields` projection on JSON values. Paths are dot separated (`a.b.c`). The projection never
 * mutates its input and never writes through inherited properties such as `__proto__`.
 */

import { isRecord } from '../util.js';

type JsonObject = Record<string, unknown>;

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

function isAllowed(field: string): boolean {
  return field !== '' && !field.split('.').some((segment) => FORBIDDEN_SEGMENTS.has(segment));
}

/** Parses `a, b.c,a` into unique, trimmed paths; undefined when nothing usable remains. */
export function parseFieldList(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const fields = raw
    .split(',')
    .map((field) => field.trim())
    .filter(isAllowed);
  return fields.length === 0 ? undefined : [...new Set(fields)];
}

/** Reads a dot separated path through own properties of nested objects (not arrays). */
export function getPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split('.')) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

/** Creates an own, enumerable property, even for keys like `__proto__`. */
function define(target: JsonObject, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** Writes into objects created by the projection only (see `isCovered`). */
function setPath(target: JsonObject, path: string, value: unknown): void {
  const segments = path.split('.');
  const last = segments.pop() ?? path;
  let current = target;
  for (const segment of segments) {
    const next = Object.hasOwn(current, segment) ? current[segment] : undefined;
    if (isRecord(next)) {
      current = next;
    } else {
      const child: JsonObject = {};
      define(current, segment, child);
      current = child;
    }
  }
  define(current, last, value);
}

/** `a.b` is covered by `a`: picking `a` already includes it. */
function isCovered(field: string, fields: readonly string[]): boolean {
  return fields.some((other) => field.startsWith(`${other}.`));
}

function pickObject(value: JsonObject, fields: readonly string[]): JsonObject {
  const result: JsonObject = {};
  for (const field of fields.filter((candidate) => !isCovered(candidate, fields))) {
    const picked = getPath(value, field);
    if (picked !== undefined) setPath(result, field, picked);
  }
  return result;
}

/** The objects a projection looks into: the value itself or the objects of an array. */
function objectsOf(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return (value as unknown[]).filter(isRecord);
  return isRecord(value) ? [value] : [];
}

/**
 * Fields that match nothing in the whole value (in no element of an array), and the top-level
 * keys that exist, for a warning. Nothing is reported for values without objects (empty lists).
 */
export function missingFields(
  value: unknown,
  fields: readonly string[],
): { readonly missing: string[]; readonly available: string[] } {
  const objects = objectsOf(value);
  if (objects.length === 0) return { missing: [], available: [] };
  const missing = fields.filter((field) =>
    objects.every((object) => getPath(object, field) === undefined),
  );
  return { missing, available: [...new Set(objects.flatMap((object) => Object.keys(object)))] };
}

/** Keeps only the given fields of an object or of every object in an array. */
export function project(value: unknown, fields: readonly string[] | undefined): unknown {
  if (fields === undefined) return value;
  if (Array.isArray(value)) {
    return (value as unknown[]).map((item) => (isRecord(item) ? pickObject(item, fields) : item));
  }
  return isRecord(value) ? pickObject(value, fields) : value;
}
