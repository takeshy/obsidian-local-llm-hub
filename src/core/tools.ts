import type { ToolDefinition, VaultToolMode } from "../types";

const readTimeline: ToolDefinition = {
  type: "function",
  function: {
    name: "read_timeline",
    description: "Read activity recorded by Dashboard Hub in an Obsidian Timeline for a day. Use this when asked what the user did today or on a specific date. Includes manual Timeline posts, Calendar plans created that day, memo activity, and Kanban status changes.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Local date in YYYY-MM-DD format. Defaults to today." },
        timelineName: { type: "string", description: "Timeline name. Defaults to Timeline." },
      },
      required: [],
    },
  },
};

// All vault tool definitions
export const readNoteTool: ToolDefinition = {
  type: "function",
  function: {
    name: "read_note",
    description: "Read a supported vault file by its path. Text files return their content; PDFs are attached for PDF-capable models or have their text extracted as a fallback. For PDFs, an inclusive page range can be selected with startPage and endPage.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to vault root (e.g. 'folder/note.md', 'folder/board.canvas', or 'folder/document.pdf')" },
        startPage: { type: "integer", description: "For PDFs, the 1-based first page to read (inclusive). Defaults to page 1." },
        endPage: { type: "integer", description: "For PDFs, the 1-based last page to read (inclusive). Defaults to the final page." },
      },
      required: ["path"],
    },
  },
};

const createNote: ToolDefinition = {
  type: "function",
  function: {
    name: "create_note",
    description: "Create a new text-based vault file with the given content. Fails if the file already exists.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path for the new vault file. If no extension is provided, .md is added automatically." },
        content: { type: "string", description: "Text content for the file (for example Markdown, Canvas JSON, Bases YAML, or plain text)" },
      },
      required: ["path", "content"],
    },
  },
};

const searchNotes: ToolDefinition = {
  type: "function",
  function: {
    name: "search_notes",
    description: "Search vault files containing the given query text in their content or filename. PDFs match by filename only — read their contents with read_note.",
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
    description: "List readable vault files (text files and PDFs) in a folder. Returns file paths.",
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
    description: "Get information about the currently active (open) vault file, including its path and content.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

const updateNote: ToolDefinition = {
  type: "function",
  function: {
    name: "update_note",
    description: "Propose an update to an existing text-based vault file. Supports replace, append, or prepend modes; the user reviews the resulting diff before it is applied.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path of the vault file to update" },
        content: { type: "string", description: "The new content" },
        mode: { type: "string", description: "Update mode", enum: ["replace", "append", "prepend"] },
      },
      required: ["path", "content"],
    },
  },
};

const renameNote: ToolDefinition = {
  type: "function",
  function: {
    name: "rename_note",
    description: "Rename or move a text-based vault file to a new path.",
    parameters: {
      type: "object",
      properties: {
        oldPath: { type: "string", description: "Current file path" },
        newPath: { type: "string", description: "New file path" },
      },
      required: ["oldPath", "newPath"],
    },
  },
};

const createFolder: ToolDefinition = {
  type: "function",
  function: {
    name: "create_folder",
    description: "Create a new folder in the vault.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Folder path to create" },
      },
      required: ["path"],
    },
  },
};

const proposeEdit: ToolDefinition = {
  type: "function",
  function: {
    name: "propose_edit",
    description: "Propose an edit to an existing text-based vault file. Provide the full new content. The user will review the diff before applying.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path of the vault file to edit" },
        content: { type: "string", description: "The full new content of the vault file" },
      },
      required: ["path", "content"],
    },
  },
};

const deleteNote: ToolDefinition = {
  type: "function",
  function: {
    name: "delete_note",
    description: "Propose moving an existing text-based vault file to the trash. The user reviews its removal before it is applied.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "File path to delete" } },
      required: ["path"],
    },
  },
};

const bulkProposeEdit: ToolDefinition = {
  type: "function",
  function: {
    name: "bulk_propose_edit",
    description: "Propose full-content edits to multiple existing vault files. Each diff requires user confirmation.",
    parameters: {
      type: "object",
      properties: {
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              content: { type: "string" },
            },
            required: ["path", "content"],
          },
        },
      },
      required: ["edits"],
    },
  },
};

const bulkDeleteNotes: ToolDefinition = {
  type: "function",
  function: {
    name: "bulk_delete_notes",
    description: "Propose moving multiple vault files to the trash. Each deletion requires user confirmation.",
    parameters: {
      type: "object",
      properties: { paths: { type: "array", items: { type: "string" } } },
      required: ["paths"],
    },
  },
};

const bulkRenameNotes: ToolDefinition = {
  type: "function",
  function: {
    name: "bulk_rename_notes",
    description: "Propose renaming multiple vault files. Each rename requires user confirmation.",
    parameters: {
      type: "object",
      properties: {
        renames: {
          type: "array",
          items: {
            type: "object",
            properties: {
              oldPath: { type: "string" },
              newPath: { type: "string" },
            },
            required: ["oldPath", "newPath"],
          },
        },
      },
      required: ["renames"],
    },
  },
};

export const SKILL_WORKFLOW_TOOL_NAME = "run_skill_workflow";

export const skillWorkflowTool: ToolDefinition = {
  type: "function",
  function: {
    name: SKILL_WORKFLOW_TOOL_NAME,
    description:
      "Run a workflow provided by an active agent skill. Workflows can execute commands, HTTP requests, file operations, and more. For vault skills the workflow ID and its input variables are defined inside SKILL.md — you must read SKILL.md (via `read_note`) before you can construct a correct call. If the workflow fails, do NOT retry automatically — report the error to the user instead.",
    parameters: {
      type: "object",
      properties: {
        workflowId: {
          type: "string",
          description: "The workflow ID to run (format: skillName/workflowName, discovered from the skill's SKILL.md)",
        },
        variables: {
          type: "string",
          description: 'JSON object of input variables to pass to the workflow (e.g. {"filePath": "notes/todo.md"})',
        },
      },
      required: ["workflowId"],
    },
  },
};

// Search tools (excluded in "noSearch" mode)
const searchToolNames = new Set(["search_notes", "list_notes"]);

// All vault tools
const allVaultTools: ToolDefinition[] = [
  readTimeline, readNoteTool, createNote, updateNote, renameNote, createFolder,
  searchNotes, listNotes, listFolders, getActiveNote, proposeEdit, deleteNote,
  bulkProposeEdit, bulkDeleteNotes, bulkRenameNotes,
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
