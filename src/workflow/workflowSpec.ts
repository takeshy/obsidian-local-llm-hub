// Workflow specification for AI generation
// This is used as a system prompt when the LLM generates or modifies workflows

export function getWorkflowSpecification(): string {
  return `
# Obsidian Workflow Specification

## Format
Workflows are defined in YAML format. Output ONLY the YAML content starting with "name:".

## Basic Structure
\`\`\`yaml
name: workflow-name
nodes:
  - id: node-1
    type: variable
    name: myVar
    value: "initial value"
  - id: node-2
    type: command
    prompt: "Process {{myVar}}"
    saveTo: result
\`\`\`

## Variable Syntax
- Simple: \`{{variableName}}\`
- Object: \`{{obj.property}}\`, \`{{obj.nested.value}}\`
- Array: \`{{arr[0]}}\`, \`{{arr[0].name}}\`
- Variable index: \`{{arr[index]}}\` (where index is a variable)
- JSON escape: \`{{variable:json}}\` for embedding in JSON strings
- Expression (in set node): \`{{a}} + {{b}}\`, operators: +, -, *, /, %

**JSON escape example**:
\`\`\`yaml
# Safe for content with newlines, quotes, etc.
args: '{"text": "{{content:json}}"}'
\`\`\`

## Condition Syntax
Operators: ==, !=, <, >, <=, >=, contains
\`\`\`yaml
condition: "{{status}} == done"
condition: "{{count}} < 10"
condition: "{{text}} contains keyword"
\`\`\`

## Node Types

### Control Flow

#### variable
Initialize a variable.
- **name** (required): Variable name
- **value** (required): Initial value (string or number)

#### set
Update a variable with expression support.
- **name** (required): Variable name (use "_clipboard" to copy to system clipboard)
- **value** (required): New value or expression (e.g., "{{counter}} + 1")

#### if
Conditional branching.
- **condition** (required): Condition to evaluate
- **trueNext** (required): Node ID for true branch
- **falseNext** (optional): Node ID for false branch (defaults to next node)

#### while
Loop while condition is true.
- **condition** (required): Loop condition
- **trueNext** (required): Node ID for loop body
- **falseNext** (optional): Node ID for exit (defaults to next node)

#### sleep
Pause execution.
- **duration** (required): Sleep duration in milliseconds (supports {{variables}})

### AI & LLM

#### command
Execute LLM prompt.
- **prompt** (required): Prompt template (supports {{variables}})
- **enableThinking** (optional): "true" (default) or "false". Enable deep thinking mode
- **attachments** (optional): Comma-separated variable names containing FileExplorerData
- **saveTo** (optional): Variable for text response

### HTTP

#### http
Make HTTP request.
- **url** (required): Request URL (supports {{variables}})
- **method** (optional): GET, POST, PUT, DELETE, PATCH (default: GET)
- **contentType** (optional): "json", "form-data", "text", "binary" (default: "json")
- **responseType** (optional): "auto", "text", "binary" (default: "auto")
- **headers** (optional): JSON headers
- **body** (optional): Request body (supports {{variables}})
  - For "json": JSON string
  - For "form-data": JSON object. FileExplorerData is auto-detected and sent as binary.
  - For "text": Plain text
  - For "binary": FileExplorerData JSON (sends raw binary, uses mimeType as Content-Type)
- **saveTo** (optional): Variable for response (text as string, binary as FileExplorerData)
- **saveStatus** (optional): Variable for HTTP status code
- **throwOnError** (optional): "true" to throw on 4xx/5xx

### Note Operations

#### note
Write/create note.
- **path** (required): Note path without .md extension (supports {{variables}})
- **content** (required): Content to write (supports {{variables}})
- **mode** (optional): overwrite (default), append, create
- **confirm** (optional): "true" (default) / "false" for confirmation dialog
- **history** (optional): "true" (default) / "false" to record edit history

#### note-read
Read note content.
- **path** (required): Note path. Use prompt-file first to get file path if needed.
- **saveTo** (required): Variable for content

#### note-search
Search notes.
- **query** (required): Search query
- **searchContent** (optional): "true"/"false" (default: "false" for filename search)
- **limit** (optional): Max results (default: "10")
- **saveTo** (required): Variable for results (JSON array)

#### note-list
List notes in folder.
- **folder** (optional): Folder path (empty for root)
- **recursive** (optional): "true"/"false"
- **tags** (optional): Comma-separated tags
- **tagMatch** (optional): "any"/"all"
- **createdWithin** / **modifiedWithin** (optional): e.g., "7d", "30m", "2h"
- **sortBy** (optional): "modified", "created", "name"
- **sortOrder** (optional): "desc", "asc"
- **limit** (optional): Max results (default: "50")
- **saveTo** (required): Variable for results

**Result structure**:
\`\`\`json
{
  "notes": [{ "name": "note1", "path": "folder/note1.md", "created": 1234567890, "modified": 1234567890, "tags": ["#tag1"] }],
  "count": 1,
  "totalCount": 10,
  "hasMore": true
}
\`\`\`
Access: \`{{fileList.notes[0].path}}\`, \`{{fileList.count}}\`, \`{{fileList.notes[index].path}}\`

#### folder-list
List folders.
- **folder** (optional): Parent folder (empty for all)
- **saveTo** (required): Variable for results

**Result structure**: \`{ "folders": ["parent/subfolder", "parent/other"], "count": 2 }\`

### File Operations

#### file-explorer
Select file from vault or enter new path.
- **path** (optional): Direct file path - skips dialog when set (supports {{variables}})
- **mode** (optional): "select" (default) or "create"
- **title** (optional): Dialog title
- **extensions** (optional): Comma-separated extensions (e.g., "pdf,png,jpg")
- **default** (optional): Default path (supports {{variables}})
- **saveTo** (optional): Variable for FileExplorerData
- **savePathTo** (optional): Variable for file path only

#### file-save
Save FileExplorerData as file.
- **source** (required): Variable containing FileExplorerData
- **path** (required): Path to save (extension auto-added if missing)
- **savePathTo** (optional): Variable for final file path

#### open
Open file in editor.
- **path** (required): File path (supports {{variables}})

### User Interaction

#### dialog
Show dialog with options and optional text input.
- **title** (optional): Dialog title
- **message** (optional): Message content
- **markdown** (optional): "true"/"false" - render as Markdown (default: "false")
- **options** (optional): Comma-separated options for checkboxes/radio
- **multiSelect** (optional): "true"/"false" (default: "false")
- **inputTitle** (optional): Label for text input field
- **multiline** (optional): "true"/"false" for text area (default: "false")
- **defaults** (optional): JSON, e.g., '{"input": "text", "selected": ["opt1"]}'
- **button1** (optional): Primary button text (default: "OK")
- **button2** (optional): Secondary button text
- **saveTo** (optional): Variable for result JSON object with:
  - **button**: string - the button that was clicked
  - **selected**: string[] - ALWAYS an array of selected options
  - **input**: string - text input value (if inputTitle was set)

#### prompt-file
Prompt user to select file and read its content.
- **title** (optional): Dialog title
- **default** (optional): Default path
- **forcePrompt** (optional): "true" to always show picker (default: "false")
- **saveTo** (required): Variable for file content
- **saveFileTo** (optional): Variable for file info (path, basename, name, extension)

#### prompt-selection
Prompt user to select text from a file.
- **saveTo** (required): Variable for selected text
- **saveSelectionTo** (optional): Variable for selection metadata

### Integration

#### workflow
Execute sub-workflow.
- **path** (required): Workflow file path
- **name** (optional): Workflow name (if file has multiple)
- **input** (optional): JSON mapping, e.g., '{"subVar": "{{parentVar}}"}'
- **output** (optional): JSON mapping, e.g., '{"parentVar": "subVar"}'
- **prefix** (optional): Prefix for all imported variables

#### rag-sync
Sync notes to RAG store. If path is specified, syncs a single file (fast). Without path, triggers a full sync.
- **path** (optional): Note path to sync (supports {{variables}}). Omit for full sync.
- **oldPath** (optional): Previous file path to remove from index (for renames)
- **saveTo** (optional): Variable for result

#### obsidian-command
Execute Obsidian command.
- **command** (required): Command ID (e.g., "editor:toggle-fold")
- **path** (optional): File to open before executing (supports {{variables}})
- **saveTo** (optional): Variable for result { commandId, path, executed, timestamp }

### Data Processing

#### script
Execute JavaScript code in a sandboxed environment (no DOM, network, or storage access). Useful for string manipulation, data transformation, calculations, and encoding/decoding that the set node cannot handle.
- **code** (required): JavaScript code (supports {{variables}}). Use \`return\` to return a value. Non-string return values are JSON-serialized.
- **saveTo** (optional): Variable for the result
- **timeout** (optional): Timeout in milliseconds (default: "10000")

Example — split and sort a comma-separated list:
\`\`\`yaml
- id: sort-items
  type: script
  code: |
    var items = '{{rawList}}'.split(',').map(function(s){ return s.trim(); });
    items.sort();
    return items.join('\\n');
  saveTo: sortedList
\`\`\`

Example — Base64 encode:
\`\`\`yaml
- id: encode
  type: script
  code: "return btoa('{{plainText}}')"
  saveTo: encoded
\`\`\`

#### json
Parse JSON string.
- **source** (required): Variable containing JSON string
- **saveTo** (required): Variable for parsed object

## Control Flow

### Sequential Flow
Nodes execute in order. Use **next** to jump:
\`\`\`yaml
- id: step1
  type: command
  prompt: "Do something"
  next: step3
\`\`\`

### Back-Reference Rule
**Important**: The \`next\` property can only reference earlier nodes if the target is a **while** node.

### Termination
Use "end" to explicitly terminate: \`next: end\`

## Complete Loop Example
\`\`\`yaml
name: process-all-notes
nodes:
  - id: init-index
    type: variable
    name: "index"
    value: "0"
  - id: list-files
    type: note-list
    folder: "my-folder"
    recursive: "true"
    saveTo: "fileList"
  - id: loop
    type: while
    condition: "{{index}} < {{fileList.count}}"
    trueNext: read-note
    falseNext: finish
  - id: read-note
    type: note-read
    path: "{{fileList.notes[index].path}}"
    saveTo: "content"
  - id: process
    type: command
    prompt: "Process: {{content}}"
    saveTo: "result"
  - id: increment
    type: set
    name: "index"
    value: "{{index}} + 1"
    next: loop
  - id: finish
    type: dialog
    title: "Done"
    message: "Processed {{index}} files"
\`\`\`

## Best Practices
1. Use descriptive node IDs (e.g., "read-input", "process-data", "save-result")
2. Initialize variables before use with variable node
3. Use prompt nodes for user input when needed
4. Use dialog for confirmations with options
5. Use confirm: "true" for destructive note operations
6. Always specify saveTo for nodes that produce output
7. Use meaningful workflow names
8. **One task per command node**: Each command node should request ONE task only
9. **Use comment field**: Add a \`comment\` property to nodes to describe their purpose
`;
}

export const WORKFLOW_SPECIFICATION = getWorkflowSpecification();
