import { Fragment, type ReactNode } from "react";

/**
 * Renders an answer's light Markdown (paragraphs, lists, code, bold) as React elements, never
 * as HTML. [S1]-style markers become source chips next to the claim they support.
 */
export function AnswerText({
  text,
  renderSource,
}: {
  text: string;
  renderSource: (key: string) => ReactNode;
}) {
  const blocks: ReactNode[] = [];
  const parts = text.split(/```[a-zA-Z0-9]*\n?/);
  parts.forEach((part, i) => {
    // Odd parts sit between fences: code.
    if (i % 2 === 1) {
      blocks.push(
        <pre
          key={`code-${i}`}
          className="overflow-x-auto rounded-control bg-surface-2 p-3 text-sm leading-relaxed"
        >
          <code>{part.replace(/\n$/, "")}</code>
        </pre>,
      );
      return;
    }
    blocks.push(...lineBlocks(part, `b${i}`, renderSource));
  });
  return (
    <div className="flex flex-col gap-2.5 text-[15px] leading-relaxed break-words">{blocks}</div>
  );
}

function lineBlocks(
  text: string,
  prefix: string,
  renderSource: (key: string) => ReactNode,
): ReactNode[] {
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length)
      out.push(<p key={`${prefix}-p${out.length}`}>{inline(para.join(" "), renderSource)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    out.push(
      <Tag
        key={`${prefix}-l${out.length}`}
        className={list.ordered ? "list-decimal pl-5" : "list-disc pl-5"}
      >
        {list.items.map((item, i) => (
          <li key={i} className="mt-1">
            {inline(item, renderSource)}
          </li>
        ))}
      </Tag>,
    );
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushPara();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
    } else if (!line) {
      flushPara();
      flushList();
    } else if (/^#{1,4}\s+/.test(line) || /^general explanation:?$/i.test(line)) {
      flushPara();
      flushList();
      out.push(
        <p key={`${prefix}-h${out.length}`} className="mt-1 text-sm font-semibold text-muted">
          {line.replace(/^#{1,4}\s+/, "")}
        </p>,
      );
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return out;
}

function inline(text: string, renderSource: (key: string) => ReactNode): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[S\d+(?:,\s*S\d+)*\])/g).map((piece, i) => {
    if (piece.startsWith("`") && piece.endsWith("`") && piece.length > 2)
      return (
        <code key={i} className="rounded bg-surface-2 px-1 py-0.5 text-[0.9em]">
          {piece.slice(1, -1)}
        </code>
      );
    if (piece.startsWith("**") && piece.endsWith("**") && piece.length > 4)
      return <strong key={i}>{piece.slice(2, -2)}</strong>;
    const sources = /^\[(S\d+(?:,\s*S\d+)*)\]$/.exec(piece);
    if (sources)
      return (
        <Fragment key={i}>
          {sources[1]!.split(/,\s*/).map((key) => (
            <Fragment key={key}> {renderSource(key)}</Fragment>
          ))}
        </Fragment>
      );
    return <Fragment key={i}>{piece}</Fragment>;
  });
}
