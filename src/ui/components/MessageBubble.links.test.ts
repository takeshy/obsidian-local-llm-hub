import { describe, expect, it } from "vitest";
import { chatLinkFileRef } from "./chat/localFileLink";

describe("chatLinkFileRef", () => {
  it("converts a Windows path under the vault to a vault-relative path", () => {
    expect(chatLinkFileRef(
      "C:\\Users\\takes\\takeshy\\Knowledge\\features\\dashboard.md",
      "C:\\Users\\takes\\takeshy",
    )).toEqual({ scope: "vault", path: "Knowledge/features/dashboard.md" });
  });

  it("keeps relative paths vault-scoped", () => {
    expect(chatLinkFileRef("features/dashboard.md", "C:\\Vault"))
      .toEqual({ scope: "vault", path: "features/dashboard.md" });
  });

  it("keeps local paths outside the vault absolute", () => {
    expect(chatLinkFileRef("file:///C:/Temp/dashboard.md", "C:\\Vault"))
      .toEqual({ scope: "absolute", path: "C:/Temp/dashboard.md" });
  });

  it("does not mistake a sibling path for a vault child", () => {
    expect(chatLinkFileRef("C:\\Vault-old\\note.md", "C:\\Vault"))
      .toEqual({ scope: "absolute", path: "C:/Vault-old/note.md" });
  });

  it("ignores web URLs", () => {
    expect(chatLinkFileRef("https://example.com/dashboard.md", "C:\\Vault"))
      .toBeNull();
  });
});
