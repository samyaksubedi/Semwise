import { describe, expect, it } from "vitest";
import { parseCsv } from "./students.js";

describe("parseCsv", () => {
  it("reads quoted fields, doubled quotes, CRLF and a BOM, and drops blank lines", () => {
    const text = '﻿email,roll,name\r\na@x.np,R1,"Shrestha, Ram"\r\n\r\nb@x.np,R2,"Say ""hi"""\n';
    expect(parseCsv(text)).toEqual([
      ["email", "roll", "name"],
      ["a@x.np", "R1", "Shrestha, Ram"],
      ["b@x.np", "R2", 'Say "hi"'],
    ]);
  });

  it("keeps a last line without a newline", () => {
    expect(parseCsv("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});
