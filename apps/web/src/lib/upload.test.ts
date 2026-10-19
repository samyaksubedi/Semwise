import { describe, expect, it } from "vitest";
import { mimeOf } from "./upload";

const file = (type: string, name?: string) => Object.assign(new Blob(["x"], { type }), { name });

describe("upload types", () => {
  it("uses the browser's type, the base type of a recorder's codecs, or the file extension", () => {
    expect(mimeOf(file("application/pdf", "s.pdf"), "SYLLABUS_PDF")).toBe("application/pdf");
    expect(mimeOf(file("audio/webm;codecs=opus"), "AUDIO")).toBe("audio/webm");
    expect(mimeOf(file("", "note.m4a"), "AUDIO")).toBe("audio/mp4");
    expect(mimeOf(file("", "board.JPG"), "PHOTO")).toBe("image/jpeg");
  });
});
