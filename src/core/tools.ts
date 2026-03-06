import type { ToolDefinition, VaultToolMode } from "../types";

// All vault tool definitions
const readNote: ToolDefinition = {
  type: "function",
  function: {
    name: "read_note",
    description: "Read the full content of a note by its file path.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to vault root (e.g. 'folder/note.md')" },
      },
      required: ["path"],
    },
  },
};

const createNote: ToolDefinition = {
  type: "function",
  function: {
    name: "create_note",
    description: "Create a new note with the given content. Fails if the file already exists.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path for the new note (e.g. 'folder/new-note.md')" },
        content: { type: "string", description: "Content of the new note (markdown)" },
      },
      required: ["path", "content"],
    },
  },
};

const searchNotes: ToolDefinition = {
  type: "function",
  function: {
    name: "search_notes",
    description: "Search for notes containing the given query text in their content or filename.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "string", description: "Max results to return (default: 10)" },
      },
      required: ["query"],
    },
  },
};

const listNotes: ToolDefinition = {
  type: "function",
  function: {
    name: "list_notes",
    description: "List markdown notes in a folder. Returns file paths.",
    parameters: {
      type: "object",
      properties: {
        folder: { type: "string", description: "Folder path (empty string for vault root)" },
        recursive: { type: "string", description: "'true' to include subfolders (default: 'false')" },
      },
      required: [],
    },
  },
};

const listFolders: ToolDefinition = {
  type: "function",
  function: {
    name: "list_folders",
    description: "List subfolders of a given folder.",
    parameters: {
      type: "object",
      properties: {
        folder: { type: "string", description: "Parent folder path (empty string for vault root)" },
      },
      required: [],
    },
  },
};

const getActiveNote: ToolDefinition = {
  type: "function",
  function: {
    name: "get_active_note",
    description: "Get information about the currently active (open) note, including its path and content.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

const proposeEdit: ToolDefinition = {
  type: "function",
  function: {
    name: "propose_edit",
    description: "Propose an edit to an existing note. Provide the full new content. The user will review the diff before applying.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path of the note to edit" },
        content: { type: "string", description: "The full new content of the note" },
      },
      required: ["path", "content"],
    },
  },
};

// Search tools (excluded in "noSearch" mode)
const searchToolNames = new Set(["search_notes", "list_notes"]);

// All vault tools
const allVaultTools: ToolDefinition[] = [
  readNote, createNote, searchNotes, listNotes, listFolders, getActiveNote, proposeEdit,
];

/**
 * Get vault tools based on the current mode.
 * - "all": all tools
 * - "noSearch": all tools except search_notes and list_notes
 * - "none": no tools
 */
export function getVaultTools(mode: VaultToolMode): ToolDefinition[] {
  if (mode === "none") return [];
  if (mode === "noSearch") return allVaultTools.filter(t => !searchToolNames.has(t.function.name));
  return allVaultTools;
}
