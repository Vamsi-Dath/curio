export function extractAssignedObjectLiteral(code: string, variableName: string): string | null {
  const assignmentPattern = new RegExp(`${variableName}\\s*=`);
  const assignmentMatch = assignmentPattern.exec(code);
  if (!assignmentMatch) {
    return null;
  }

  const assignmentStart = assignmentMatch.index + assignmentMatch[0].length;
  const objectStart = code.indexOf("{", assignmentStart);
  if (objectStart < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let quoteChar = "";

  for (let index = objectStart; index < code.length; index += 1) {
    const char = code[index];

    if (inString) {
      if (char === "\\") {
        index += 1;
        continue;
      }

      if (char === quoteChar) {
        inString = false;
        quoteChar = "";
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quoteChar = char;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return code.slice(objectStart, index + 1);
      }
    }
  }

  return null;
}

function removeAssignedObjectVariable(text: string, variableName: string): string {
  const assignmentPattern = new RegExp(`${variableName}\\s*=`);
  const assignmentMatch = assignmentPattern.exec(text);
  if (!assignmentMatch) {
    return text;
  }

  const objectStart = text.indexOf("{", assignmentMatch.index + assignmentMatch[0].length);
  if (objectStart < 0) {
    return text;
  }

  let depth = 0;
  let inString = false;
  let quoteChar = "";
  let objectEnd = -1;

  for (let index = objectStart; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (char === "\\") {
        index += 1;
        continue;
      }

      if (char === quoteChar) {
        inString = false;
        quoteChar = "";
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quoteChar = char;
      continue;
    }

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
    return text;
  }

  let endIndex = objectEnd + 1;
  while (endIndex < text.length && (text[endIndex] === "\n" || text[endIndex] === "\r")) {
    endIndex += 1;
  }

  return text.slice(0, assignmentMatch.index) + text.slice(endIndex);
}

export function removeAssignedObjectVariables(code: string, variableNames: string[]): string {
  return variableNames.reduce((current, variableName) => removeAssignedObjectVariable(current, variableName), code);
}
