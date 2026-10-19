import { randomUUID } from "node:crypto";
import type { TopicKind, TopicNode } from "@semwise/shared";
import type { SyllabusExtraction } from "../ai/index.js";
import type { TopicRow } from "./syllabus.repository.js";

export const newTopicId = () => `st${randomUUID().replace(/-/g, "")}`;
export const newStableKey = () => `tk_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

/** The kind a child of `parent` must have (null: nothing may go below it). */
export function childKind(parent: TopicKind | null): TopicKind | null {
  if (parent === null) return "UNIT";
  if (parent === "UNIT") return "TOPIC";
  if (parent === "TOPIC") return "SUBTOPIC";
  return null;
}

/** Lowercase, without numbering ("Unit 3:", "2.1") and punctuation, for matching across versions. */
export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/^\s*(unit|chapter|module)\s*[0-9ivx]+\s*[:.\-–]?\s*/i, "")
    .replace(/^\s*[0-9]+(\.[0-9]+)*\s*[:.)\-–]?\s*/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function buildTree(rows: TopicRow[]): TopicNode[] {
  const nodes = new Map<string, TopicNode>();
  for (const r of rows) {
    nodes.set(r.id, {
      id: r.id,
      stableKey: r.stableKey,
      kind: r.kind,
      title: r.title,
      description: r.description,
      hours: r.hours,
      sourcePage: r.sourcePage,
      confidence: r.confidence,
      children: [],
    });
  }
  const roots: TopicNode[] = [];
  for (const r of [...rows].sort((x, y) => x.orderIndex - y.orderIndex)) {
    const node = nodes.get(r.id)!;
    const parent = r.parentId ? nodes.get(r.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/**
 * Hands out stable keys: a topic whose kind and title match one of the previous version keeps
 * that key (so class entries keep pointing at it); anything new gets a new key.
 */
function keyReuser(previous: TopicRow[]) {
  const pool = new Map<string, string[]>();
  for (const p of previous) {
    const k = `${p.kind}:${normaliseTitle(p.title)}`;
    pool.set(k, [...(pool.get(k) ?? []), p.stableKey]);
  }
  return (kind: TopicKind, title: string) => {
    const list = pool.get(`${kind}:${normaliseTitle(title)}`);
    return list?.shift() ?? newStableKey();
  };
}

/** Rows (parents first) for an AI extraction. */
export function rowsFromExtraction(
  extraction: SyllabusExtraction,
  previous: TopicRow[] = [],
): TopicRow[] {
  const keyFor = keyReuser(previous);
  const rows: TopicRow[] = [];
  extraction.units.forEach((unit, u) => {
    const unitId = newTopicId();
    rows.push({
      id: unitId,
      parentId: null,
      stableKey: keyFor("UNIT", unit.title),
      kind: "UNIT",
      title: unit.title,
      description: unit.description,
      hours: unit.hours,
      orderIndex: u,
      sourcePage: unit.sourcePage,
      confidence: unit.confidence,
    });
    unit.topics.forEach((topic, t) => {
      const topicId = newTopicId();
      rows.push({
        id: topicId,
        parentId: unitId,
        stableKey: keyFor("TOPIC", topic.title),
        kind: "TOPIC",
        title: topic.title,
        description: topic.description,
        hours: null,
        orderIndex: t,
        sourcePage: topic.sourcePage,
        confidence: topic.confidence,
      });
      topic.subtopics.forEach((sub, s) => {
        rows.push({
          id: newTopicId(),
          parentId: topicId,
          stableKey: keyFor("SUBTOPIC", sub.title),
          kind: "SUBTOPIC",
          title: sub.title,
          description: null,
          hours: null,
          orderIndex: s,
          sourcePage: sub.sourcePage,
          confidence: sub.confidence,
        });
      });
    });
  });
  return rows;
}

/** Copies rows with new ids. keepKeys: same subject (version N+1); else a fresh, independent copy. */
export function cloneRows(rows: TopicRow[], keepKeys: boolean): TopicRow[] {
  const ids = new Map(rows.map((r) => [r.id, newTopicId()]));
  const depth = (r: TopicRow) => (r.kind === "UNIT" ? 0 : r.kind === "TOPIC" ? 1 : 2);
  return [...rows]
    .sort((a, b) => depth(a) - depth(b))
    .map((r) => ({
      ...r,
      id: ids.get(r.id)!,
      parentId: r.parentId ? ids.get(r.parentId)! : null,
      stableKey: keepKeys ? r.stableKey : newStableKey(),
    }));
}

/**
 * The outline the AI sees for change requests: short aliases (T1, T2 ...) instead of database
 * ids, so it can only refer to nodes that exist.
 */
export function outlineForAi(rows: TopicRow[]): { text: string; aliasToId: Map<string, string> } {
  const aliasToId = new Map<string, string>();
  const lines: string[] = [];
  const walk = (nodes: TopicNode[], indent: string) => {
    for (const node of nodes) {
      const alias = `T${aliasToId.size + 1}`;
      aliasToId.set(alias, node.id);
      lines.push(`${indent}${alias} [${node.kind}] ${node.title}`);
      walk(node.children, `${indent}  `);
    }
  };
  walk(buildTree(rows), "");
  return { text: lines.join("\n") || "(empty outline)", aliasToId };
}

/** The path of a node for the diff view: "Unit 2 > Pointers > Arrays". */
export function pathOf(rows: TopicRow[], id: string): string {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const parts: string[] = [];
  let current = byId.get(id);
  while (current) {
    parts.unshift(current.title);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return parts.join(" > ");
}

export interface SyllabusChunk {
  sourceId: string;
  text: string;
  stableKey: string;
  unitNo: number;
  unitTitle: string;
  topicTitle: string | null;
}

/**
 * One chunk per topic (with its subtopics), and one for a unit that has no topics: small enough
 * to retrieve precisely, big enough to carry context.
 */
export function chunksFor(
  rows: TopicRow[],
  subject: { name: string; code: string },
): SyllabusChunk[] {
  const chunks: SyllabusChunk[] = [];
  buildTree(rows).forEach((unit, u) => {
    const unitLine = `Unit ${u + 1}: ${unit.title}${unit.hours ? ` (${unit.hours} hours)` : ""}`;
    const head = `Subject: ${subject.name} (${subject.code})\n${unitLine}`;
    if (unit.children.length === 0) {
      chunks.push({
        sourceId: unit.id,
        stableKey: unit.stableKey,
        unitNo: u + 1,
        unitTitle: unit.title,
        topicTitle: null,
        text: [head, unit.description].filter(Boolean).join("\n"),
      });
    }
    for (const topic of unit.children) {
      const subs = topic.children.map((s) => s.title);
      chunks.push({
        sourceId: topic.id,
        stableKey: topic.stableKey,
        unitNo: u + 1,
        unitTitle: unit.title,
        topicTitle: topic.title,
        text: [
          head,
          `Topic: ${topic.title}`,
          subs.length ? `Subtopics: ${subs.join("; ")}` : null,
          topic.description,
        ]
          .filter(Boolean)
          .join("\n"),
      });
    }
  });
  return chunks;
}
