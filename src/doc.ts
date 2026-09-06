/**
 * Renders the "How it works" notes: Markdown with LaTeX maths.
 * Maths is pulled out before Markdown parsing so underscores and backslashes
 * inside formulas survive, then put back as KaTeX output.
 */

import { marked } from 'marked';
import katex from 'katex';
import 'katex/dist/katex.min.css';

export function renderDoc(src: string): string {
  const math: string[] = [];
  const keep = (tex: string, display: boolean) => {
    math.push(katex.renderToString(tex.trim(), { displayMode: display, throwOnError: false }));
    return ` MATH${math.length - 1} `;
  };
  let text = src.replace(/\$\$([\s\S]+?)\$\$/g, (_, body: string) => keep(body, true));
  text = text.replace(/(^|[^\\$\w])\$([^\n$]+?)\$(?!\w)/g, (_, pre: string, body: string) => pre + keep(body, false));
  const html = marked.parse(text, { gfm: true }) as string;
  return html.replace(/ MATH(\d+) /g, (_, i) => math[Number(i)]).replace(/<p>(<span class="katex-display">[\s\S]*?<\/span>)<\/p>/g, '$1');
}
