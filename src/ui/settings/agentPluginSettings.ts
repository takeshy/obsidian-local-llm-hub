import { Notice, Setting } from "obsidian";
import { agentPluginRoot, agentPluginAbsolutePaths, installAgentPlugin, parseAgentPluginMcp, previewAgentPlugin, uninstallAgentPlugin } from "src/core/agentPlugins";
import { asLocalMcpServer, type AgentPluginInstall, type McpServerConfig } from "src/types";
import type { SettingsContext } from "./settingsContext";
import { AgentPluginInstallModal } from "./AgentPluginInstallModal";
import { ConfirmModal } from "src/ui/components/ConfirmModal";

function mergeServer(next: McpServerConfig, previous?: McpServerConfig): McpServerConfig {
  if (!previous) return next;
  const same = next.command === previous.command && JSON.stringify(next.args) === JSON.stringify(previous.args) && JSON.stringify(next.env ?? {}) === JSON.stringify(previous.env ?? {});
  return same ? { ...next, enabled: previous.enabled } : next;
}

export function displayAgentPluginSettings(containerEl: HTMLElement, ctx: SettingsContext): void {
  const { plugin, display } = ctx;
  new Setting(containerEl).setName("Agent plugins").setHeading();
  containerEl.createDiv({ cls: "setting-item-description", text: `Install Agent Plugins v1.0.0 from a public GitHub repository. Packages are pinned to a commit and stored in ${agentPluginRoot()}.` });
  let repository = "";
  new Setting(containerEl).setName("GitHub repository").setDesc("Owner/repository or a GitHub URL").addText(text => text.setPlaceholder("Owner/repository").onChange(value => { repository = value; })).addButton(button => button.setButtonText("Preview and install").setCta().onClick(() => { void (async () => {
    button.setDisabled(true);
    try {
      const preview = await previewAgentPlugin(repository), paths = agentPluginAbsolutePaths(plugin.app, preview.manifest.name);
      const prior = new Map(plugin.settings.mcpServers.filter(v => v.agentPlugin?.pluginName === preview.manifest.name).map(v => [v.agentPlugin!.serverName, v]));
      const bytes = preview.files["mcp.json"];
      const managed = bytes ? parseAgentPluginMcp<McpServerConfig>(new TextDecoder().decode(bytes), preview.manifest.name, paths.root, paths.data).servers.map(v => mergeServer(v, prior.get(v.agentPlugin!.serverName))) : [];
      let metadata: AgentPluginInstall | null = null;
      new AgentPluginInstallModal(plugin.app, preview, managed, async () => {
        for (const server of plugin.settings.mcpServers.filter(v => v.agentPlugin?.pluginName === preview.manifest.name)) await plugin.mcpManager.disconnectServer(asLocalMcpServer(server).id);
        metadata = await installAgentPlugin(plugin.app, preview);
      }, async servers => {
        if (!metadata) throw new Error("Agent Plugin installation did not complete.");
        plugin.settings.agentPlugins = [...plugin.settings.agentPlugins.filter(v => v.name !== metadata!.name), metadata];
        plugin.settings.mcpServers = [...plugin.settings.mcpServers.filter(v => v.agentPlugin?.pluginName !== metadata!.name), ...servers];
        await plugin.saveSettings(); plugin.settingsEmitter.emit("skills-changed"); display();
      }).open();
    } catch (error) { new Notice(error instanceof Error ? error.message : String(error)); } finally { button.setDisabled(false); }
  })(); }));
  for (const item of plugin.settings.agentPlugins) {
    const setting = new Setting(containerEl).setName(item.name).setDesc(`${item.version} · ${item.repo}@${item.commitSha.slice(0, 7)} · Skills: ${item.skillNames.join(", ") || "none"}`);
    setting.addToggle(toggle => toggle.setValue(item.enabled).onChange(value => { void (async () => { item.enabled = value; await plugin.app.vault.adapter.write(`${agentPluginRoot()}/${item.name}/install.json`, JSON.stringify(item, null, 2)); for (const server of plugin.settings.mcpServers) if (server.agentPlugin?.pluginName === item.name && !value) { server.enabled = false; await plugin.mcpManager.disconnectServer(asLocalMcpServer(server).id); } await plugin.saveSettings(); plugin.settingsEmitter.emit("skills-changed"); display(); })(); }));
    setting.addExtraButton(button => button.setIcon("refresh-cw").setTooltip("Check for update").onClick(() => { void (async () => { try { const next = await previewAgentPlugin(item.repo); new Notice(next.commitSha === item.commitSha ? `${item.name} is up to date.` : `Update available for ${item.name}: ${next.version}.`); } catch (error) { new Notice(String(error)); } })(); }));
    setting.addExtraButton(button => button.setIcon("trash").setTooltip("Uninstall").onClick(() => { void (async () => { if (!await new ConfirmModal(plugin.app, `Uninstall ${item.name}?`, "Uninstall").openAndWait()) return; for (const server of plugin.settings.mcpServers.filter(v => v.agentPlugin?.pluginName === item.name)) await plugin.mcpManager.disconnectServer(asLocalMcpServer(server).id); await uninstallAgentPlugin(plugin.app, item.name); plugin.settings.agentPlugins = plugin.settings.agentPlugins.filter(v => v.name !== item.name); plugin.settings.mcpServers = plugin.settings.mcpServers.filter(v => v.agentPlugin?.pluginName !== item.name); await plugin.saveSettings(); plugin.settingsEmitter.emit("skills-changed"); new Notice(`Uninstalled ${item.name}. Plugin data was preserved.`); display(); })(); }));
  }
}
