import type { Message } from "src/types";
import { t } from "src/i18n";

// Convert messages to Markdown format
export function messagesToMarkdown(
  msgs: Message[],
  title: string,
  createdAt: number,
): string {
  const date = new Date(createdAt);
  let md = `---\ntitle: "${title.replace(/"/g, '\\"')}"\ncreatedAt: ${createdAt}\nupdatedAt: ${Date.now()}\n`;
  md += `---\n\n`;
  md += `# ${title}\n\n`;
  md += `*Created: ${date.toLocaleString()}*\n\n---\n\n`;

  for (const msg of msgs) {
    const role = msg.role === "user" ? "**You**" : `**${msg.model || "Assistant"}**`;
    const time = new Date(msg.timestamp).toLocaleTimeString();

    md += `## ${role} (${time})\n\n`;

    if (msg.attachments && msg.attachments.length > 0) {
      md += `> Attachments: ${msg.attachments.map(a => `${a.name}`).join(", ")}\n\n`;
    }

    md += `${msg.content}\n\n`;

    // Save metadata as HTML comment
    const metadata: Record<string, unknown> = {};
    if (msg.thinking) metadata.thinking = msg.thinking;
    if (msg.ragUsed) metadata.ragUsed = msg.ragUsed;
    if (msg.ragSources) metadata.ragSources = msg.ragSources;
    if (msg.usage) metadata.usage = msg.usage;
    if (msg.elapsedMs) metadata.elapsedMs = msg.elapsedMs;
    metadata.timestamp = msg.timestamp;

    md += `<!-- msg-meta:${JSON.stringify(metadata)} -->\n\n---\n\n`;
  }

  return md;
}

// Parse Markdown back to messages
export function parseMarkdownToMessages(content: string): { messages: Message[]; createdAt: number } | null {
  try {
    // Extract frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    let createdAt = Date.now();

    if (frontmatterMatch) {
      const createdAtMatch = frontmatterMatch[1].match(/createdAt:\s*(\d+)/);
      if (createdAtMatch) {
        createdAt = parseInt(createdAtMatch[1]);
      }
    }

    // Parse messages
    const messages: Message[] = [];
    const messageBlocks = content.split(/\n## \*\*/);

    for (let i = 1; i < messageBlocks.length; i++) {
      const block = messageBlocks[i];
      const roleMatch = block.match(/^(You|[^*]+)\*\* \(([^)]+)\)/);

      if (roleMatch) {
        const isUser = roleMatch[1] === "You";

        const lines = block.split("\n").slice(1);
        const contentLines: string[] = [];
        let inContent = false;
        const hasMetadata = block.includes("<!-- msg-meta:");

        for (const line of lines) {
          if (line.startsWith("> Attachments:")) continue;
          if (line.startsWith("<!-- msg-meta:")) break;
          if (!hasMetadata && line === "---") break;
          if (line.trim() !== "" || inContent) {
            inContent = true;
            contentLines.push(line);
          }
        }

        const msgContent = contentLines.join("\n").trim();

        const message: Message = {
          role: isUser ? "user" : "assistant",
          content: msgContent,
          timestamp: createdAt + i * 1000,
          model: isUser ? undefined : roleMatch[1].trim(),
        };

        // Restore metadata from HTML comment
        const metadataMatch = block.match(/<!-- msg-meta:(.+?) -->/);
        if (metadataMatch) {
          try {
            const meta = JSON.parse(metadataMatch[1]) as Record<string, unknown>;
            if (meta.thinking) message.thinking = meta.thinking as string;
            if (meta.ragUsed) message.ragUsed = meta.ragUsed as boolean;
            if (meta.ragSources) message.ragSources = meta.ragSources as string[];
            if (meta.usage) message.usage = meta.usage as Message["usage"];
            if (meta.elapsedMs) message.elapsedMs = meta.elapsedMs as number;
            if (meta.timestamp) message.timestamp = meta.timestamp as number;
          } catch {
            // Ignore parse errors
          }
        }

        messages.push(message);
      }
    }

    return { messages, createdAt };
  } catch {
    return null;
  }
}

export function formatHistoryDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } else if (diffDays === 1) {
    return t("chat.yesterday");
  } else if (diffDays < 7) {
    return date.toLocaleDateString(undefined, { weekday: "short" });
  } else {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
}
