// In-app user guide: docs/MANUAL.<lang>.md rendered with the small reader in
// ../manual-markdown.js. Left: chapter list; right: the text. External links
// open in the system browser through the preload's shell bridge.

import React, { useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import manualZh from '../../../../docs/MANUAL.zh.md?raw';
import manualEn from '../../../../docs/MANUAL.en.md?raw';
import { parseMarkdown, buildToc } from '../manual-markdown.js';

function openLink(e, href) {
  if (href.startsWith('#')) {
    e.preventDefault();
    document.getElementById(href.slice(1))?.scrollIntoView({ block: 'start' });
    return;
  }
  if (/^https?:\/\//.test(href)) {
    e.preventDefault();
    window.electron?.shell?.openExternal?.(href);
  }
}

function Inlines({ inlines }) {
  return inlines.map((node, i) => {
    switch (node.type) {
      case 'bold':
        return <strong key={i}>{node.text}</strong>;
      case 'code':
        return <code key={i}>{node.text}</code>;
      case 'link':
        return (
          <a key={i} href={node.href} onClick={(e) => openLink(e, node.href)}>
            {node.text}
          </a>
        );
      default:
        return <React.Fragment key={i}>{node.text}</React.Fragment>;
    }
  });
}

function Block({ block }) {
  switch (block.type) {
    case 'heading': {
      const Tag = block.level === 2 ? 'h2' : block.level === 3 ? 'h3' : 'h4';
      return <Tag id={block.id}>{block.text}</Tag>;
    }
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag>
          {block.items.map((item, i) => (
            <li key={i}><Inlines inlines={item} /></li>
          ))}
        </Tag>
      );
    }
    case 'code':
      return <pre><code>{block.text}</code></pre>;
    default:
      return <p><Inlines inlines={block.inlines} /></p>;
  }
}

const ManualSection = () => {
  const { t, i18n } = useTranslation();
  const source = i18n.language?.startsWith('en') ? manualEn : manualZh;
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  const toc = useMemo(() => buildToc(blocks), [blocks]);
  const [active, setActive] = useState(null);

  const jump = useCallback((id) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, []);

  return (
    <div className="setting-content manual">
      <h3>{t('manual.title')}</h3>
      <div className="manual-layout">
        <nav className="manual-toc" aria-label={t('manual.contents')}>
          {toc.map((chapter) => (
            <div key={chapter.id} className="manual-toc-chapter">
              <button
                type="button"
                className={`manual-toc-link ${active === chapter.id ? 'active' : ''}`}
                onClick={() => jump(chapter.id)}
              >
                {chapter.text}
              </button>
              {chapter.children.map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  className={`manual-toc-link sub ${active === sec.id ? 'active' : ''}`}
                  onClick={() => jump(sec.id)}
                >
                  {sec.text}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <article className="manual-body">
          {blocks.map((block, i) => <Block key={i} block={block} />)}
        </article>
      </div>
    </div>
  );
};

export default ManualSection;
