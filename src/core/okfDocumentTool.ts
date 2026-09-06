// The read_okf_document tool lives in the shared library. Local models are told about
// tools in the OpenAI wire shape, so the shared definition is wrapped rather than copied.
import { READ_OKF_DOCUMENT_TOOL as SHARED_READ_OKF_DOCUMENT_TOOL } from "obsidian-llm-hub-common/skills";
import type { ToolDefinition } from "src/types";

export {
  READ_OKF_DOCUMENT_TOOL_NAME,
  executeReadOkfDocumentTool,
} from "obsidian-llm-hub-common/skills";

export const READ_OKF_DOCUMENT_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: SHARED_READ_OKF_DOCUMENT_TOOL.name,
    description: SHARED_READ_OKF_DOCUMENT_TOOL.description,
    parameters: SHARED_READ_OKF_DOCUMENT_TOOL.parameters,
  },
};
