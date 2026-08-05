/**
 * Split Inbox & Triage Engine — auto-categorizes emails into priority splits
 * with revenue-weighted ordering, similar to Superhuman's Split Inbox but
 * enhanced with telemetry-based revenue scoring.
 */

import { EmailMessage, ProcessedEmailRecord } from "@/types";

export type SplitCategory =
  | "vip"
  | "team"
  | "financial"
  | "research"
  | "action_required"
  | "tools"
  | "newsletter"
  | "general";

export interface SplitInboxColumn {
  category: SplitCategory;
  label: string;
  icon: string;
  color: string;
  emails: TriagedEmail[];
  totalValue: number;
  unreadCount: number;
}

export interface TriagedEmail {
  email: EmailMessage;
  category: SplitCategory;
  revenueScore: number;
  priority: "high" | "medium" | "low";
  isUnread: boolean;
  hasAttachments: boolean;
  threadId?: string;
  suggestedAction?: string;
  estimatedValue: number;
}

// VIP senders — configurable per user. For Dr. Gilead's mailbox.
const VIP_SENDERS = [
  "cfo", "ceo", "cto", "director", "chief", "head", "vp ", "president",
  "gilead", "board", "investor", "partner",
];

const TEAM_DOMAINS = [
  "gilead.com", "internal", "staff",
];

const TOOL_SENDERS = [
  "docs.google.com", "notion.so", "asana.com", "slack.com",
  "github.com", "jira", "linear.app", "figma.com",
  "calendar.google.com", "noreply", "no-reply",
];

const NEWSLETTER_KEYWORDS = [
  "newsletter", "digest", "weekly", "monthly", "unsubscribe",
  "update", "roundup", "summary",
];

const ACTION_REQUIRED_KEYWORDS = [
  "action required", "urgent", "asap", "deadline", "due by",
  "please review", "approval needed", "needs your attention",
  "response required", "time sensitive",
];

const FINANCIAL_KEYWORDS = [
  "invoice", "billing", "payment", "budget", "financial",
  "expense", "revenue", "forecast", "quarterly", "audit",
];

const RESEARCH_KEYWORDS = [
  "research", "study", "clinical", "trial", "data",
  "analysis", "report", "findings", "lab", "experiment",
  "protocol", "specimen", "assay",
];

const CATEGORY_CONFIG: Record<SplitCategory, { label: string; icon: string; color: string }> = {
  vip: { label: "VIP", icon: "⭐", color: "#f59e0b" },
  team: { label: "Team", icon: "👥", color: "#3b82f6" },
  financial: { label: "Financial", icon: "💰", color: "#10b981" },
  research: { label: "Research", icon: "🔬", color: "#8b5cf6" },
  action_required: { label: "Action Required", icon: "🚨", color: "#ef4444" },
  tools: { label: "Tools & Notifications", icon: "🔧", color: "#6b7280" },
  newsletter: { label: "Newsletters", icon: "📰", color: "#9ca3af" },
  general: { label: "Other", icon: "📧", color: "#d1d5db" },
};

const REVENUE_BY_CATEGORY: Record<SplitCategory, number> = {
  vip: 800,
  financial: 850,
  research: 1200,
  action_required: 600,
  team: 300,
  tools: 50,
  newsletter: 20,
  general: 150,
};

export function triageEmails(emails: EmailMessage[]): SplitInboxColumn[] {
  try {
    const triaged = emails.map(triageEmail);

    const columns: Record<SplitCategory, TriagedEmail[]> = {
      vip: [], team: [], financial: [], research: [],
      action_required: [], tools: [], newsletter: [], general: [],
    };

    for (const t of triaged) {
      columns[t.category].push(t);
    }

    for (const cat of Object.keys(columns) as SplitCategory[]) {
      columns[cat].sort((a, b) => {
        if (a.isUnread !== b.isUnread) return a.isUnread ? -1 : 1;
        return b.revenueScore - a.revenueScore;
      });
    }

    return (Object.keys(columns) as SplitCategory[])
      .map((category) => {
        const items = columns[category];
        const config = CATEGORY_CONFIG[category];
        return {
          category,
          label: config.label,
          icon: config.icon,
          color: config.color,
          emails: items,
          totalValue: items.reduce((s, e) => s + e.estimatedValue, 0),
          unreadCount: items.filter((e) => e.isUnread).length,
        };
      })
      .filter((col) => col.emails.length > 0)
      .sort((a, b) => b.totalValue - a.totalValue);
  } catch (e) {
    console.error("[telemetry/triage] triageEmails error:", e);
    return [];
  }
}

function triageEmail(email: EmailMessage): TriagedEmail {
  const senderLower = (email.sender + " " + email.senderEmail).toLowerCase();
  const subjectLower = email.subject.toLowerCase();
  const bodyLower = (email.body || "").toLowerCase().substring(0, 500);

  let category: SplitCategory = "general";

  // Check in priority order
  if (VIP_SENDERS.some((v) => senderLower.includes(v))) {
    category = "vip";
  } else if (TOOL_SENDERS.some((t) => senderLower.includes(t))) {
    category = "tools";
  } else if (ACTION_REQUIRED_KEYWORDS.some((k) => subjectLower.includes(k) || bodyLower.includes(k))) {
    category = "action_required";
  } else if (FINANCIAL_KEYWORDS.some((k) => subjectLower.includes(k))) {
    category = "financial";
  } else if (RESEARCH_KEYWORDS.some((k) => subjectLower.includes(k))) {
    category = "research";
  } else if (TEAM_DOMAINS.some((d) => senderLower.includes(d))) {
    category = "team";
  } else if (NEWSLETTER_KEYWORDS.some((k) => subjectLower.includes(k) || bodyLower.includes(k))) {
    category = "newsletter";
  }

  // Calculate revenue score
  const baseRevenue = REVENUE_BY_CATEGORY[category];
  const attachmentBonus = email.hasAttachments ? 100 : 0;
  const unreadBonus = !email.isRead ? 50 : 0;
  const revenueScore = baseRevenue + attachmentBonus + unreadBonus;

  // Determine priority
  const priority: "high" | "medium" | "low" =
    revenueScore >= 800 ? "high" : revenueScore >= 300 ? "medium" : "low";

  // Suggested action
  const suggestedAction = suggestAction(category, email);

  return {
    email,
    category,
    revenueScore,
    priority,
    isUnread: !email.isRead,
    hasAttachments: email.hasAttachments,
    threadId: email.threadId,
    suggestedAction,
    estimatedValue: Math.round(revenueScore * (email.isRead ? 0.7 : 1.0)),
  };
}

function suggestAction(category: SplitCategory, email: EmailMessage): string {
  switch (category) {
    case "vip":
      return `Reply promptly to ${email.sender} — high-value contact`;
    case "financial":
      return "Review financial details and route to accounting if needed";
    case "research":
      return "Extract research data and catalog findings for analysis";
    case "action_required":
      return "Address immediately — deadline or approval needed";
    case "team":
      return "Review and coordinate with team members";
    case "tools":
      return "Check notification — likely automated, archive if not actionable";
    case "newsletter":
      return "Skim for relevant updates, then archive";
    default:
      return "Review and decide: reply, archive, or snooze";
  }
}

/**
 * Generate follow-up suggestions for unreplied high-value emails.
 */
export interface FollowUpSuggestion {
  email: EmailMessage;
  daysSinceReceived: number;
  estimatedValue: number;
  suggestedFollowUp: string;
  urgency: "overdue" | "soon" | "normal";
}

export function generateFollowUps(emails: EmailMessage[]): FollowUpSuggestion[] {
  try {
    const now = Date.now();
    const suggestions: FollowUpSuggestion[] = [];

    for (const email of emails) {
      if (email.isRead) continue;

      const dateStr = email.receivedDate;
      let receivedTime: number;
      try {
        receivedTime = new Date(dateStr).getTime();
      } catch {
        continue;
      }

      if (isNaN(receivedTime)) continue;

      const daysSince = Math.floor((now - receivedTime) / (1000 * 60 * 60 * 24));
      if (daysSince < 1) continue;

      const triaged = triageEmail(email);
      if (triaged.estimatedValue < 200) continue;

      const urgency: "overdue" | "soon" | "normal" =
        daysSince > 7 ? "overdue" : daysSince > 3 ? "soon" : "normal";

      suggestions.push({
        email,
        daysSinceReceived: daysSince,
        estimatedValue: triaged.estimatedValue,
        suggestedFollowUp: `Follow up with ${email.sender} re: "${email.subject}" — ${daysSince} days since received`,
        urgency,
      });
    }

    return suggestions.sort((a, b) => {
      const urgencyOrder = { overdue: 0, soon: 1, normal: 2 };
      if (a.urgency !== b.urgency) return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
      return b.estimatedValue - a.estimatedValue;
    });
  } catch (e) {
    console.error("[telemetry/triage] generateFollowUps error:", e);
    return [];
  }
}
