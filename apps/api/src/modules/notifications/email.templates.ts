import { env } from "../../config/env.js";

/**
 * Fixed email templates. User-supplied text (names, college names) is escaped and never inserted
 * as raw HTML; subjects are single-line. Links always point at the configured web origin.
 */
export type EmailTemplate =
  | { template: "password_reset"; params: { token: string } }
  | {
      template: "invitation";
      params: { token: string; collegeName: string; roleLabel: string };
    }
  | {
      template: "approval_reminder";
      params: { collegeName: string; subjectName: string; pendingCount: number };
    }
  | {
      template: "approval_escalation";
      params: { collegeName: string; subjectName: string; sectionName: string; hours: number };
    }
  | {
      template: "entry_published_notice";
      params: { collegeName: string; subjectName: string; taughtOn: string };
    };

export type TemplateName = EmailTemplate["template"];

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** One line, no control characters: safe in a subject header. */
function oneLine(value: string): string {
  return value
    .replace(/[\p{Cc}]+/gu, " ")
    .trim()
    .slice(0, 150);
}

function link(path: string, token?: string): string {
  const url = new URL(path, env.WEB_ORIGIN);
  // The token goes in the fragment, so it never reaches server logs or Referer headers.
  if (token) url.hash = `token=${token}`;
  return url.toString();
}

function layout(paragraphs: string[], action?: { label: string; href: string }): string {
  const body = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
  const button = action
    ? `<p><a href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a></p>`
    : "";
  return `<!doctype html><html><body style="font-family:sans-serif;line-height:1.5">${body}${button}<p style="color:#666;font-size:12px">Semwise</p></body></html>`;
}

export function render(email: EmailTemplate): { subject: string; text: string; html: string } {
  switch (email.template) {
    case "password_reset": {
      const href = link("/reset-password", email.params.token);
      const lines = [
        "Someone asked to reset the password for your Semwise account.",
        "If it was you, open the link below within 60 minutes. If not, ignore this email.",
      ];
      return {
        subject: "Reset your Semwise password",
        text: `${lines.join("\n\n")}\n\n${href}`,
        html: layout(lines, { label: "Set a new password", href }),
      };
    }
    case "invitation": {
      const { collegeName, roleLabel, token } = email.params;
      const href = link("/accept-invite", token);
      const lines = [
        `You have been invited to ${collegeName} on Semwise as ${roleLabel}.`,
        "Open the link below to set your password. The link works once and expires in 7 days.",
      ];
      return {
        subject: oneLine(`Your invitation to ${collegeName} on Semwise`),
        text: `${lines.join("\n\n")}\n\n${href}`,
        html: layout(lines, { label: "Accept the invitation", href }),
      };
    }
    case "approval_reminder": {
      const { collegeName, subjectName, pendingCount } = email.params;
      const href = link("/approvals");
      const lines = [
        `${pendingCount} class ${pendingCount === 1 ? "entry is" : "entries are"} waiting for your approval in ${subjectName} (${collegeName}).`,
        "Students cannot see them until you approve.",
      ];
      return {
        subject: oneLine(`Entries waiting for approval: ${subjectName}`),
        text: `${lines.join("\n\n")}\n\n${href}`,
        html: layout(lines, { label: "Open approvals", href }),
      };
    }
    case "approval_escalation": {
      const { collegeName, subjectName, sectionName, hours } = email.params;
      const href = link("/admin/approvals");
      const lines = [
        `A class entry for ${subjectName}, section ${sectionName} (${collegeName}) has waited more than ${hours} hours for the subject teacher.`,
        "As Program Admin you can approve, edit or reject it.",
      ];
      return {
        subject: oneLine(`Escalated: entry waiting in ${subjectName}`),
        text: `${lines.join("\n\n")}\n\n${href}`,
        html: layout(lines, { label: "Review the entry", href }),
      };
    }
    case "entry_published_notice": {
      const { collegeName, subjectName, taughtOn } = email.params;
      const href = link("/approvals");
      const lines = [
        `An entry for ${subjectName} (${taughtOn}) in ${collegeName} was published automatically.`,
        "You can review, edit or take it down at any time.",
      ];
      return {
        subject: oneLine(`Published: ${subjectName} on ${taughtOn}`),
        text: `${lines.join("\n\n")}\n\n${href}`,
        html: layout(lines, { label: "Review", href }),
      };
    }
  }
}
