export const EVENT_VARIABLE_ALIASES = {
  _eventType: ["_eventType", "__eventType__"],
  _eventFilePath: ["_eventFilePath", "__eventFilePath__"],
  _eventFile: ["_eventFile", "__eventFile__"],
  _eventOldPath: ["_eventOldPath", "__eventOldPath__"],
  _eventFileContent: ["_eventFileContent", "__eventFileContent__"],
} as const;

export const ALL_EVENT_VARIABLE_NAMES = Object.values(EVENT_VARIABLE_ALIASES).flat();

type VariableMap = Map<string, unknown>;
type EventVariableName = keyof typeof EVENT_VARIABLE_ALIASES;

export function getEventVariable(
  variables: VariableMap,
  name: EventVariableName,
): unknown {
  for (const alias of EVENT_VARIABLE_ALIASES[name]) {
    const value = variables.get(alias);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

export function setEventVariable(
  variables: VariableMap,
  name: EventVariableName,
  value: unknown,
): void {
  for (const alias of EVENT_VARIABLE_ALIASES[name]) {
    variables.set(alias, value);
  }
}
