import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";

const client = new Anthropic({ apiKey: config.anthropicApiKey });

/** Brief natural-language summary of a finished call for the admin dashboard. */
export async function summarizeConversation(transcript: string): Promise<string> {
  if (!transcript.trim()) return "Call ended before the customer said anything.";
  try {
    const response = await client.messages.create({
      model: config.summaryModel,
      max_tokens: 400,
      system:
        "You summarise RelayPay support calls between a customer and Jane, the AI support assistant, for the internal support team. Write 2-4 plain sentences covering: the topics the customer raised, what Jane did (answered from the knowledge base, looked up records, created a ticket or escalation, declined), and the outcome. Include anything discussed before a topic switch. No preamble, no bullet points.",
      messages: [{ role: "user", content: `<transcript>\n${transcript}\n</transcript>` }],
    });
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();
    return text || "Summary unavailable.";
  } catch (err) {
    console.error("[summary] failed:", err instanceof Error ? err.message : err);
    return "Summary unavailable (summary generation failed).";
  }
}
