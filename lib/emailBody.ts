/**
 * Campaign / template bodies are typed text where a blank line starts a new
 * block and a block that is just "# Heading" (or ## / ###) becomes a heading.
 * A heading line written straight above its paragraph, with no blank line
 * between ("## A customer favorite\nGold Standard…"), used to come out as
 * literal "## " text inside the paragraph. This puts every heading line in a
 * block of its own, so it always renders (and shows in Arrange) as a heading.
 * Bodies with no such heading come back unchanged.
 */
const HEADING_LINE = /^\s*#{1,3}\s+\S/;

export function separateHeadings(raw: string): string {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  if (!lines.some((l) => HEADING_LINE.test(l))) return raw;
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (!HEADING_LINE.test(line)) {
      out.push(line);
      return;
    }
    if (out.length && out[out.length - 1].trim() !== "") out.push("");
    out.push(line.trim());
    const next = lines[i + 1];
    if (next !== undefined && next.trim() !== "") out.push("");
  });
  return out.join("\n");
}
