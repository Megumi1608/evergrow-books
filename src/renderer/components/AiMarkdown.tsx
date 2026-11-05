import { Fragment, useMemo, type ReactNode } from 'react';

function safeUrl(value: string): string | null {
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern =
    /(`[^`\n]+`|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\*[^*\n]+\*|\[[^\]\n]+\]\([^)\s]+\)|https?:\/\/[^\s)]+)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;
    if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('~~')) {
      nodes.push(<del key={key}>{token.slice(2, -2)}</del>);
    } else if (token.startsWith('*')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const href = link ? safeUrl(link[2]) : null;
      nodes.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noreferrer">
            {link![1]}
          </a>
        ) : (
          token
        ),
      );
    } else {
      const href = safeUrl(token);
      nodes.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noreferrer">
            {token}
          </a>
        ) : (
          token
        ),
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function inlineLines(text: string, keyPrefix: string): ReactNode[] {
  const lines = text.split('\n');
  return lines.map((line, index) => (
    <Fragment key={`${keyPrefix}-line-${index}`}>
      {index > 0 ? <br /> : null}
      {renderInline(line, `${keyPrefix}-${index}`)}
    </Fragment>
  ));
}

function splitRow(line: string): string[] {
  let value = line.trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|')) value = value.slice(0, -1);
  return value.split('|').map((cell) => cell.trim());
}

function isSeparator(line: string): boolean {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

function isTableStart(lines: string[], index: number): boolean {
  return lines[index].includes('|') && index + 1 < lines.length && isSeparator(lines[index + 1]);
}

function tableAlign(cell: string): 'left' | 'center' | 'right' {
  if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
  if (cell.endsWith(':')) return 'right';
  return 'left';
}

function isSpecialLine(lines: string[], index: number): boolean {
  const line = lines[index];
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('```')) return true;
  if (/^#{1,6}\s+/.test(trimmed)) return true;
  if (/^([-*_])\1{2,}$/.test(trimmed)) return true;
  if (isTableStart(lines, index)) return true;
  if (/^[-*+]\s+/.test(trimmed)) return true;
  if (/^\d+[.)]\s+/.test(trimmed)) return true;
  if (/^>\s?/.test(trimmed)) return true;
  return false;
}

function parseMarkdown(text: string): ReactNode[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;
  let blockKey = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre key={`pre-${blockKey++}`}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      blocks.push(
        <div className={`ai-md-heading ai-md-h${Math.min(heading[1].length, 4)}`} key={`h-${blockKey++}`}>
          {renderInline(heading[2], `h-${blockKey}`)}
        </div>,
      );
      index += 1;
      continue;
    }

    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      blocks.push(<hr key={`hr-${blockKey++}`} />);
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const header = splitRow(lines[index]);
      const separator = splitRow(lines[index + 1]);
      const aligns = separator.map(tableAlign);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(splitRow(lines[index]));
        index += 1;
      }
      blocks.push(
        <div className="ai-md-table-wrap" key={`table-${blockKey++}`}>
          <table className="ai-md-table">
            <thead>
              <tr>
                {header.map((cell, cellIndex) => (
                  <th className={`align-${aligns[cellIndex] ?? 'left'}`} key={`th-${cellIndex}`}>
                    {renderInline(cell, `th-${cellIndex}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`tr-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td className={`align-${aligns[cellIndex] ?? 'left'}`} key={`td-${rowIndex}-${cellIndex}`}>
                      {renderInline(cell, `td-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*+]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*+]\s+/, ''));
        index += 1;
      }
      blocks.push(
        <ul key={`ul-${blockKey++}`}>
          {items.map((item, itemIndex) => (
            <li key={`li-${itemIndex}`}>{renderInline(item, `ul-${blockKey}-${itemIndex}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+[.)]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+[.)]\s+/, ''));
        index += 1;
      }
      blocks.push(
        <ol key={`ol-${blockKey++}`}>
          {items.map((item, itemIndex) => (
            <li key={`li-${itemIndex}`}>{renderInline(item, `ol-${blockKey}-${itemIndex}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quote.push(lines[index].trim().replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push(
        <blockquote key={`quote-${blockKey++}`}>{inlineLines(quote.join('\n'), `quote-${blockKey}`)}</blockquote>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && !isSpecialLine(lines, index)) {
      paragraph.push(lines[index]);
      index += 1;
    }
    if (paragraph.length > 0) {
      blocks.push(<p key={`p-${blockKey++}`}>{inlineLines(paragraph.join('\n'), `p-${blockKey}`)}</p>);
    } else {
      index += 1;
    }
  }

  return blocks;
}

export function AiMarkdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <div className="ai-markdown">{blocks}</div>;
}
