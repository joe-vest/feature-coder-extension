export interface Frontmatter {
  [key: string]: any;
}

export function parseFrontmatter(
  content: string
): { frontmatter: Frontmatter; body: string } {
  if (!content.startsWith("---")) {
    return { frontmatter: {}, body: content };
  }

  const end = content.indexOf("\n---", 3);
  if (end === -1) {
    return { frontmatter: {}, body: content };
  }

  const raw = content.slice(3, end).trim();
  const body = content.slice(end + 4); // skip \n---

  const frontmatter: Frontmatter = {};
  for (const line of raw.split(/\r?\n/)) {
    const [k, ...rest] = line.split(":");
    if (!k || rest.length === 0) continue;
    frontmatter[k.trim()] = rest.join(":").trim();
  }

  return { frontmatter, body };
}

export function updateFrontmatter(
  content: string,
  updates: Frontmatter
): string {
  const { frontmatter, body } = parseFrontmatter(content);
  const merged = { ...frontmatter, ...updates };

  const lines = Object.entries(merged).map(
    ([k, v]) => `${k}: ${String(v)}`
  );

  return `---\n${lines.join("\n")}\n---\n${body.trimStart()}\n`;
}
