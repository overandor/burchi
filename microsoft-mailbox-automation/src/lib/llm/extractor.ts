import OpenAI from "openai";
import { AppConfig, EmailMessage, ExtractedData, ExtractedField, ExtractedTable, ParsedAttachmentData } from "@/types";

interface LLMExtractionResult {
  fields: ExtractedField[];
  tables: ExtractedTable[];
  summary: string;
  category: string;
  confidence: number;
}

export async function extractDataFromEmail(
  email: EmailMessage,
  attachments: ParsedAttachmentData[],
  config: AppConfig
): Promise<ExtractedData> {
  const client = new OpenAI({
    apiKey: config.llm.apiKey,
    ...(config.llm.endpoint ? { baseURL: config.llm.endpoint } : {}),
  });

  const emailContent = stripHtml(email.body);
  const attachmentSummaries = attachments.map((att, i) => {
    if (att.type === "csv" || att.type === "excel") {
      const rows = att.rows || [];
      const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
      const sampleRows = rows.slice(0, 20);
      return `Attachment ${i + 1} (${att.type}):\nHeaders: ${headers.join(", ")}\nRows (${rows.length} total, showing ${sampleRows.length}):\n${JSON.stringify(sampleRows, null, 2)}`;
    } else if (att.type === "pdf" || att.type === "text") {
      const text = att.text || "";
      return `Attachment ${i + 1} (${att.type}):\n${text.slice(0, 8000)}`;
    }
    return `Attachment ${i + 1}: Unknown type`;
  }).join("\n\n---\n\n");

  const categories = config.processing.categories.join(", ");
  const prompt = config.processing.extractionPrompt
    .replace("{categories}", categories);

  const systemMessage = `You are a scientific data extraction assistant. You extract structured scientific data from emails and their attachments.
Available categories: ${categories}

Return ONLY valid JSON (no markdown, no code blocks) with this exact structure:
{
  "fields": [{ "key": "field_name", "value": "field_value", "type": "string|number|date|boolean|scientific_value", "unit": "optional_unit", "confidence": 0.0-1.0 }],
  "tables": [{ "name": "table_name", "headers": ["col1", "col2"], "rows": [{"col1": "val1", "col2": "val2"}], "source": "email_body|attachment_name" }],
  "summary": "brief summary of scientific content",
  "category": "one of the available categories",
  "confidence": 0.0-1.0
}`;

  const userMessage = `Email Subject: ${email.subject}
From: ${email.sender} (${email.senderEmail})
Received: ${email.receivedDate}

Email Body:
${emailContent.slice(0, 12000)}

${attachmentSummaries ? `\nAttachments:\n${attachmentSummaries}` : ""}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);

  let response;
  try {
    response = await client.chat.completions.create({
      model: config.llm.model,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userMessage },
      ],
      temperature: 0.1,
      max_tokens: 4096,
      response_format: { type: "json_object" },
      // @ts-expect-error - OpenAI SDK accepts signal but types don't expose it in all versions
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    console.error("[extractor] OpenAI API call failed, trying LLM7 fallback:", e);
    // Try free LLM7 fallback before giving up
    const fallbackContent = await tryLLM7Extraction(systemMessage, userMessage);
    if (fallbackContent) {
      response = { choices: [{ message: { content: fallbackContent } }] } as any;
    } else {
      throw e;
    }
  }
  clearTimeout(timer);

  if (!response?.choices || !Array.isArray(response.choices) || response.choices.length === 0) {
    console.error("[extractor] Invalid API response: missing or empty choices array");
    throw new Error("LLM returned invalid response: missing choices array");
  }

  const content = response.choices[0]?.message?.content || "{}";
  if (!content || content === "{}") {
    console.error("[extractor] Invalid API response: empty content in choices[0]");
    throw new Error("LLM returned invalid response: empty content");
  }

  let result: LLMExtractionResult;

  try {
    result = JSON.parse(content);
  } catch (e) {
    console.error("[extractor] JSON parse failed:", e);
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        result = JSON.parse(jsonMatch[0]);
      } catch (e2) {
        console.error("[extractor] Fallback JSON parse also failed:", e2);
        throw new Error("LLM returned invalid JSON");
      }
    } else {
      throw new Error("LLM returned invalid JSON");
    }
  }

  const source = attachments.length > 0 && emailContent.trim() ? "both" : attachments.length > 0 ? "attachment" : "email_body";

  return {
    emailId: email.id,
    extractedAt: new Date().toISOString(),
    fields: result.fields || [],
    tables: result.tables || [],
    summary: result.summary || "",
    category: result.category || "Other",
    confidence: result.confidence || 0,
    source: source as "email_body" | "attachment" | "both",
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Free LLM7 fallback for email extraction when the primary OpenAI endpoint fails.
 * Returns the raw JSON string content from the LLM response, or null on failure.
 */
async function tryLLM7Extraction(systemMessage: string, userMessage: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const res = await fetch("https://api.llm7.io/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: "gpt-oss:20b",
        messages: [
          { role: "system", content: systemMessage },
          { role: "user", content: userMessage },
        ],
        max_tokens: 4096,
        temperature: 0.1,
      }),
    });
    clearTimeout(timeout);
    if (res.ok) {
      const text = await res.text();
      if (text && !text.trim().startsWith("<")) {
        const data = JSON.parse(text);
        const content = data.choices?.[0]?.message?.content || "";
        const reasoning = data.choices?.[0]?.message?.reasoning || "";
        return content || reasoning || null;
      }
    }
  } catch (e) {
    console.error("[extractor] LLM7 fallback error:", e);
  }
  return null;
}
