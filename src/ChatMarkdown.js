import { createElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Keep remote images from making unsolicited requests while preserving their alt text.
const components = { img: ({ alt }) => createElement('span', null, alt) };

/** Render assistant responses as Markdown without interpreting raw HTML. */
export function ChatMarkdown({ content }) {
  return createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], skipHtml: true, components }, content);
}
