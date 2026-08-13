"""RxReserve + MailOS — Gradio Dashboard.

A real web UI for the pharmaceutical communication execution layer.

Tabs:
  1. Inbox — ingested emails with LLM extraction
  2. Obligations — lifecycle management (assign → execute → verify)
  3. HCP Intelligence — engagement diagnosis + intents
  4. Response Debt — enterprise-wide unresolved obligations
  5. Analytics — summary metrics
"""

from __future__ import annotations

import json
import os
import requests
from datetime import datetime, timezone
from typing import Optional

import gradio as gr

API_BASE = os.environ.get("RXRESERVE_API", "http://127.0.0.1:8000")


def _api(method: str, path: str, **kwargs) -> dict | list | None:
    try:
        r = requests.request(method, f"{API_BASE}{path}", timeout=120, **kwargs)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        return {"error": str(e)}


# ─── Inbox tab ───

def ingest_email(from_addr, from_name, from_type, to_list, subject, body, hcp_id, emp_id, use_llm):
    to = [t.strip() for t in (to_list or "").split(",") if t.strip()]
    payload = {
        "from_address": from_addr,
        "from_name": from_name,
        "from_type": from_type,
        "to": to,
        "subject": subject,
        "body": body,
        "hcp_id": hcp_id or "",
        "employee_id": emp_id or "",
        "use_llm": use_llm,
    }
    result = _api("POST", "/api/mailos/ingest", json=payload)
    if not result or "error" in (result or {}):
        return f"Error: {result}", _refresh_mails(), _refresh_summary()

    objects = result.get("objects", [])
    obls = result.get("obligations", [])
    intent = result.get("intent")
    method = result.get("extraction_method", "regex")

    out = f"### Email Ingested ({method.upper()} extraction)\n\n"
    out += f"**Mail ID:** `{result.get('mail_id', '')[:8]}...`\n\n"

    if objects:
        out += "**Decomposed Objects:**\n\n"
        for o in objects:
            out += f"- **{o.get('object_type', '?')}** ({o.get('priority', '?')}) → {o.get('target_system', '?')}\n"
            out += f"  - {o.get('summary', '')}\n"
            if o.get('topic'):
                out += f"  - Topic: {o['topic']}\n"
            out += f"  - Confidence: {o.get('routing_confidence', 0)}\n"
        out += "\n"

    if obls:
        out += "**Obligations Compiled:**\n\n"
        for o in obls:
            out += f"- **{o.get('obligation_type', '?')}** — {o.get('description', '')[:60]}\n"
            out += f"  - Deadline: {o.get('deadline_hours', '?')}h ({'regulatory' if o.get('is_regulatory_deadline') else 'internal'})\n"
            out += f"  - Status: `{o.get('status', '?')}`\n"
            out += f"  - ID: `{o.get('obligation_id', '')[:8]}...`\n"
        out += "\n"

    if intent:
        out += "**HCP Intent:**\n\n"
        out += f"- Type: **{intent.get('intent_type', '?')}**\n"
        out += f"- Summary: {intent.get('summary', '')}\n"
        out += f"- Impact: {intent.get('relationship_impact', '?')}\n"
        out += f"- Next best action: {intent.get('next_best_action', '')}\n"
        if intent.get('negative_action'):
            out += f"- ⚠️ Negative action: **{intent['negative_action']}**\n"
        out += "\n"

    comms = result.get("commitments", [])
    if comms:
        out += "**Commitments Extracted:**\n\n"
        for c in comms:
            out += f"- {c.get('requested_action', '')} (deadline: {c.get('deadline', 'none')})\n"

    return out, _refresh_mails(), _refresh_summary()


def _refresh_mails():
    mails = _api("GET", "/api/mailos/mails")
    if not mails or isinstance(mails, dict):
        return []
    rows = []
    for m in mails:
        rows.append([
            m.get("from_name", "")[:20],
            m.get("from_type", "")[:6],
            m.get("subject", "")[:40],
            m.get("matched_hcp_id", "")[:8],
            "✓" if m.get("decomposed") else "",
        ])
    return rows


def _refresh_summary():
    s = _api("GET", "/api/mailos/summary")
    if not s or isinstance(s, dict) and "error" in s:
        return {}
    return s


# ─── Obligations tab ───

def _refresh_obligations(status_filter=""):
    params = {}
    if status_filter:
        params["status"] = status_filter
    obls = _api("GET", "/api/mailos/obligations", params=params)
    if not obls or isinstance(obls, dict) and "error" in (obls if isinstance(obls, dict) else {}):
        return []
    rows = []
    for o in obls:
        rows.append([
            o.get("obligation_id", "")[:12],
            o.get("obligation_type", ""),
            o.get("description", "")[:50],
            o.get("status", ""),
            o.get("priority", "") if o.get("priority") else "",
            o.get("deadline_hours", ""),
            "Yes" if o.get("is_regulatory_deadline") else "No",
            o.get("target_system", ""),
            o.get("assigned_owner", "")[:15],
        ])
    return rows


def assign_obligation(obl_id, owner, team):
    if not obl_id or not owner:
        return "Enter obligation ID and owner.", _refresh_obligations()
    full_id = _resolve_obligation_id(obl_id)
    r = _api("POST", f"/api/mailos/obligations/{full_id}/assign", json={"owner": owner, "team": team})
    if r and "error" not in r:
        return f"✅ Assigned to {owner}", _refresh_obligations()
    return f"❌ Error: {r}", _refresh_obligations()


def execute_obligation(obl_id, evidence):
    if not obl_id or not evidence:
        return "Enter obligation ID and evidence.", _refresh_obligations()
    full_id = _resolve_obligation_id(obl_id)
    r = _api("POST", f"/api/mailos/obligations/{full_id}/execute", json={"evidence": evidence})
    if r and "error" not in r:
        return f"✅ Executed with evidence", _refresh_obligations()
    return f"❌ Error: {r}", _refresh_obligations()


def verify_obligation(obl_id, verifier, signal, signal_source):
    if not obl_id or not verifier:
        return "Enter obligation ID and verifier.", _refresh_obligations()
    full_id = _resolve_obligation_id(obl_id)
    r = _api("POST", f"/api/mailos/obligations/{full_id}/verify", json={
        "verifier": verifier, "signal": signal, "signal_source": signal_source})
    if r and "error" not in r:
        return f"✅ Verified by {verifier}", _refresh_obligations()
    return f"❌ Error: {r}", _refresh_obligations()


def _resolve_obligation_id(partial: str) -> str:
    """Resolve a partial ID to full UUID."""
    if len(partial) >= 36:
        return partial
    obls = _api("GET", "/api/mailos/obligations")
    if obls:
        for o in obls:
            if o.get("obligation_id", "").startswith(partial):
                return o["obligation_id"]
    return partial


# ─── HCP Intelligence tab ───

def _refresh_hcps():
    hcps = _api("GET", "/api/hcps")
    if not hcps or isinstance(hcps, dict) and "error" in (hcps if isinstance(hcps, dict) else {}):
        return []
    rows = []
    for h in hcps:
        rows.append([
            h.get("hcp_id", "")[:12],
            h.get("name", ""),
            h.get("specialty", ""),
            h.get("territory", ""),
        ])
    return rows


def diagnose_hcp(hcp_id_partial):
    if not hcp_id_partial:
        return "Enter an HCP ID."
    # Resolve partial
    hcps = _api("GET", "/api/hcps")
    full_id = hcp_id_partial
    if hcps:
        for h in hcps:
            if h.get("hcp_id", "").startswith(hcp_id_partial):
                full_id = h["hcp_id"]
                break
    diag = _api("GET", f"/api/mailos/diagnose/{full_id}")
    if not diag or isinstance(diag, dict) and "error" in diag:
        return f"Error: {diag}"

    out = f"### HCP Engagement Diagnosis\n\n"
    out += f"**HCP ID:** `{full_id[:8]}...`\n\n"
    out += f"| Metric | Value |\n|---|---|\n"
    for k, v in diag.items():
        if isinstance(v, (str, int, float, bool)):
            out += f"| {k} | {v} |\n"
    out += "\n"

    # Get intents for this HCP
    intents = _api("GET", "/api/mailos/intents")
    if intents:
        hcp_intents = [i for i in intents if i.get("hcp_id", "").startswith(hcp_id_partial)]
        if hcp_intents:
            out += "**Detected Intents:**\n\n"
            for i in hcp_intents:
                out += f"- **{i.get('intent_type', '?')}** (confidence: {i.get('confidence', 0)})\n"
                out += f"  - {i.get('summary', '')}\n"
                out += f"  - Impact: {i.get('relationship_impact', '?')}\n"
                out += f"  - Next: {i.get('next_best_action', '')}\n"
                if i.get('negative_action'):
                    out += f"  - ⚠️ {i['negative_action']}\n"

    return out


# ─── Response Debt tab ───

def _refresh_debt():
    debt = _api("GET", "/api/mailos/debt")
    if not debt or isinstance(debt, dict) and "error" in debt:
        return "No debt data.", []

    out = "### Enterprise Response Debt\n\n"
    out += f"| Metric | Value |\n|---|---|\n"
    out += f"| Total obligations | {debt.get('total_obligations', 0)} |\n"
    out += f"| Unresolved | {debt.get('unresolved', 0)} |\n"
    out += f"| Overdue | {debt.get('overdue', 0)} |\n"
    out += f"| Escalated | {debt.get('escalated', 0)} |\n"
    out += f"| Verified | {debt.get('verified', 0)} |\n"
    out += f"| Closed | {debt.get('closed', 0)} |\n\n"

    by_type = debt.get("by_type", {})
    if by_type:
        out += "**By Type:**\n\n"
        for k, v in by_type.items():
            out += f"- {k}: {v}\n"
        out += "\n"

    by_system = debt.get("by_system", {})
    if by_system:
        out += "**By System:**\n\n"
        for k, v in by_system.items():
            out += f"- {k}: {v}\n"
        out += "\n"

    top = debt.get("top_debts", [])
    rows = []
    for d in top[:10]:
        rows.append([
            d.get("obligation_id", "")[:12],
            d.get("type", ""),
            d.get("description", "")[:40],
            d.get("status", ""),
            d.get("deadline", "")[:19] if d.get("deadline") else "",
        ])

    return out, rows


# ─── Analytics tab ───

def _refresh_analytics():
    s = _api("GET", "/api/mailos/summary")
    if not s or isinstance(s, dict) and "error" in s:
        return "No data."

    out = "### MailOS Analytics\n\n"
    out += f"| Metric | Value |\n|---|---|\n"
    out += f"| Mails ingested | {s.get('mails_ingested', 0)} |\n"
    out += f"| Obligations compiled | {s.get('obligations_compiled', 0)} |\n"
    out += f"| Intents extracted | {s.get('intents_extracted', 0)} |\n"
    out += f"| Verifications | {s.get('verifications', 0)} |\n"
    out += f"| Pending | {s.get('pending', 0)} |\n"
    out += f"| Overdue | {s.get('overdue', 0)} |\n"

    # Receipts
    receipts = _api("GET", "/api/mailos/receipts")
    if receipts and isinstance(receipts, list):
        out += f"\n### Verification Receipts ({len(receipts)})\n\n"
        for r in receipts:
            out += f"- **{r.get('verified_by', '?')}** verified obligation `{r.get('obligation_id', '')[:8]}...`\n"
            out += f"  - Method: {r.get('verification_method', '')[:60]}\n"
            out += f"  - Independent signal: {r.get('independent_signal', 'none')}\n"
            out += f"  - Verified: {'✅' if r.get('is_verified') else '❌'}\n"

    return out


# ─── Build the UI ───

def build_ui():
    with gr.Blocks(title="RxReserve + MailOS", theme=gr.themes.Soft()) as ui:
        gr.Markdown("# RxReserve + MailOS — Pharmaceutical Communication Execution Layer")
        gr.Markdown("Email → Meaning → Obligation → Enterprise Action → Outcome → Evidence")

        # ─── Inbox tab ───
        with gr.Tab("📥 Inbox"):
            with gr.Row():
                with gr.Column(scale=2):
                    gr.Markdown("### Ingest Email")
                    from_addr = gr.Textbox(label="From address", placeholder="sarah.martinez@stanford.edu")
                    from_name = gr.Textbox(label="From name", placeholder="Dr. Sarah Martinez")
                    from_type = gr.Dropdown(
                        choices=["hcp", "rep", "msl", "internal", "vendor", "patient", "hco"],
                        value="hcp", label="Sender type")
                    to_list = gr.Textbox(label="To (comma-separated)", placeholder="rep@pharmaco.com")
                    subject = gr.Textbox(label="Subject", placeholder="Patient adverse event on Biktarvy")
                    body = gr.Textbox(label="Body", lines=5, placeholder="My patient experienced severe rash...")
                    with gr.Row():
                        hcp_id = gr.Textbox(label="HCP ID (optional)", placeholder="ff6a2e7b...")
                        emp_id = gr.Textbox(label="Employee ID (optional)", placeholder="E184")
                    use_llm = gr.Checkbox(label="Use LLM extraction (phi3:mini via Ollama)", value=True)
                    ingest_btn = gr.Button("Ingest & Extract", variant="primary")

                with gr.Column(scale=3):
                    extraction_out = gr.Markdown("### Extraction results will appear here")

            with gr.Row():
                mails_table = gr.Dataframe(
                    headers=["From", "Type", "Subject", "HCP ID", "Decomposed"],
                    datatype=["str", "str", "str", "str", "str"],
                    value=_refresh_mails(),
                    label="Ingested Emails",
                    interactive=False,
                )

            ingest_btn.click(
                fn=ingest_email,
                inputs=[from_addr, from_name, from_type, to_list, subject, body, hcp_id, emp_id, use_llm],
                outputs=[extraction_out, mails_table, gr.State()],
            ).then(
                fn=lambda: _refresh_summary(),
                outputs=gr.Markdown(),
            )

        # ─── Obligations tab ───
        with gr.Tab("📋 Obligations"):
            with gr.Row():
                status_filter = gr.Dropdown(
                    choices=["", "defined", "assigned", "in_progress", "executed", "verified", "overdue"],
                    value="", label="Filter by status")
                refresh_obl_btn = gr.Button("Refresh")

            obl_table = gr.Dataframe(
                headers=["ID", "Type", "Description", "Status", "Priority", "Deadline(h)", "Regulatory", "System", "Owner"],
                datatype=["str", "str", "str", "str", "str", "str", "str", "str", "str"],
                value=_refresh_obligations(),
                label="Obligations",
                interactive=False,
            )

            gr.Markdown("### Obligation Lifecycle")
            with gr.Row():
                with gr.Column():
                    gr.Markdown("**1. Assign**")
                    assign_id = gr.Textbox(label="Obligation ID (partial OK)")
                    assign_owner = gr.Textbox(label="Owner")
                    assign_team = gr.Textbox(label="Team (optional)")
                    assign_btn = gr.Button("Assign")
                    assign_out = gr.Markdown("")

                with gr.Column():
                    gr.Markdown("**2. Execute**")
                    exec_id = gr.Textbox(label="Obligation ID (partial OK)")
                    exec_evidence = gr.Textbox(label="Evidence artifact", lines=2,
                        placeholder="Safety case SC-2024-001 created in Argus")
                    exec_btn = gr.Button("Execute")
                    exec_out = gr.Markdown("")

                with gr.Column():
                    gr.Markdown("**3. Verify**")
                    verify_id = gr.Textbox(label="Obligation ID (partial OK)")
                    verify_by = gr.Textbox(label="Verifier")
                    verify_signal = gr.Textbox(label="Independent signal", placeholder="Case confirmed in Argus")
                    verify_source = gr.Textbox(label="Signal source", placeholder="argus")
                    verify_btn = gr.Button("Verify")
                    verify_out = gr.Markdown("")

            assign_btn.click(fn=assign_obligation, inputs=[assign_id, assign_owner, assign_team],
                             outputs=[assign_out, obl_table])
            exec_btn.click(fn=execute_obligation, inputs=[exec_id, exec_evidence],
                          outputs=[exec_out, obl_table])
            verify_btn.click(fn=verify_obligation, inputs=[verify_id, verify_by, verify_signal, verify_source],
                            outputs=[verify_out, obl_table])
            refresh_obl_btn.click(fn=lambda sf: _refresh_obligations(sf), inputs=[status_filter], outputs=[obl_table])

        # ─── HCP Intelligence tab ───
        with gr.Tab("🧠 HCP Intelligence"):
            with gr.Row():
                with gr.Column(scale=1):
                    hcp_table = gr.Dataframe(
                        headers=["HCP ID", "Name", "Specialty", "Territory"],
                        datatype=["str", "str", "str", "str"],
                        value=_refresh_hcps(),
                        label="Healthcare Providers",
                        interactive=False,
                    )
                    hcp_id_input = gr.Textbox(label="HCP ID (partial OK)", placeholder="ff6a2e7b...")
                    diagnose_btn = gr.Button("Diagnose", variant="primary")

                with gr.Column(scale=2):
                    diag_out = gr.Markdown("### HCP diagnosis will appear here")

            diagnose_btn.click(fn=diagnose_hcp, inputs=[hcp_id_input], outputs=[diag_out])

        # ─── Response Debt tab ───
        with gr.Tab("💳 Response Debt"):
            refresh_debt_btn = gr.Button("Refresh")
            debt_out = gr.Markdown("")
            debt_table = gr.Dataframe(
                headers=["ID", "Type", "Description", "Status", "Deadline"],
                datatype=["str", "str", "str", "str", "str"],
                value=[],
                label="Top Unresolved Debts",
                interactive=False,
            )
            refresh_debt_btn.click(fn=_refresh_debt, outputs=[debt_out, debt_table])

        # ─── Analytics tab ───
        with gr.Tab("📊 Analytics"):
            refresh_analytics_btn = gr.Button("Refresh")
            analytics_out = gr.Markdown("")
            refresh_analytics_btn.click(fn=_refresh_analytics, outputs=[analytics_out])

        # Auto-refresh on load
        ui.load(fn=_refresh_mails, outputs=[mails_table])
        ui.load(fn=_refresh_obligations, outputs=[obl_table])

    return ui


def mount_ui(app, path: str = "/ui"):
    """Mount the Gradio UI onto an existing FastAPI app."""
    ui = build_ui()
    app = gr.mount_gradio_app(app, ui, path=path)
    return app


if __name__ == "__main__":
    ui = build_ui()
    ui.launch(server_port=7860, server_name="0.0.0.0", share=False)
