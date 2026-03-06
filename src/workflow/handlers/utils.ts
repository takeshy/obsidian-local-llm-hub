import { ExecutionContext, ParsedCondition, ComparisonOperator } from "../types";

/**
 * Error thrown when user requests content regeneration from a note confirmation dialog
 * The executor should catch this and re-run the previous command node
 */
export class RegenerateRequestError extends Error {
  constructor(message: string = "Regeneration requested") {
    super(message);
    this.name = "RegenerateRequestError";
  }
}

// Get value from object/JSON string using dot notation path
export function getNestedValue(data: unknown, path: string, context?: ExecutionContext): unknown {
  const parts = path.split(".");
  let current: unknown = data;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }

    // Handle array index notation like "items[0]" or "items[index]"
    const arrayMatch = part.match(/^(\w+)\[(\w+)\]$/);
    if (arrayMatch) {
      current = (current as Record<string, unknown>)[arrayMatch[1]];
      if (Array.isArray(current)) {
        const indexStr = arrayMatch[2];
        let indexValue: number;
        if (/^\d+$/.test(indexStr)) {
          indexValue = parseInt(indexStr, 10);
        } else if (context) {
          const resolvedIndex = context.variables.get(indexStr);
          if (resolvedIndex === undefined) {
            return undefined;
          }
          indexValue = typeof resolvedIndex === "number"
            ? resolvedIndex
            : parseInt(String(resolvedIndex), 10);
          if (isNaN(indexValue)) {
            return undefined;
          }
        } else {
          return undefined;
        }
        current = current[indexValue];
      } else {
        return undefined;
      }
    } else {
      current = (current as Record<string, unknown>)[part];
    }
  }

  return current;
}

// JSON-escape a string value (for embedding in JSON strings)
export function jsonEscapeString(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

// Replace {{variable}} or {{variable.path.to.value}} placeholders with actual values
export function replaceVariables(
  template: string,
  context: ExecutionContext
): string {
  let result = template;
  let previousResult = "";
  let iterations = 0;
  const maxIterations = 10;

  while (result !== previousResult && iterations < maxIterations) {
    previousResult = result;
    iterations++;

    result = result.replace(/\{\{([\w.[\]]+)(:json)?\}\}/g, (match, fullPath, jsonModifier) => {
    const shouldJsonEscape = jsonModifier === ":json";
    const dotIndex = fullPath.indexOf(".");
    const bracketIndex = fullPath.indexOf("[");
    const firstSpecialIndex = Math.min(
      dotIndex === -1 ? Infinity : dotIndex,
      bracketIndex === -1 ? Infinity : bracketIndex
    );

    if (firstSpecialIndex === Infinity) {
      const value = context.variables.get(fullPath);
      if (value !== undefined) {
        const strValue = String(value);
        return shouldJsonEscape ? jsonEscapeString(strValue) : strValue;
      }
      return match;
    }

    const varName = fullPath.substring(0, firstSpecialIndex);
    const restPath = fullPath.substring(
      firstSpecialIndex + (fullPath[firstSpecialIndex] === "." ? 1 : 0)
    );

    const varValue = context.variables.get(varName);
    if (varValue === undefined) {
      return match;
    }

    let parsedValue: unknown;
    if (typeof varValue === "string") {
      try {
        let jsonString = varValue;
        const codeBlockMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) {
          jsonString = codeBlockMatch[1].trim();
        }
        parsedValue = JSON.parse(jsonString);
      } catch {
        return match;
      }
    } else {
      parsedValue = varValue;
    }

    const pathToNavigate =
      fullPath[firstSpecialIndex] === "["
        ? fullPath.substring(varName.length)
        : restPath;

    if (fullPath[firstSpecialIndex] === "[") {
      const arrayMatch = pathToNavigate.match(/^\[(\w+)\](.*)$/);
      if (arrayMatch && Array.isArray(parsedValue)) {
        let indexValue: number;
        const indexStr = arrayMatch[1];
        if (/^\d+$/.test(indexStr)) {
          indexValue = parseInt(indexStr, 10);
        } else {
          const resolvedIndex = context.variables.get(indexStr);
          if (resolvedIndex === undefined) {
            return match;
          }
          indexValue = typeof resolvedIndex === "number"
            ? resolvedIndex
            : parseInt(String(resolvedIndex), 10);
          if (isNaN(indexValue)) {
            return match;
          }
        }

        let result: unknown = parsedValue[indexValue];
        if (arrayMatch[2]) {
          const remainingPath = arrayMatch[2].startsWith(".")
            ? arrayMatch[2].substring(1)
            : arrayMatch[2];
          if (remainingPath) {
            result = getNestedValue(result, remainingPath, context);
          }
        }
        if (result !== undefined) {
          let strResult: string;
          if (typeof result === "object") {
            strResult = JSON.stringify(result);
          } else if (typeof result === "string" || typeof result === "number" || typeof result === "boolean") {
            strResult = String(result);
          } else {
            strResult = JSON.stringify(result);
          }
          return shouldJsonEscape ? jsonEscapeString(strResult) : strResult;
        }
      }
      return match;
    }

    const nestedValue = getNestedValue(parsedValue, restPath, context);
    if (nestedValue !== undefined) {
      let strResult: string;
      if (typeof nestedValue === "object") {
        strResult = JSON.stringify(nestedValue);
      } else if (typeof nestedValue === "string" || typeof nestedValue === "number" || typeof nestedValue === "boolean") {
        strResult = String(nestedValue);
      } else {
        strResult = JSON.stringify(nestedValue);
      }
      return shouldJsonEscape ? jsonEscapeString(strResult) : strResult;
    }

    return match;
    });
  }

  return result;
}

// Parse a simple condition expression
export function parseCondition(condition: string): ParsedCondition | null {
  const operators: ComparisonOperator[] = [
    "==",
    "!=",
    "<=",
    ">=",
    "<",
    ">",
    "contains",
  ];

  for (const op of operators) {
    const parts = condition.split(op);
    if (parts.length === 2) {
      return {
        left: parts[0].trim(),
        operator: op,
        right: parts[1].trim(),
      };
    }
  }

  return null;
}

// Evaluate a parsed condition
export function evaluateCondition(
  condition: ParsedCondition,
  context: ExecutionContext
): boolean {
  let left = replaceVariables(condition.left, context);
  let right = replaceVariables(condition.right, context);

  left = left.replace(/^["'](.*)["']$/, "$1");
  right = right.replace(/^["'](.*)["']$/, "$1");

  const leftNum = parseFloat(left);
  const rightNum = parseFloat(right);
  const bothNumbers = !isNaN(leftNum) && !isNaN(rightNum);

  switch (condition.operator) {
    case "==":
      return bothNumbers ? leftNum === rightNum : left === right;
    case "!=":
      return bothNumbers ? leftNum !== rightNum : left !== right;
    case "<":
      return bothNumbers ? leftNum < rightNum : left < right;
    case ">":
      return bothNumbers ? leftNum > rightNum : left > right;
    case "<=":
      return bothNumbers ? leftNum <= rightNum : left <= right;
    case ">=":
      return bothNumbers ? leftNum >= rightNum : left >= right;
    case "contains":
      try {
        const leftParsed = JSON.parse(left);
        if (Array.isArray(leftParsed)) {
          return leftParsed.includes(right);
        }
      } catch {
        // Not JSON, fall through to string check
      }
      return left.includes(right);
    default:
      return false;
  }
}

// Increment a numeric variable
export function incrementVariable(
  varName: string,
  context: ExecutionContext,
  amount: number = 1
): void {
  const current = context.variables.get(varName);
  if (typeof current === "number") {
    context.variables.set(varName, current + amount);
  } else if (typeof current === "string") {
    const num = parseFloat(current);
    if (!isNaN(num)) {
      context.variables.set(varName, num + amount);
    }
  }
}
