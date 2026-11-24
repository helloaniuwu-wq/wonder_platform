import React from 'react';
import { parseInlineTokens, parseMarkdownBlocks } from '../utils/markdownParser';

function InlineContent({ text }) {
  const tokens = parseInlineTokens(text);
  return tokens.map((tok, idx) => {
    if (tok.type === 'bold') {
      return (
        <strong key={idx} style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
          {tok.value}
        </strong>
      );
    }
    if (tok.type === 'italic') {
      return <em key={idx}>{tok.value}</em>;
    }
    if (tok.type === 'code') {
      return (
        <code
          key={idx}
          style={{
            padding: '1px 6px',
            margin: '0 2px',
            borderRadius: '4px',
            fontSize: '0.82em',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            background: 'rgba(var(--accent-secondary-rgb, 99, 102, 241), 0.1)',
            color: 'var(--accent-secondary)',
            fontWeight: 600,
          }}
        >
          {tok.value}
        </code>
      );
    }
    if (tok.type === 'link') {
      return (
        <a
          key={idx}
          href={tok.href}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--accent-color)', textDecoration: 'underline' }}
        >
          {tok.label}
        </a>
      );
    }
    return <React.Fragment key={idx}>{tok.value}</React.Fragment>;
  });
}

/**
 * 机构研报风格 Markdown 渲染组件（用于 AI 投顾分析报告）。
 */
export default function MarkdownReport({ content }) {
  const blocks = React.useMemo(() => parseMarkdownBlocks(content), [content]);

  if (!blocks.length) return null;

  return (
    <div
      style={{
        background: 'var(--surface-subtle)',
        padding: '20px 24px',
        borderRadius: '8px',
        border: '1px solid var(--border-subtle)',
        fontSize: '0.88rem',
        lineHeight: '1.75',
        color: 'var(--text-primary)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      {blocks.map((block, idx) => {
        if (block.type === 'heading') {
          const isMajor = block.level <= 3;
          return (
            <div
              key={idx}
              style={{
                marginTop: idx === 0 ? 0 : isMajor ? '10px' : '4px',
                paddingBottom: isMajor ? '6px' : 0,
                paddingLeft: isMajor ? '10px' : 0,
                borderLeft: isMajor ? '3px solid var(--accent-secondary)' : 'none',
                borderBottom: isMajor ? '1px solid var(--border-subtle)' : 'none',
                fontSize: block.level <= 2 ? '1.05rem' : block.level === 3 ? '0.96rem' : '0.9rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                letterSpacing: '0.01em',
              }}
            >
              <InlineContent text={block.text} />
            </div>
          );
        }

        if (block.type === 'hr') {
          return (
            <hr
              key={idx}
              style={{
                border: 'none',
                borderTop: '1px solid var(--border-subtle)',
                margin: '6px 0',
              }}
            />
          );
        }

        if (block.type === 'blockquote') {
          return (
            <blockquote
              key={idx}
              style={{
                margin: '4px 0',
                padding: '10px 14px',
                borderLeft: '3px solid var(--accent-color)',
                background: 'rgba(var(--accent-color-rgb, 16, 185, 129), 0.06)',
                borderRadius: '0 6px 6px 0',
                color: 'var(--text-secondary)',
                fontSize: '0.86rem',
              }}
            >
              <InlineContent text={block.text} />
            </blockquote>
          );
        }

        if (block.type === 'table') {
          return (
            <div
              key={idx}
              style={{
                overflowX: 'auto',
                margin: '4px 0',
                borderRadius: '6px',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '0.83rem',
                  lineHeight: '1.5',
                }}
              >
                <thead>
                  <tr style={{ background: 'var(--bg-secondary, rgba(0, 0, 0, 0.04))' }}>
                    {block.headers.map((h, hIdx) => (
                      <th
                        key={hIdx}
                        style={{
                          padding: '9px 12px',
                          textAlign: hIdx === 0 ? 'left' : 'right',
                          fontWeight: 700,
                          color: 'var(--text-primary)',
                          borderBottom: '1px solid var(--border-subtle)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <InlineContent text={h} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rIdx) => (
                    <tr
                      key={rIdx}
                      style={{
                        background: rIdx % 2 === 1 ? 'rgba(128, 128, 128, 0.03)' : 'transparent',
                      }}
                    >
                      {block.headers.map((_, cIdx) => (
                        <td
                          key={cIdx}
                          style={{
                            padding: '8px 12px',
                            textAlign: cIdx === 0 ? 'left' : 'right',
                            borderBottom:
                              rIdx === block.rows.length - 1
                                ? 'none'
                                : '1px solid var(--border-subtle)',
                            color: cIdx === 0 ? 'var(--text-primary)' : 'var(--text-secondary)',
                            fontVariantNumeric: cIdx === 0 ? 'normal' : 'tabular-nums',
                          }}
                        >
                          <InlineContent text={row[cIdx] ?? ''} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (block.type === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul';
          return (
            <Tag
              key={idx}
              style={{
                margin: '2px 0',
                paddingLeft: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              {block.items.map((item, itemIdx) => (
                <li
                  key={itemIdx}
                  style={{
                    listStyleType: block.ordered ? 'decimal' : 'disc',
                    color: 'var(--text-primary)',
                  }}
                >
                  <InlineContent text={item.text} />
                  {item.children && item.children.length > 0 && (
                    <ul
                      style={{
                        margin: '6px 0 2px',
                        paddingLeft: '18px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                      }}
                    >
                      {item.children.map((sub, subIdx) => (
                        <li
                          key={subIdx}
                          style={{
                            listStyleType: 'circle',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          <InlineContent text={sub} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </Tag>
          );
        }

        return (
          <p key={idx} style={{ margin: 0, color: 'var(--text-primary)' }}>
            <InlineContent text={block.text} />
          </p>
        );
      })}
    </div>
  );
}
