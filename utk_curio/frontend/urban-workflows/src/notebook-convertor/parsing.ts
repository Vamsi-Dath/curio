export function replaceKeywordsOutsideStrings(text: string, replacements: Record<string, string>): string {
  const keys = Object.keys(replacements).sort((a, b) => b.length - a.length);
  let result = "";
  let index = 0;
  let inString = false;
  let quoteChar = "";

  const isIdentifierChar = (char: string | undefined): boolean => {
    if (!char) {
      return false;
    }

    const code = char.charCodeAt(0);
    return (
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      char === "_"
    );
  };

  while (index < text.length) {
    const char = text[index];

    if (inString) {
      result += char;

      if (char === "\\") {
        index += 1;
        if (index < text.length) {
          result += text[index];
        }
      } else if (char === quoteChar) {
        inString = false;
        quoteChar = "";
      }

      index += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quoteChar = char;
      result += char;
      index += 1;
      continue;
    }

    let replaced = false;

    for (const key of keys) {
      if (!text.startsWith(key, index)) {
        continue;
      }

      const prev = index > 0 ? text[index - 1] : undefined;
      const next = index + key.length < text.length ? text[index + key.length] : undefined;

      if (isIdentifierChar(prev) || isIdentifierChar(next)) {
        continue;
      }

      result += replacements[key];
      index += key.length;
      replaced = true;
      break;
    }

    if (!replaced) {
      result += char;
      index += 1;
    }
  }

  return result;
}

export function deindentText(text: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.startsWith(prefix) ? line.slice(spaces) : line))
    .join("\n");
}

export function stripGeneratedNodePrelude(code: string): string {
  const lines = code.split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();

    if (line.startsWith("input_") && line.includes(" = ")) {
      index += 1;
      continue;
    }

    if (line.startsWith("arg = ")) {
      index += 1;
      continue;
    }

    break;
  }

  let end = lines.length;

  while (end > index) {
    const line = lines[end - 1].trim();

    if (line === "return input_data") {
      end -= 1;
      continue;
    }

    if (line === "") {
      end -= 1;
      continue;
    }

    break;
  }

  return lines.slice(index, end).join("\n").trimEnd();
}

export function extractVegaLiteSpecCode(code: string): string {
  const specAssignMarker = "spec =";
  const specAssignStart = code.indexOf(specAssignMarker);

  if (specAssignStart < 0) {
    return code;
  }

  const objectStart = code.indexOf("{", specAssignStart);
  if (objectStart < 0) {
    return code;
  }

  let depth = 0;
  let objectEnd = -1;

  for (let index = objectStart; index < code.length; index += 1) {
    const char = code[index];

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        objectEnd = index;
        break;
      }
    }
  }

  if (objectEnd < 0) {
    return code;
  }

  return code.slice(objectStart, objectEnd + 1).trim();
}

export function extractUtkSpecCode(code: string): string {
  const markers = ["grammar =", "utk_spec =", "utk_grammar ="];
  let specAssignStart = -1;

  for (const marker of markers) {
    const index = code.indexOf(marker);
    if (index >= 0) {
      specAssignStart = index;
      break;
    }
  }

  if (specAssignStart < 0) {
    return code;
  }

  const objectStart = code.indexOf("{", specAssignStart);
  if (objectStart < 0) {
    return code;
  }

  let depth = 0;
  let objectEnd = -1;

  for (let index = objectStart; index < code.length; index += 1) {
    const char = code[index];

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        objectEnd = index;
        break;
      }
    }
  }

  if (objectEnd < 0) {
    return code;
  }

  return code.slice(objectStart, objectEnd + 1).trim();
}

function isSimpleVariableName(value: string): boolean {
  if (!value) {
    return false;
  }

  const first = value.charCodeAt(0);
  const startsWithLetterOrUnderscore =
    value[0] === "_" ||
    (first >= 65 && first <= 90) ||
    (first >= 97 && first <= 122);

  if (!startsWithLetterOrUnderscore) {
    return false;
  }

  for (let i = 1; i < value.length; i += 1) {
    const char = value[i];
    const code = value.charCodeAt(i);
    const isAlphaNum =
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57);
    if (!(isAlphaNum || char === "_")) {
      return false;
    }
  }

  return true;
}

export function extractInputVariables(code: string): string[] {
  const variables: string[] = [];
  const lines = code.split("\n");
  let inInputsBlock = false;

  const pushIfSimpleVariable = (value: string): void => {
    const normalized = value.trim().replace(/,$/, "");
    if (isSimpleVariableName(normalized)) {
      variables.push(normalized);
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (inInputsBlock) {
      const closeIndex = line.indexOf("]");
      if (closeIndex >= 0) {
        const token = line.slice(0, closeIndex).trim();
        if (token.length > 0) {
          pushIfSimpleVariable(token);
        }
        inInputsBlock = false;
        continue;
      }

      if (line.length > 0) {
        pushIfSimpleVariable(line);
      }
      continue;
    }

    if (line.startsWith("inputs = [")) {
      const afterBracket = line.slice("inputs = [".length).trim();
      const closeIndex = afterBracket.indexOf("]");

      if (closeIndex >= 0) {
        const token = afterBracket.slice(0, closeIndex).trim();
        if (token.length > 0) {
          pushIfSimpleVariable(token);
        }
      } else {
        if (afterBracket.length > 0) {
          pushIfSimpleVariable(afterBracket);
        }
        inInputsBlock = true;
      }
      continue;
    }

    if (line.startsWith("input_") && line.includes(" = ")) {
      const rhs = line.slice(line.indexOf("=") + 1).trim();
      pushIfSimpleVariable(rhs);
    }

    if (line.startsWith("input_data = ")) {
      const rhs = line.slice("input_data = ".length).trim();
      pushIfSimpleVariable(rhs);
    }
  }

  return Array.from(new Set(variables));
}

export function extractProducedVariables(code: string): string[] {
  const variables: string[] = [];
  const lines = code.split("\n");
  let primaryVar = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.endsWith("= _curio_output")) {
      const lhs = line.slice(0, line.indexOf("=")).trim();
      if (isSimpleVariableName(lhs)) {
        primaryVar = lhs;
        variables.push(lhs);
      }
      continue;
    }

    if (primaryVar && line.endsWith(`= ${primaryVar}`)) {
      const lhs = line.slice(0, line.indexOf("=")).trim();
      if (isSimpleVariableName(lhs)) {
        variables.push(lhs);
      }
    }
  }

  return Array.from(new Set(variables));
}
