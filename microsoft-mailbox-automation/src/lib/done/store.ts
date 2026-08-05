"use client";

import { create } from "zustand";
import {
  mockWorkItems,
  mockApprovals,
  mockTerritorySummary,
  mockPreCallBrief,
  mockSkillProposals,
  mockSkills,
  mockAuditEvents,
  mockRoleContract,
  mockManagerSummary,
  mockNotifications,
} from "./mock-data";
import type {
  WorkItem,
  ApprovalRequest,
  TerritorySummary,
  PreCallBrief,
  SkillProposal,
  Skill,
  AuditEvent,
  RoleContract,
  ManagerSummary,
  Notification,
  WorkStatus,
} from "./types";

interface DoneStore {
  workItems: WorkItem[];
  approvals: ApprovalRequest[];
  territory: TerritorySummary;
  preCallBrief: PreCallBrief;
  skillProposals: SkillProposal[];
  skills: Skill[];
  auditEvents: AuditEvent[];
  role: RoleContract;
  managerSummary: ManagerSummary;
  notifications: Notification[];
  personalityMode: boolean;

  approveRequest: (id: string) => void;
  rejectRequest: (id: string) => void;
  dismissSkillProposal: (id: string) => void;
  approveSkillProposal: (id: string) => void;
  markNotificationRead: (id: string) => void;
  togglePersonality: () => void;
  updateWorkStatus: (id: string, status: WorkStatus) => void;
}

export const useDoneStore = create<DoneStore>((set) => ({
  workItems: mockWorkItems,
  approvals: mockApprovals,
  territory: mockTerritorySummary,
  preCallBrief: mockPreCallBrief,
  skillProposals: mockSkillProposals,
  skills: mockSkills,
  auditEvents: mockAuditEvents,
  role: mockRoleContract,
  managerSummary: mockManagerSummary,
  notifications: mockNotifications,
  personalityMode: false,

  approveRequest: (id) =>
    set((state) => ({
      approvals: state.approvals.map((a) =>
        a.id === id ? { ...a, status: "approved" } : a
      ),
    })),

  rejectRequest: (id) =>
    set((state) => ({
      approvals: state.approvals.map((a) =>
        a.id === id ? { ...a, status: "rejected" } : a
      ),
    })),

  dismissSkillProposal: (id) =>
    set((state) => ({
      skillProposals: state.skillProposals.map((s) =>
        s.id === id ? { ...s, status: "dismissed" } : s
      ),
    })),

  approveSkillProposal: (id) =>
    set((state) => ({
      skillProposals: state.skillProposals.map((s) =>
        s.id === id ? { ...s, status: "approved" } : s
      ),
    })),

  markNotificationRead: (id) =>
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      ),
    })),

  togglePersonality: () =>
    set((state) => ({ personalityMode: !state.personalityMode })),

  updateWorkStatus: (id, status) =>
    set((state) => ({
      workItems: state.workItems.map((w) =>
        w.id === id ? { ...w, status } : w
      ),
    })),
}));
