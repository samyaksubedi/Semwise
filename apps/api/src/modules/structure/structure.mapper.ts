import type {
  BatchView,
  ProgramView,
  SectionView,
  SemesterView,
  SubjectView,
} from "@semwise/shared";

/** A calendar date stored as @db.Date (UTC midnight) back to "YYYY-MM-DD". */
export function toDateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** "YYYY-MM-DD" to the Date Prisma stores in a @db.Date column. */
export function fromDateOnly(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : new Date(`${value}T00:00:00.000Z`);
}

export function toProgramView(p: {
  id: string;
  name: string;
  code: string;
  status: "ACTIVE" | "ARCHIVED";
  createdAt: Date;
}): ProgramView {
  return {
    id: p.id,
    name: p.name,
    code: p.code,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
  };
}

export function toBatchView(b: {
  id: string;
  programId: string;
  name: string;
  intakeYear: number;
  status: "ACTIVE" | "ARCHIVED";
}): BatchView {
  return {
    id: b.id,
    programId: b.programId,
    name: b.name,
    intakeYear: b.intakeYear,
    status: b.status,
  };
}

export function toSemesterView(s: {
  id: string;
  programId: string;
  batchId: string;
  number: number;
  startDate: Date | null;
  endDate: Date | null;
  status: SemesterView["status"];
}): SemesterView {
  return {
    id: s.id,
    programId: s.programId,
    batchId: s.batchId,
    number: s.number,
    startDate: toDateOnly(s.startDate),
    endDate: toDateOnly(s.endDate),
    status: s.status,
  };
}

export function toSectionView(s: {
  id: string;
  programId: string;
  batchId: string;
  semesterId: string;
  name: string;
}): SectionView {
  return {
    id: s.id,
    programId: s.programId,
    batchId: s.batchId,
    semesterId: s.semesterId,
    name: s.name,
  };
}

export function toSubjectView(s: {
  id: string;
  programId: string;
  batchId: string;
  semesterId: string;
  name: string;
  code: string;
  credits: number | null;
  status: "ACTIVE" | "ARCHIVED";
}): SubjectView {
  return {
    id: s.id,
    programId: s.programId,
    batchId: s.batchId,
    semesterId: s.semesterId,
    name: s.name,
    code: s.code,
    credits: s.credits,
    status: s.status,
  };
}
