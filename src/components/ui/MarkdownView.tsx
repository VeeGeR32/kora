import React from 'react';

interface MarkdownViewProps {
  content: string;
  className?: string;
}

function renderInline(text: string): React.ReactNode[] {
  const tokens: React.ReactNode[] = [];
  // Matches: **bold**, *italic*, `code`, [label](url)
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }
    const raw = match[0];
    if (raw.startsWith('**') && raw.endsWith('**')) {
      tokens.push(
        <strong key={key++} className="font-semibold text-slate-950 dark:text-white">
          {raw.slice(2, -2)}
        </strong>
      );
    } else if (raw.startsWith('*') && raw.endsWith('*')) {
      tokens.push(
        <em key={key++} className="italic">
          {raw.slice(1, -1)}
        </em>
      );
    } else if (raw.startsWith('`') && raw.endsWith('`')) {
      tokens.push(
        <code
          key={key++}
          className="rounded-md bg-black/8 dark:bg-white/10 px-1.5 py-0.5 font-mono text-[11px]"
        >
          {raw.slice(1, -1)}
        </code>
      );
    } else if (raw.startsWith('[')) {
      const m = raw.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      if (m) {
        tokens.push(
          <a
            key={key++}
            href={m[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-[#FF5500]/60 underline-offset-2 hover:text-[#FF5500]"
          >
            {m[1]}
          </a>
        );
      } else {
        tokens.push(raw);
      }
    }
    lastIndex = re.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }
  return tokens;
}

export function MarkdownView({ content, className = '' }: MarkdownViewProps) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.trim().startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      blocks.push(
        <pre
          key={k++}
          className="my-2 overflow-x-auto rounded-xl bg-slate-900 text-zinc-100 p-2.5 font-mono text-[11px] leading-relaxed"
        >
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // Blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      blocks.push(<hr key={k++} className="my-2 border-slate-200/80 dark:border-zinc-700/80" />);
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const cls =
        level === 1
          ? 'text-sm font-bold mt-2 mb-1'
          : level === 2
          ? 'text-[13px] font-semibold mt-2 mb-1'
          : 'text-xs font-semibold mt-1.5 mb-0.5';
      blocks.push(
        <p key={k++} className={cls}>
          {renderInline(headingMatch[2])}
        </p>
      );
      i++;
      continue;
    }

    // Unordered list
    if (/^[-*•]\s+/.test(line.trim())) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={k++} className="my-1.5 space-y-1 pl-4 list-disc marker:text-[#FF5500]">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line.trim())) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push(
        <ol key={k++} className="my-1.5 space-y-1 pl-4 list-decimal marker:text-[#FF5500]">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Paragraph (collect contiguous plain lines)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith('```') &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^[-*•]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      !/^---+$/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={k++} className="my-1 leading-relaxed">
        {paraLines.map((pl, idx) => (
          <React.Fragment key={idx}>
            {idx > 0 && <br />}
            {renderInline(pl)}
          </React.Fragment>
        ))}
      </p>
    );
  }

  return <div className={`text-xs ${className}`}>{blocks}</div>;
}
