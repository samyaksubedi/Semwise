import type {
  ApprovalSettingsView,
  ClassApprovalView,
  ProgramApprovalInput,
} from "@semwise/shared";
import { transaction, type TenantScope } from "../../common/db/scope.js";
import { AppError } from "../../common/errors/app-error.js";
import { env } from "../../config/env.js";
import { QueueName, cancelJob, enqueue } from "../../lib/queue.js";
import { auditService } from "../audit/index.js";
import { Action, can, type Actor } from "../authz/index.js";
import { classResource, classesService } from "../classes/index.js";
import { structureService } from "../structure/index.js";
import { approvalsRepository as repo } from "./approvals.repository.js";

export const REMINDER_JOB = "entry-reminder";
export const ESCALATE_JOB = "entry-escalate";
export const UNREVIEWED_JOB = "entry-unreviewed-publish";

const HOUR = 3600_000;
const DAY = 24 * HOUR;

const scopeOf = (actor: Actor): TenantScope => ({ tenantId: actor.tenantId! });

export interface ResolvedApproval {
  autoApprove: boolean;
  locked: boolean;
  /** Days after which a pending entry is published as "not reviewed by teacher"; null = never. */
  unreviewedPublishAfterDays: number | null;
}

/** Without any setting, entries wait for the teacher (the safe default). */
const NO_SETTING: ResolvedApproval = {
  autoApprove: false,
  locked: false,
  unreviewedPublishAfterDays: null,
};

const jobIds = (versionId: string) => ({
  reminders: env.APPROVAL_REMINDER_HOURS.map((_, i) => `entry-${versionId}-reminder-${i + 1}`),
  escalate: `entry-${versionId}-escalate`,
  unreviewed: `entry-${versionId}-unreviewed`,
});

export const approvalsService = {
  /**
   * The rule for a class: the teacher's override wins, unless the Program Admin locked the
   * program default.
   */
  async resolve(scope: TenantScope, programId: string, classId: string): Promise<ResolvedApproval> {
    const [program, override] = await Promise.all([
      repo.findProgramDefault(scope, programId),
      repo.findClassOverride(scope, classId),
    ]);
    const base: ResolvedApproval = program
      ? {
          autoApprove: program.autoApprove,
          locked: program.locked,
          unreviewedPublishAfterDays: program.unreviewedPublishAfterDays,
        }
      : NO_SETTING;
    if (override && !base.locked) return { ...base, autoApprove: override.autoApprove };
    return base;
  },

  // ---------- Program default (Program Admin, University Admin) ----------

  async getProgram(actor: Actor, programId: string): Promise<ApprovalSettingsView> {
    const scope = scopeOf(actor);
    const program = await structureService.findProgram(scope, programId);
    if (!program || !can(actor, Action.APPROVAL_SET_DEFAULT, { ...scope, programId })) {
      throw AppError.notFound("Program not found");
    }
    const setting = await repo.findProgramDefault(scope, programId);
    return {
      programId,
      autoApprove: setting?.autoApprove ?? NO_SETTING.autoApprove,
      locked: setting?.locked ?? false,
      unreviewedPublishAfterDays: setting?.unreviewedPublishAfterDays ?? null,
    };
  },

  async setProgram(actor: Actor, programId: string, input: ProgramApprovalInput) {
    const scope = scopeOf(actor);
    const before = await this.getProgram(actor, programId);
    await transaction(scope, async () => {
      await repo.upsertProgramDefault(scope, programId, { ...input, updatedById: actor.userId });
      await auditService.record({
        tenantId: scope.tenantId,
        programId,
        actorId: actor.userId,
        action: "approval.default.set",
        entityType: "Program",
        entityId: programId,
        before,
        after: input,
      });
    });
    return this.getProgram(actor, programId);
  },

  // ---------- Class override (subject teacher, Program Admin) ----------

  async getClass(actor: Actor, classId: string): Promise<ClassApprovalView> {
    const scope = scopeOf(actor);
    const klass = await classesService.find(scope, classId);
    if (!klass || !can(actor, Action.STRUCTURE_READ, classResource(klass))) {
      throw AppError.notFound("Class not found");
    }
    const [resolved, override] = await Promise.all([
      this.resolve(scope, klass.programId, klass.id),
      repo.findClassOverride(scope, klass.id),
    ]);
    return {
      classId,
      autoApprove: resolved.autoApprove,
      override: override?.autoApprove ?? null,
      locked: resolved.locked,
    };
  },

  async setClass(actor: Actor, classId: string, autoApprove: boolean | null) {
    const scope = scopeOf(actor);
    const klass = await classesService.find(scope, classId);
    if (!klass || !can(actor, Action.STRUCTURE_READ, classResource(klass))) {
      throw AppError.notFound("Class not found");
    }
    const program = await repo.findProgramDefault(scope, klass.programId);
    const locked = program?.locked ?? false;
    // Who may override at all comes first; the lock only matters to them.
    if (!can(actor, Action.APPROVAL_OVERRIDE_CLASS, { ...classResource(klass), locked: false })) {
      throw AppError.forbidden();
    }
    if (!can(actor, Action.APPROVAL_OVERRIDE_CLASS, { ...classResource(klass), locked })) {
      throw AppError.invalidState("The Program Admin has locked auto-approval for this program");
    }
    const before = await this.getClass(actor, classId);
    await transaction(scope, async () => {
      if (autoApprove === null) await repo.deleteClassOverride(scope, classId);
      else {
        await repo.upsertClassOverride(scope, klass.programId, classId, {
          autoApprove,
          updatedById: actor.userId,
        });
      }
      await auditService.record({
        tenantId: scope.tenantId,
        programId: klass.programId,
        actorId: actor.userId,
        action: "approval.class.set",
        entityType: "Class",
        entityId: classId,
        before: { override: before.override },
        after: { override: autoApprove },
      });
    });
    return this.getClass(actor, classId);
  },

  // ---------- Reminders ----------

  /** Schedules the 24 h and 48 h reminders, the escalation and (if enabled) unreviewed publishing. */
  async schedule(scope: TenantScope, versionId: string, resolved: ResolvedApproval) {
    const ids = jobIds(versionId);
    const data = { tenantId: scope.tenantId, versionId };
    for (const [i, hours] of env.APPROVAL_REMINDER_HOURS.entries()) {
      await enqueue(
        QueueName.workflow,
        REMINDER_JOB,
        { ...data, n: i + 1 },
        {
          jobId: ids.reminders[i]!,
          delayMs: hours * HOUR,
        },
      );
    }
    await enqueue(QueueName.workflow, ESCALATE_JOB, data, {
      jobId: ids.escalate,
      delayMs: env.APPROVAL_ESCALATE_HOURS * HOUR,
    });
    if (resolved.unreviewedPublishAfterDays) {
      await enqueue(QueueName.workflow, UNREVIEWED_JOB, data, {
        jobId: ids.unreviewed,
        delayMs: resolved.unreviewedPublishAfterDays * DAY,
      });
    }
  },

  /** The teacher acted (or the author withdrew): the pending reminders are no longer needed. */
  async cancel(versionId: string) {
    const ids = jobIds(versionId);
    for (const id of [...ids.reminders, ids.escalate, ids.unreviewed]) {
      await cancelJob(QueueName.workflow, id);
    }
  },
};
