"""Email source adapters for RxMailOS.

Supports:
  1. IMAP — connect to any IMAP mailbox (Gmail, Outlook, etc.)
  2. Microsoft Graph — connect to Microsoft 365 mailboxes

All adapters produce MailObject instances that feed into the MailOS pipeline.
"""

from __future__ import annotations

import email
import imaplib
import logging
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime, getaddresses
from typing import Iterator, Optional
from uuid import uuid4

from rxreserve.mailos import MailObject

logger = logging.getLogger(__name__)


# ─── IMAP Source ───

class IMAPSource:
    """Connect to an IMAP mailbox and fetch emails as MailObjects."""

    def __init__(self, host: str, port: int = 993, username: str = "", password: str = "",
                 mailbox: str = "INBOX", use_ssl: bool = True):
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.mailbox = mailbox
        self.use_ssl = use_ssl

    def connect(self) -> imaplib.IMAP4_SSL | imaplib.IMAP4:
        if self.use_ssl:
            conn = imaplib.IMAP4_SSL(self.host, self.port)
        else:
            conn = imaplib.IMAP4(self.host, self.port)
        conn.login(self.username, self.password)
        conn.select(self.mailbox)
        return conn

    def fetch_recent(self, limit: int = 50, unseen_only: bool = True) -> list[MailObject]:
        """Fetch recent emails from the mailbox."""
        conn = self.connect()
        try:
            search_criteria = "UNSEEN" if unseen_only else "ALL"
            status, data = conn.search(None, search_criteria)
            if status != "OK":
                return []

            mail_ids = data[0].split()[-limit:]
            mails = []
            for mid in mail_ids:
                status, msg_data = conn.fetch(mid, "(RFC822)")
                if status != "OK" or not msg_data or not msg_data[0]:
                    continue
                raw = msg_data[0][1]
                mail = self._parse_email(raw)
                if mail:
                    mails.append(mail)
            return mails
        finally:
            conn.logout()

    def _parse_email(self, raw: bytes) -> Optional[MailObject]:
        try:
            msg = email.message_from_bytes(raw)
            from_addrs = getaddresses([msg.get("From", "")])
            from_addr = from_addrs[0][1] if from_addrs else ""
            from_name = from_addrs[0][0] if from_addrs else ""

            to_addrs = [a[1] for a in getaddresses([msg.get("To", "")]) if a[1]]
            cc_addrs = [a[1] for a in getaddresses([msg.get("Cc", "")]) if a[1]]

            subject = msg.get("Subject", "")
            body = ""
            if msg.is_multipart():
                for part in msg.walk():
                    ct = part.get_content_type()
                    if ct == "text/plain":
                        payload = part.get_payload(decode=True)
                        if payload:
                            charset = part.get_content_charset() or "utf-8"
                            body = payload.decode(charset, errors="replace")
                            break
                    elif ct == "text/html" and not body:
                        payload = part.get_payload(decode=True)
                        if payload:
                            charset = part.get_content_charset() or "utf-8"
                            body = payload.decode(charset, errors="replace")
            else:
                payload = msg.get_payload(decode=True)
                if payload:
                    charset = msg.get_content_charset() or "utf-8"
                    body = payload.decode(charset, errors="replace")

            date_str = msg.get("Date", "")
            try:
                ts = parsedate_to_datetime(date_str).isoformat() if date_str else ""
            except Exception:
                ts = ""

            thread_id = msg.get("Message-ID", "")
            in_reply_to = msg.get("In-Reply-To", "")

            return MailObject(
                from_address=from_addr,
                from_name=from_name,
                from_type="hcp",  # will be resolved by caller via CRM matching
                to_addresses=to_addrs,
                cc_addresses=cc_addrs,
                subject=subject,
                body=body,
                timestamp=ts,
                mailbox=self.mailbox,
                thread_id=thread_id,
                in_reply_to=in_reply_to,
            )
        except Exception as e:
            logger.error(f"Failed to parse email: {e}")
            return None


# ─── Microsoft Graph Source ───

class GraphSource:
    """Connect to Microsoft 365 via Graph API.

    Requires: access token with Mail.Read permission.
    """

    def __init__(self, access_token: str, mailbox: str = "inbox"):
        self.access_token = access_token
        self.mailbox = mailbox

    def fetch_recent(self, limit: int = 50, unread_only: bool = True) -> list[MailObject]:
        import requests
        headers = {"Authorization": f"Bearer {self.access_token}"}
        params = {
            "$top": limit,
            "$select": "id,subject,body,from,toRecipients,ccRecipients,receivedDateTime,conversationId",
            "$orderby": "receivedDateTime desc",
        }
        if unread_only:
            params["$filter"] = "isRead eq false"

        url = f"https://graph.microsoft.com/v1.0/me/mailFolders/{self.mailbox}/messages"
        resp = requests.get(url, headers=headers, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()

        mails = []
        for msg in data.get("value", []):
            from_obj = msg.get("from", {}).get("emailAddress", {})
            to_list = [r.get("emailAddress", {}).get("address", "") for r in msg.get("toRecipients", [])]
            cc_list = [r.get("emailAddress", {}).get("address", "") for r in msg.get("ccRecipients", [])]

            body_content = msg.get("body", {}).get("content", "")
            # Strip HTML tags if needed
            if msg.get("body", {}).get("contentType") == "html":
                import re
                body_content = re.sub(r'<[^>]+>', '', body_content)

            mails.append(MailObject(
                from_address=from_obj.get("address", ""),
                from_name=from_obj.get("name", ""),
                from_type="hcp",  # resolved by caller
                to_addresses=to_list,
                cc_addresses=cc_list,
                subject=msg.get("subject", ""),
                body=body_content,
                timestamp=msg.get("receivedDateTime", ""),
                mailbox=self.mailbox,
                thread_id=msg.get("conversationId", ""),
            ))
        return mails
