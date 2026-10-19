import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnswerText } from "./answer-text";

const html = (text: string) =>
  renderToStaticMarkup(
    <AnswerText text={text} renderSource={(key) => <b data-source={key}>{key}</b>} />,
  );

describe("answer text", () => {
  it("turns source markers into chips next to the claim", () => {
    const out = html("Pointers hold addresses [S1]. Arrays decay [S2, S3].");
    expect(out).toContain('data-source="S1"');
    expect(out).toContain('data-source="S2"');
    expect(out).toContain('data-source="S3"');
    expect(out).not.toContain("[S1]");
  });

  it("renders lists, code and bold, and keeps HTML in the answer as plain text", () => {
    const out = html(
      "**Steps**\n- scan left to right\n- push operators\n\n```c\nint *p = a;\n```\n<img src=x onerror=alert(1)>",
    );
    expect(out).toContain("<strong>Steps</strong>");
    expect(out).toContain("<ul");
    expect(out).toContain("<code>int *p = a;</code>");
    expect(out).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(out).not.toContain("<img");
  });

  it("sets the general explanation heading apart", () => {
    expect(html("From class [S1].\nGeneral explanation:\nMore detail.")).toContain(
      'class="mt-1 text-sm font-semibold text-muted">General explanation:</p>',
    );
  });
});
