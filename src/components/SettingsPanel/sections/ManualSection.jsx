// In-app user guide: docs/MANUAL.<lang>.md rendered with the small reader in
// ../manual-markdown.js. Left: chapter list, with only the current chapter's
// sections unfolded; right: the text. The highlight follows the reading
// position. External links open in the system browser through the preload's
// shell bridge.

import React, { useMemo, useState, useCallback, useRef } from 'react';
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
  // The lines before the first chapter only say where this guide can be read —
  // which is here — so the in-app reader starts at chapter 0.
  const blocks = useMemo(() => {
    const all = parseMarkdown(source);
    const first = all.findIndex((b) => b.type === 'heading' && b.level === 2);
    return first > 0 ? all.slice(first) : all;
  }, [source]);
  const toc = useMemo(() => buildToc(blocks), [blocks]);
  const [active, setActive] = useState(null);

  // Section id -> its chapter, to unfold the chapter that holds the active one.
  const chapterOf = useMemo(() => {
    const map = {};
    for (const ch of toc) {
      map[ch.id] = ch.id;
      for (const sec of ch.children) map[sec.id] = ch.id;
    }
    return map;
  }, [toc]);
  const openChapter = active ? chapterOf[active] : null;

  const jump = useCallback((id) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, []);

  // Scroll spy: the last heading that has reached the top of the scroll area
  // is the active one. The page root is the scroll container.
  const rootRef = useRef(null);
  const frame = useRef(0);
  const onScroll = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const root = rootRef.current;
      if (!root) return;
      const top = root.getBoundingClientRect().top + 24;
      let current = null;
      for (const ch of toc) {
        for (const id of [ch.id, ...ch.children.map((c) => c.id)]) {
          const el = document.getElementById(id);
          if (el && el.getBoundingClientRect().top <= top) current = id;
        }
      }
      setActive(current);
    });
  }, [toc]);

  return (
    <div className="setting-content manual" ref={rootRef} onScroll={onScroll}>
      <h3>{t('settingsNav.manual')}</h3>
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
              {openChapter === chapter.id && chapter.children.map((sec) => (
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
