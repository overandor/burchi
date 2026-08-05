import { RoleTwin, RoleType } from "@/types";

/**
 * Role Execution Twins — each role has its own job description, authority limits,
 * permitted systems, and prohibited actions. The commitment engine uses these
 * to determine what work can be executed autonomously vs. requires approval.
 */

export const ROLE_TWINS: Record<RoleType, RoleTwin> = {
  field_representative: {
    role: "field_representative",
    title: "Field Representative",
    jobDescription:
      "Engage healthcare professionals in assigned territory. Deliver approved scientific and commercial information. Identify and resolve access barriers. Maintain CRM records. Execute territory coverage plan.",
    territoryScope: "Assigned territory accounts",
    reportingStructure: "Reports to Regional Sales Manager",
    permittedSystems: ["CRM_READ", "CRM_WRITE_DRAFT", "MAIL_READ", "CALENDAR_READ", "CONTENT_LIBRARY_READ", "TERRITORY_DATA_READ"],
    approvedActions: [
      "Generate pre-call briefs",
      "Produce doctor-account summaries",
      "Calculate route plans",
      "Draft follow-up emails",
      "Draft CRM updates",
      "Generate territory reviews",
      "Prepare approved-material packets",
      "Create office-access plans",
    ],
    prohibitedActions: [
      "Invent medical claims",
      "Make commitments outside representative authority",
      "Send promotional content without approval",
      "Contact HCPs on do-not-contact list",
      "Modify approved content",
    ],
    recurringDeliverables: [
      "Daily territory brief",
      "Pre-call preparation packets",
      "Post-call CRM updates",
      "Weekly territory review",
      "Outstanding commitment report",
    ],
    authorityLimits: {
      canSendExternalEmail: false,
      canModifyCRM: true,
      canScheduleExternalMeeting: false,
      canContactHCP: true,
      canApproveContent: false,
    },
    domainVocabulary: ["HCP", "account", "territory", "formulary", "access", "barrier", "approved content", "indication", "prescribing"],
    overdeliveryStandard: "Include route recommendation and next 3 actions with every account summary",
  },

  regional_manager: {
    role: "regional_manager",
    title: "Regional Sales Manager",
    jobDescription:
      "Oversee field representative team performance. Allocate territory coverage. Identify coaching opportunities. Report forecast risk. Approve escalated actions. Ensure compliance with promotional guidelines.",
    territoryScope: "Multi-territory region",
    reportingStructure: "Reports to National Sales Director",
    permittedSystems: ["CRM_READ", "CRM_WRITE", "MAIL_READ", "CALENDAR_READ", "CONTENT_LIBRARY_READ", "TERRITORY_DATA_READ", "TEAM_ANALYTICS_READ"],
    approvedActions: [
      "Produce team territory comparisons",
      "Analyze stalled accounts",
      "Identify coaching opportunities",
      "Generate coverage gap analysis",
      "Create forecast-risk reports",
      "Reallocate workload",
      "Summarize overdue commitments",
      "Prepare manager presentations",
    ],
    prohibitedActions: [
      "Make clinical or scientific claims",
      "Approve off-label content",
      "Override compliance rulings",
      "Access individual representative private communications",
    ],
    recurringDeliverables: [
      "Weekly team performance review",
      "Monthly forecast report",
      "Stalled account analysis",
      "Coaching plan recommendations",
    ],
    authorityLimits: {
      canSendExternalEmail: true,
      canModifyCRM: true,
      canScheduleExternalMeeting: true,
      canContactHCP: false,
      canApproveContent: false,
      financialApprovalLimit: 5000,
    },
    domainVocabulary: ["coverage", "forecast", "quota", "pipeline", "coaching", "reallocation", "stalled", "gap analysis"],
    overdeliveryStandard: "Include recommended interventions and expected impact for every stalled account",
  },

  medical_affairs: {
    role: "medical_affairs",
    title: "Medical Affairs Specialist",
    jobDescription:
      "Provide scientifically accurate information to healthcare professionals. Respond to unsolicited medical information requests. Summarize evidence. Support congress intelligence. Maintain citation integrity.",
    territoryScope: "Therapeutic area",
    reportingStructure: "Reports to Medical Director",
    permittedSystems: ["LITERATURE_DB_READ", "MED_INFO_READ", "MAIL_READ", "CONTENT_LIBRARY_READ", "CITATION_DB_READ"],
    approvedActions: [
      "Produce source-grounded evidence summaries",
      "Conduct literature reviews",
      "Prepare medical-information responses",
      "Perform evidence-gap analysis",
      "Generate congress intelligence",
      "Assemble citation packs",
    ],
    prohibitedActions: [
      "Make promotional claims",
      "Distribute content not reviewed by medical/legal/regulatory",
      "Provide information outside approved labeling",
      "Engage in sales activities",
    ],
    recurringDeliverables: [
      "Medical information response drafts",
      "Literature review summaries",
      "Evidence gap reports",
      "Congress intelligence briefs",
    ],
    authorityLimits: {
      canSendExternalEmail: true,
      canModifyCRM: false,
      canScheduleExternalMeeting: true,
      canContactHCP: true,
      canApproveContent: true,
    },
    domainVocabulary: ["evidence", "literature", "citation", "unsolicited request", "on-label", "off-label", "MLR review", "investigator-initiated"],
    overdeliveryStandard: "Include citation pack and evidence-quality assessment with every summary",
  },

  market_access: {
    role: "market_access",
    title: "Market Access Manager",
    jobDescription:
      "Monitor formulary status. Track payer restrictions. Identify reimbursement barriers. Prepare access documentation. Escalate access discrepancies. Support account access conditions.",
    territoryScope: "Regional payer landscape",
    reportingStructure: "Reports to Head of Market Access",
    permittedSystems: ["PAYER_DB_READ", "FORMULARY_READ", "CRM_READ", "MAIL_READ", "CONTENT_LIBRARY_READ"],
    approvedActions: [
      "Track formulary changes",
      "Identify payer restrictions",
      "Document reimbursement barriers",
      "Prepare access escalation packets",
      "Generate account access condition reports",
      "Create documentation requirement guides",
    ],
    prohibitedActions: [
      "Negotiate pricing without authorization",
      "Make commitments to payers",
      "Share confidential pricing with field team",
      "Override formulary decisions",
    ],
    recurringDeliverables: [
      "Monthly formulary status report",
      "Reimbursement barrier analysis",
      "Access escalation packets",
      "Payer change notifications",
    ],
    authorityLimits: {
      canSendExternalEmail: true,
      canModifyCRM: true,
      canScheduleExternalMeeting: true,
      canContactHCP: false,
      canApproveContent: false,
      financialApprovalLimit: 0,
    },
    domainVocabulary: ["formulary", "payer", "reimbursement", "prior authorization", "step therapy", "access", "co-pay", "tier", "PA", "ST"],
    overdeliveryStandard: "Include payer-specific documentation checklist with every barrier analysis",
  },

  compliance: {
    role: "compliance",
    title: "Compliance Officer",
    jobDescription:
      "Evaluate whether requests are permitted. Verify approved sources support outputs. Determine if personal or regulated data is exposed. Require human approval where needed. Preserve regulated records.",
    territoryScope: "Organization-wide",
    reportingStructure: "Reports to Chief Compliance Officer",
    permittedSystems: ["ALL_SYSTEMS_READ", "AUDIT_LOG_READ", "POLICY_DB_READ", "CONTENT_LIBRARY_READ", "MLR_REVIEW_SYSTEM"],
    approvedActions: [
      "Evaluate request permissibility",
      "Verify source grounding for outputs",
      "Check for regulated data exposure",
      "Require human approval gates",
      "Preserve communication as regulated records",
      "Block prohibited actions",
      "Document compliance decisions",
    ],
    prohibitedActions: [
      "Modify approved content",
      "Override legal determinations",
      "Delete audit records",
      "Approve promotional claims without MLR review",
    ],
    recurringDeliverables: [
      "Compliance audit reports",
      "Risk assessment summaries",
      "Policy violation alerts",
      "MLR review queue status",
    ],
    authorityLimits: {
      canSendExternalEmail: true,
      canModifyCRM: false,
      canScheduleExternalMeeting: false,
      canContactHCP: false,
      canApproveContent: true,
    },
    domainVocabulary: ["OPDP", "MLR", "promotional claim", "off-label", "substantial evidence", "fair balance", "regulated record", "21 CFR", "Sunshine Act"],
    overdeliveryStandard: "Include regulatory citation and risk rating with every compliance determination",
  },
};

export function getRoleTwin(role: RoleType): RoleTwin {
  return ROLE_TWINS[role];
}

export function getAllRoles(): RoleTwin[] {
  return Object.values(ROLE_TWINS);
}

/**
 * Determine if a role can perform an action autonomously
 */
export function canPerformAction(role: RoleType, action: string): boolean {
  const twin = ROLE_TWINS[role];
  return twin.approvedActions.some((a) => action.toLowerCase().includes(a.toLowerCase().split(" ")[0]));
}

/**
 * Check if an action is prohibited for a role
 */
export function isProhibited(role: RoleType, action: string): boolean {
  const twin = ROLE_TWINS[role];
  return twin.prohibitedActions.some((p) => action.toLowerCase().includes(p.toLowerCase().split(" ")[0]));
}
