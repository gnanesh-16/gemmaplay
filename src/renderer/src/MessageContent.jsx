import { useState } from 'react';
import hljs from 'highlight.js';

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function highlight(code, lang) {
  try {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    }
    return hljs.highlightAuto(code).value;
  } catch {
    return escapeHtml(code);
  }
}

// Splits streamed markdown-ish text into plain-text and fenced-code segments.
// The closing ``` is optional so an in-progress code block still renders while streaming.
function parseSegments(text) {
  const parts = [];
  const fence = /```(\w+)?\n?([\s\S]*?)(?:```|$)/g;
  let lastIndex = 0;
  let match;
  while ((match = fence.exec(text))) {
    if (match.index > lastIndex) parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    parts.push({ type: 'code', lang: match[1] || '', content: match[2] });
    lastIndex = fence.lastIndex;
  }
  if (lastIndex < text.length) parts.push({ type: 'text', content: text.slice(lastIndex) });
  return parts;
}

function TextSegment({ content }) {
  const bits = content.split(/(`[^`\n]+`)/g);
  return bits.map((bit, i) =>
    bit.startsWith('`') && bit.endsWith('`') && bit.length > 1
      ? <code key={i} className="inline-code">{bit.slice(1, -1)}</code>
      : <span key={i}>{bit}</span>
  );
}

function CodeBlock({ lang, content }) {
  const [copied, setCopied] = useState(false);
  const html = highlight(content, lang);

  async function handleCopy() {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="msg-code">
      <div className="msg-code-head">
        <span>{lang || 'text'}</span>
        <button className="msg-code-copy" title="Copy code" onClick={handleCopy}>
          {copied ? 'Copied ✓' : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          )}
        </button>
      </div>
      <pre><code dangerouslySetInnerHTML={{ __html: html }} /></pre>
    </div>
  );
}

export default function MessageContent({ content }) {
  const segments = parseSegments(content);
  return segments.map((seg, i) =>
    seg.type === 'code'
      ? <CodeBlock key={i} lang={seg.lang} content={seg.content} />
      : <TextSegment key={i} content={seg.content} />
  );
}
