import type { EntryVersionView, EntryView } from "@semwise/shared";
import { describe, expect, it } from "vitest";
import { entryStatus, shownLatest } from "./shared";

const version = (patch: Partial<EntryVersionView>): EntryVersionView => ({
  id: "v",
  versionNo: 1,
  status: "PUBLISHED",
  inputKind: "TEXT",
  rawText: "x",
  topics: [],
  summary: null,
  organize: "DONE",
  organizeError: null,
  mappingStale: false,
  authorId: null,
  submittedAt: null,
  decidedAt: null,
  rejectionReason: null,
  unreviewed: false,
  minorEdit: false,
  createdAt: "2026-10-19T00:00:00Z",
  ...patch,
});

const entry = (patch: Partial<EntryView>): EntryView => ({
  id: "e",
  classId: "c",
  subject: { id: "s", name: "S", code: "S1" },
  section: { id: "a", name: "A" },
  taughtOn: "2026-10-19",
  authorId: null,
  takenDown: false,
  live: null,
  latest: null,
  ...patch,
});

describe("entry status", () => {
  it("shows the newest step: waiting, draft, rejected, then live", () => {
    expect(entryStatus(entry({ latest: version({ status: "PENDING" }) })).label).toBe(
      "Waiting for teacher",
    );
    expect(entryStatus(entry({ latest: version({ status: "DRAFT" }) })).label).toBe("Draft");
    expect(entryStatus(entry({ latest: version({ status: "REJECTED" }) })).tone).toBe("danger");
    expect(entryStatus(entry({ live: version({}) })).label).toBe("Published");
    expect(entryStatus(entry({ live: version({ unreviewed: true }) })).label).toBe(
      "Published, not reviewed",
    );
  });

  it("an edit waiting for approval wins over the live version; a takedown wins over all", () => {
    expect(
      entryStatus(entry({ live: version({}), latest: version({ status: "PENDING" }) })).label,
    ).toBe("Waiting for teacher");
    expect(entryStatus(entry({ takenDown: true, live: version({}) })).label).toBe("Taken down");
  });
});

describe("shownLatest", () => {
  it("hides a withdrawn change and keeps open ones", () => {
    const live = version({ status: "PUBLISHED" });
    expect(shownLatest(entry({ live, latest: version({ status: "WITHDRAWN" }) }))).toBeNull();
    const pending = version({ status: "PENDING", versionNo: 2 });
    expect(shownLatest(entry({ live, latest: pending }))).toBe(pending);
  });
});
