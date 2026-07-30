import { Setting, Notice, Modal, App } from "obsidian";
import { t } from "src/i18n";
import type { LocalLlmHubPlugin } from "src/plugin";
import type { McpFraming, McpServerConfig } from "src/types";

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
            plugin.settings.mcpServers.push(config);
            await plugin.saveSettings();
            if (config.enabled) {
              const result = await plugin.mcpManager.connectServer(config);
              if (result.success) {
                new Notice(t("settings.mcpConnected", { name: config.name }));
              } else {
                new Notice(t("settings.mcpConnectionFailed", { name: config.name, error: result.error || "" }));
              }
            }
            // saveSettings() emits before the asynchronous connection finishes.
            // Notify open chat views again so newly connected servers appear there.
            plugin.settingsEmitter.emit("settings-updated", plugin.settings);
            display();
          }).open();
        })
    );

  // List configured servers
  for (const server of plugin.settings.mcpServers) {
    const isConnected = plugin.mcpManager.getConnectedServerIds().includes(server.id);

    const setting = new Setting(containerEl)
      .setName(server.name)
      .setDesc(`${server.command} ${server.args.join(" ")}`);

    const statusEl = setting.controlEl.createDiv({ cls: "llm-hub-status" });
    if (isConnected) {
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
        .onChange(async (value) => {
          server.enabled = value;
          await plugin.saveSettings();
          if (value) {
            const result = await plugin.mcpManager.connectServer(server);
            if (result.success) {
              new Notice(t("settings.mcpConnected", { name: server.name }));
            } else {
              new Notice(t("settings.mcpConnectionFailed", { name: server.name, error: result.error || "" }));
            }
          } else {
            await plugin.mcpManager.disconnectServer(server.id);
          }
          // Refresh chat MCP controls after the connection state has settled.
          plugin.settingsEmitter.emit("settings-updated", plugin.settings);
          display();
        })
    );

    // Edit button
    setting.addExtraButton((button) =>
      button
        .setIcon("pencil")
        .setTooltip(t("settings.mcpEdit"))
        .onClick(() => {
          new McpServerModal(plugin.app, server, async (config) => {
            const idx = plugin.settings.mcpServers.findIndex((s) => s.id === server.id);
            if (idx !== -1) {
              plugin.settings.mcpServers[idx] = config;
              await plugin.saveSettings();
              // Reconnect if enabled
              if (config.enabled) {
                const result = await plugin.mcpManager.connectServer(config);
                if (result.success) {
                  new Notice(t("settings.mcpConnected", { name: config.name }));
                } else {
                  new Notice(t("settings.mcpConnectionFailed", { name: config.name, error: result.error || "" }));
                }
              } else {
                await plugin.mcpManager.disconnectServer(config.id);
              }
              // Refresh chat MCP controls after reconnecting the edited server.
              plugin.settingsEmitter.emit("settings-updated", plugin.settings);
              display();
            }
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
  private onSave: (config: McpServerConfig) => Promise<void>;
  private isNew: boolean;

  constructor(
    app: App,
    existing: McpServerConfig | null,
    onSave: (config: McpServerConfig) => Promise<void>,
  ) {
    super(app);
    this.isNew = !existing;
    this.config = existing
      ? { ...existing, args: [...existing.args], env: existing.env ? { ...existing.env } : undefined }
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
      .setName(t("settings.mcpCommand"))
      .setDesc(t("settings.mcpCommandDesc"))
      .addText((text) =>
        text
          .setPlaceholder("E.g. Npx")
          .setValue(this.config.command)
          .onChange((v) => { this.config.command = v; })
      );

    new Setting(contentEl)
      .setName(t("settings.mcpArgs"))
      .setDesc(t("settings.mcpArgsDesc"))
      .addText((text) =>
        text
          .setPlaceholder("E.g. -y @modelcontextprotocol/server-filesystem /path")
          .setValue(this.config.args.join(" "))
          .onChange((v) => {
            this.config.args = v.split(" ").filter((a) => a.length > 0);
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

    const buttonContainer = contentEl.createDiv({ cls: "llm-hub-modal-buttons" });
    const saveBtn = buttonContainer.createEl("button", {
      text: t("common.save"),
      cls: "mod-cta",
    });
    saveBtn.addEventListener("click", () => {
      if (!this.config.name.trim()) {
        new Notice(t("settings.mcpNameRequired"));
        return;
      }
      if (!this.config.command.trim()) {
        new Notice(t("settings.mcpCommandRequired"));
        return;
      }
      void this.onSave(this.config);
      this.close();
    });

    const cancelBtn = buttonContainer.createEl("button", {
      text: t("common.cancel"),
    });
    cancelBtn.addEventListener("click", () => {
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
