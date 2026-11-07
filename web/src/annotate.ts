import type { Element, ElementContent, Root, RootContent } from "hast";

export interface Highlight {
  startLine: number;
  endLine: number;
  active: boolean;
}

const BLOCKS = new Set([
  "p",
  "li",
  "ul",
  "ol",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "pre",
  "blockquote",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
  "hr",
  "div",
  "section",
]);

function lineRange(node: Element): [number, number] | null {
  const position = node.position;
  return position ? [position.start.line, position.end.line] : null;
}

function overlaps([start, end]: [number, number], h: Highlight): boolean {
  return h.startLine <= end && h.endLine >= start;
}

function blockChildren(node: Element): Element[] {
  return node.children.filter(
    (child): child is Element => child.type === "element" && BLOCKS.has(child.tagName),
  );
}

/**
 * Highlights the most specific blocks covered by each comment: a block fully inside a comment's
 * range is highlighted whole, otherwise we descend into its child blocks.
 */
function highlight(node: Element, highlights: Highlight[]): void {
  const range = lineRange(node);
  if (!range) return;
  const hits = highlights.filter((h) => overlaps(range, h));
  if (hits.length === 0) return;

  const contained = hits.filter((h) => h.startLine <= range[0] && h.endLine >= range[1]);
  const children = blockChildren(node).filter((child) => {
    const childRange = lineRange(child);
    return childRange && hits.some((h) => overlaps(childRange, h));
  });

  if (contained.length > 0 || children.length === 0) {
    const classes = ["hl"];
    if (hits.some((h) => h.active)) classes.push("hl-active");
    node.properties.className = [
      ...((node.properties.className as string[] | undefined) ?? []),
      ...classes,
    ];
    return;
  }
  for (const child of children) highlight(child, hits);
}

function visit(
  nodes: (RootContent | ElementContent)[],
  highlights: Highlight[],
  topLevel: boolean,
): void {
  for (const [index, node] of nodes.entries()) {
    if (node.type === "raw") {
      // Show raw HTML from the document as literal text rather than rendering it.
      nodes[index] = { type: "text", value: node.value };
      continue;
    }
    if (node.type !== "element") continue;
    const range = lineRange(node);
    if (range) {
      node.properties.dataSl = range[0];
      node.properties.dataEl = range[1];
    }
    visit(node.children, highlights, false);
    if (topLevel) highlight(node, highlights);
  }
}

/** Rehype plugin: tags elements with their source line range and highlights commented blocks. */
export function rehypeAnnotate(options: { highlights: Highlight[] }) {
  return (tree: Root) => visit(tree.children, options.highlights, true);
}
