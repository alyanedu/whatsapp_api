const tokenPattern = /{{\s*([a-zA-Z0-9_.-]+)\s*}}/g;

export function renderTemplate(template, variables) {
  return template.replace(tokenPattern, (match, key) => {
    const value = variables[key];
    if (value === undefined || value === null) return match;
    return String(value);
  });
}

export function findMissingVariables(template, variables) {
  const missing = new Set();
  for (const match of template.matchAll(tokenPattern)) {
    const key = match[1];
    if (variables[key] === undefined || variables[key] === null) {
      missing.add(key);
    }
  }
  return [...missing];
}