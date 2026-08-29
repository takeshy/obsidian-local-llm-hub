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

  it("keeps the leading slash of a posix file url", () => {
    expect(chatLinkFileRef("file:///home/me/other/doc.md", "/home/me/vault"))
      .toEqual({ scope: "absolute", path: "/home/me/other/doc.md" });
  });

  it("resolves a posix file url under the vault", () => {
    expect(chatLinkFileRef("file:///home/me/vault/notes/doc.md", "/home/me/vault"))
      .toEqual({ scope: "vault", path: "notes/doc.md" });
  });

  it("keeps a unc share absolute", () => {
    expect(chatLinkFileRef("file://server/share/doc.md", "C:\\Vault"))
      .toEqual({ scope: "absolute", path: "//server/share/doc.md" });
  });

  it("does not mistake a sibling path for a vault child", () => {
    expect(chatLinkFileRef("C:\\Vault-old\\note.md", "C:\\Vault"))
      .toEqual({ scope: "absolute", path: "C:/Vault-old/note.md" });
  });

  it("preserves heading and block anchors on vault links", () => {
    expect(chatLinkFileRef("Note.md#Heading", "/home/me/vault"))
      .toEqual({ scope: "vault", path: "Note.md#Heading" });
    expect(chatLinkFileRef("Note#^abc123", "/home/me/vault"))
      .toEqual({ scope: "vault", path: "Note#^abc123" });
    expect(chatLinkFileRef("/home/me/vault/Note.md#Heading", "/home/me/vault"))
      .toEqual({ scope: "vault", path: "Note.md#Heading" });
  });

  it("folds case only for windows-style roots", () => {
    expect(chatLinkFileRef("c:\\vault\\note.md", "C:\\Vault"))
      .toEqual({ scope: "vault", path: "note.md" });
    expect(chatLinkFileRef("/home/me/VAULT/note.md", "/home/me/vault"))
      .toEqual({ scope: "absolute", path: "/home/me/VAULT/note.md" });
  });

  it("keeps the vault root itself absolute so it opens in the OS", () => {
    expect(chatLinkFileRef("/home/me/vault", "/home/me/vault"))
      .toEqual({ scope: "absolute", path: "/home/me/vault" });
  });

  it("ignores web URLs", () => {
    expect(chatLinkFileRef("https://example.com/dashboard.md", "C:\\Vault"))
      .toBeNull();
  });

  it("ignores bare hosts that obsidian renders as links", () => {
    expect(chatLinkFileRef("www.example.com/page", "C:\\Vault")).toBeNull();
    expect(chatLinkFileRef("example.com", "C:\\Vault")).toBeNull();
  });

  it("ignores anchor-only and mailto links", () => {
    expect(chatLinkFileRef("#Heading", "C:\\Vault")).toBeNull();
    expect(chatLinkFileRef("mailto:someone@example.com", "C:\\Vault")).toBeNull();
  });
});
