import { Setting, Notice, Modal, App } from "obsidian";
import { t } from "src/i18n";
import type { LocalLlmHubPlugin } from "src/plugin";
import type { McpFraming, McpServerConfig } from "src/types";
import { joinCommandLine, normalizeSpawnCommand, splitCommandLine } from "src/core/commandLine";

export interface ConnectResult {
  success: boolean;
  error?: string;
}

interface SettingsContext {
  plugin: LocalLlmHubPlugin;
  display: () => void;
}

export function displayMcpSettings(containerEl: HTMLElement, ctx: SettingsContext): void {
  const { plugin, display } = ctx;

  new Setting(containerEl).setName(t("settings.mcp")).setHeading();

  new Setting(containerEl)
    .setName(t("settings.mcpDesc"))
    .addButton((button) =>
      button
        .setButtonText(t("settings.mcpAdd"))
        .setCta()
        .onClick(() => {
          new McpServerModal(plugin.app, null, async (config) => {
            // The modal stays open after a failed check, so a retry must update
            // the entry that was already saved instead of adding a duplicate.
            const idx = plugin.settings.mcpServers.findIndex((s) => s.id === config.id);
            if (idx === -1) plugin.settings.mcpServers.push(config);
            else plugin.settings.mcpServers[idx] = config;
            await plugin.saveSettings();
            return applyConnection(config);
          }).open();
        })
    );

  /**
   * Connects (or disconnects) a server according to its enabled flag and
   * re-renders the list before and after so the "connecting" state is visible.
   */
  const applyConnection = async (config: McpServerConfig): Promise<ConnectResult> => {
    if (!config.enabled) {
      await plugin.mcpManager.disconnectServer(config.id);
      plugin.settingsEmitter.emit("settings-updated", plugin.settings);
      display();
      return { success: true };
    }
    // connectServer() flags the server as connecting synchronously, so the
    // re-render below already shows the pending status.
    const pending = plugin.mcpManager.connectServer(config);
    display();
    const result = await pending;
    if (result.success) {
      new Notice(t("settings.mcpConnected", { name: config.name }));
    }
    // saveSettings() emits before the asynchronous connection finishes.
    // Notify open chat views again so newly connected servers appear there.
    plugin.settingsEmitter.emit("settings-updated", plugin.settings);
    display();
    return result;
  };

  // List configured servers
  for (const server of plugin.settings.mcpServers) {
    const isConnected = plugin.mcpManager.getConnectedServerIds().includes(server.id);

    const setting = new Setting(containerEl)
      .setName(server.name)
      .setDesc(joinCommandLine([server.command, ...server.args]));

    const isConnecting = plugin.mcpManager.isConnecting(server.id);
    const statusEl = setting.controlEl.createDiv({ cls: "llm-hub-status" });
    if (isConnecting) {
      statusEl.addClass("llm-hub-status--pending");
      statusEl.textContent = t("settings.mcpStatusConnecting");
    } else if (isConnected) {
      statusEl.addClass("llm-hub-status--success");
      statusEl.textContent = t("settings.mcpStatusConnected");
    } else if (server.enabled) {
      statusEl.addClass("llm-hub-status--error");
      statusEl.textContent = t("settings.mcpStatusDisconnected");
    } else {
      statusEl.textContent = t("settings.mcpStatusDisabled");
    }

    // Toggle enable/disable
    setting.addToggle((toggle) =>
      toggle
        .setValue(server.enabled)
        .setDisabled(isConnecting)
        .onChange(async (value) => {
          server.enabled = value;
          await plugin.saveSettings();
          const result = await applyConnection(server);
          if (!result.success) {
            new Notice(t("settings.mcpConnectionFailed", { name: server.name, error: result.error || "" }));
          }
        })
    );

    // Edit button
    setting.addExtraButton((button) =>
      button
        .setIcon("pencil")
        .setTooltip(t("settings.mcpEdit"))
        .setDisabled(isConnecting)
        .onClick(() => {
          new McpServerModal(plugin.app, server, async (config) => {
            const idx = plugin.settings.mcpServers.findIndex((s) => s.id === server.id);
            if (idx === -1) return { success: false, error: "Server no longer exists" };
            plugin.settings.mcpServers[idx] = config;
            await plugin.saveSettings();
            return applyConnection(config);
          }).open();
        })
    );

    // Delete button
    setting.addExtraButton((button) =>
      button
        .setIcon("trash")
        .setTooltip(t("settings.mcpDelete"))
        .onClick(async () => {
          await plugin.mcpManager.disconnectServer(server.id);
          plugin.settings.mcpServers = plugin.settings.mcpServers.filter(
            (s) => s.id !== server.id,
          );
          await plugin.saveSettings();
          display();
          new Notice(t("settings.mcpDeleted", { name: server.name }));
        })
    );
  }
}

class McpServerModal extends Modal {
  private config: McpServerConfig;
  private onSave: (config: McpServerConfig) => Promise<ConnectResult>;
  private isNew: boolean;

  constructor(
    app: App,
    existing: McpServerConfig | null,
    onSave: (config: McpServerConfig) => Promise<ConnectResult>,
  ) {
    super(app);
    this.isNew = !existing;
    this.config = existing
      ? { ...existing, allowedTools: [...(existing.allowedTools ?? [])], args: [...existing.args], env: existing.env ? { ...existing.env } : undefined }
      : {
          id: crypto.randomUUID(),
          name: "",
          command: "",
          args: [],
          framing: "newline",
          enabled: true,
        };
    this.onSave = onSave;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", {
      text: this.isNew ? t("settings.mcpAddServer") : t("settings.mcpEditServer"),
    });

    new Setting(contentEl)
      .setName(t("settings.mcpServerName"))
      .setDesc(t("settings.mcpServerNameDesc"))
      .addText((text) =>
        text
          .setPlaceholder("E.g. Filesystem")
          .setValue(this.config.name)
          .onChange((v) => { this.config.name = v; })
      );

    new Setting(contentEl)
      .setName(t("settings.mcpAutoApprove"))
      .setDesc(t("settings.mcpAutoApprove.desc"))
      .addToggle(toggle => toggle.setValue(this.config.autoApprove ?? false)
        .onChange(value => { this.config.autoApprove = value; }));

    const allowedEl = contentEl.createDiv();
    const renderAllowedTools = () => {
      allowedEl.empty();
      new Setting(allowedEl).setName(t("settings.mcpAllowedTools")).setDesc(t("settings.mcpAllowedTools.desc"));
      for (const tool of this.config.allowedTools ?? []) {
        new Setting(allowedEl).setName(tool).addExtraButton(btn => btn
          .setIcon("trash").setTooltip(t("common.delete"))
          .onClick(() => {
            this.config.allowedTools = this.config.allowedTools?.filter(name => name !== tool);
            renderAllowedTools();
          }));
      }
    };
    renderAllowedTools();

    new Setting(contentEl)
      .setName(t("settings.mcpCommand"))
      .setDesc(t("settings.mcpCommandDesc"))
      .addText((text) =>
        text
          .setPlaceholder("E.g. node or C:\\Program Files\\nodejs\\node.exe")
          .setValue(this.config.command)
          .onChange((v) => { this.config.command = v; })
      );

    new Setting(contentEl)
      .setName(t("settings.mcpArgs"))
      .setDesc(t("settings.mcpArgsDesc"))
      .addText((text) =>
        text
          .setPlaceholder("E.g. -y @modelcontextprotocol/server-filesystem /path")
          .setValue(joinCommandLine(this.config.args))
          .onChange((v) => {
            this.config.args = splitCommandLine(v);
          })
      );

    new Setting(contentEl)
      .setName(t("settings.mcpFraming"))
      .setDesc(t("settings.mcpFramingDesc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("newline", "Newline (standard mcp)")
          .addOption("content-length", "Content-length (legacy/custom)")
          .setValue(this.config.framing || "newline")
          .onChange((v) => { this.config.framing = v as McpFraming; })
      );

    new Setting(contentEl)
      .setName(t("settings.mcpEnv"))
      .setDesc(t("settings.mcpEnvDesc"))
      .addTextArea((text) => {
        text
          .setPlaceholder("Key=value (one per line)")
          .setValue(
            this.config.env
              ? Object.entries(this.config.env)
                  .map(([k, v]) => `${k}=${v}`)
                  .join("\n")
              : "",
          )
          .onChange((v) => {
            if (!v.trim()) {
              this.config.env = undefined;
              return;
            }
            const env: Record<string, string> = {};
            for (const line of v.split("\n")) {
              const eqIdx = line.indexOf("=");
              if (eqIdx > 0) {
                env[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim();
              }
            }
            this.config.env = Object.keys(env).length > 0 ? env : undefined;
          });
        text.inputEl.rows = 3;
      });

    const statusEl = contentEl.createDiv({ cls: "llm-hub-status llm-hub-mcp-modal-status" });

    const buttonContainer = contentEl.createDiv({ cls: "llm-hub-modal-buttons" });
    const saveBtn = buttonContainer.createEl("button", {
      text: t("common.save"),
      cls: "mod-cta",
    });
    const cancelBtn = buttonContainer.createEl("button", {
      text: t("common.cancel"),
    });

    saveBtn.addEventListener("click", () => {
      void this.handleSave(saveBtn, cancelBtn, statusEl);
    });

    cancelBtn.addEventListener("click", () => {
      this.close();
    });
  }

  private async handleSave(saveBtn: HTMLButtonElement, cancelBtn: HTMLButtonElement, statusEl: HTMLElement): Promise<void> {
    if (!this.config.name.trim()) {
      new Notice(t("settings.mcpNameRequired"));
      return;
    }
    if (!this.config.command.trim()) {
      new Notice(t("settings.mcpCommandRequired"));
      return;
    }
    const { command, args } = normalizeSpawnCommand(this.config.command, this.config.args);
    const config = { ...this.config, command, args };

    // Verify the connection before closing so the user sees the outcome here.
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    saveBtn.textContent = t("settings.mcpChecking");
    statusEl.className = "llm-hub-status llm-hub-mcp-modal-status llm-hub-status--pending";
    statusEl.textContent = config.enabled ? t("settings.mcpStatusConnecting") : "";

    let result: ConnectResult;
    try {
      result = await this.onSave(config);
    } catch (err) {
      result = { success: false, error: err instanceof Error ? err.message : String(err) };
    }

    if (result.success) {
      this.close();
      return;
    }
    // Settings are already saved; keep the modal open so the command can be fixed.
    saveBtn.disabled = false;
    cancelBtn.disabled = false;
    saveBtn.textContent = t("common.save");
    statusEl.className = "llm-hub-status llm-hub-mcp-modal-status llm-hub-status--error";
    statusEl.textContent = t("settings.mcpConnectionFailed", { name: config.name, error: result.error || "" });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
