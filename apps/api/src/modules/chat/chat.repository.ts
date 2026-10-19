import { withTenant, type TenantScope } from "../../common/db/scope.js";
import type { MessageRole } from "../../generated/prisma/enums.js";

/**
 * Private student data. Every query names the owner as well as the tenant, so a conversation is
 * only ever loaded for the student it belongs to.
 */
export const chatRepository = {
  createConversation(
    scope: TenantScope,
    data: { userId: string; title: string; pinnedSubjectId: string | null; includePast: boolean },
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.conversation.create({ data: { ...data, tenantId: scope.tenantId } }),
    );
  },

  findConversation(scope: TenantScope, userId: string, id: string) {
    return withTenant(scope.tenantId, (db) =>
      db.conversation.findFirst({ where: { id, userId, tenantId: scope.tenantId } }),
    );
  },

  listConversations(scope: TenantScope, userId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.conversation.findMany({
        where: { userId, tenantId: scope.tenantId },
        orderBy: { updatedAt: "desc" },
        take: 100,
      }),
    );
  },

  updateConversation(
    scope: TenantScope,
    id: string,
    data: Partial<{
      title: string;
      pinnedSubjectId: string | null;
      includePast: boolean;
      summary: string | null;
      summarizedCount: number;
    }>,
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.conversation.update({ where: { id, tenantId: scope.tenantId }, data }),
    );
  },

  deleteConversation(scope: TenantScope, userId: string, id: string) {
    return withTenant(scope.tenantId, (db) =>
      db.conversation.deleteMany({ where: { id, userId, tenantId: scope.tenantId } }),
    );
  },

  listMessages(scope: TenantScope, conversationId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.message.findMany({
        where: { conversationId, tenantId: scope.tenantId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    );
  },

  createMessage(
    scope: TenantScope,
    data: {
      conversationId: string;
      role: MessageRole;
      content: string;
      scope?: string | null;
      language?: string | null;
      citations?: object;
      labels?: object;
      model?: string | null;
      requestId?: string | null;
    },
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.message.create({ data: { ...data, tenantId: scope.tenantId } }),
    );
  },

  touch(scope: TenantScope, id: string) {
    return withTenant(scope.tenantId, (db) =>
      db.conversation.update({
        where: { id, tenantId: scope.tenantId },
        data: { updatedAt: new Date() },
      }),
    );
  },
};
