import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ListingSortObservationsBy } from '../listingSortObservations';

interface IndustryOutputViewProps {
  text: string;
  listingSortObservationsBy: ListingSortObservationsBy;
  onChangeListingSortObservationsBy: (_value: ListingSortObservationsBy) => void;
  onJumpToSourceLine?: (_sourceLine: number) => void;
}

type SectionTarget = {
  id: string;
  label: string;
  lineIndex: number;
};

type MenuState = {
  x: number;
  y: number;
  submenu: 'none' | 'sections' | 'sort';
  sortSubmenuLeft: boolean;
  sectionsSubmenuLeft: boolean;
};

const MAIN_MENU_WIDTH_PX = 192;
const MAIN_MENU_HEIGHT_PX = 72;
const SUBMENU_GAP_PX = 4;
const SORT_SUBMENU_WIDTH_PX = 192;
const SECTION_SUBMENU_WIDTH_PX = 256;
const MENU_EDGE_PADDING_PX = 6;

const SORT_OPTIONS: Array<{ value: ListingSortObservationsBy; label: string }> = [
  { value: 'name', label: 'Point Name' },
  { value: 'input', label: 'Input Order' },
  { value: 'residual', label: 'Residual' },
  { value: 'stdError', label: 'Std Error' },
  { value: 'stdResidual', label: 'Std Residual' },
];

const normalizeSectionMenuLabel = (label: string): string =>
  label.replace(/\s*\([^)]*\)\s*/gu, ' ').replace(/\s{2,}/g, ' ').trim();

const isStandaloneSectionHeading = (label: string): boolean => {
  const compact = label.trim();
  if (!compact) return false;
  if (
    /^Adjusted\s+(Measured\s+)?(Distance|Direction|Zenith)\s+Observations(?:\s*\([^)]*\))?$/iu.test(
      compact,
    )
  ) {
    return true;
  }
  if (
    /^Convergence\s+Angles(?:\s*\([^)]*\))?\s+and\s+Grid\s+Factors\s+at\s+Stations$/iu.test(compact)
  ) {
    return true;
  }
  return false;
};

const extractSectionTargets = (text: string): SectionTarget[] => {
  const lines = text.split('\n');
  const targets: SectionTarget[] = [];
  const seenLineIndexes = new Set<number>();
  for (let index = 0; index < lines.length - 1; index += 1) {
    const label = lines[index].trim();
    if (!label) continue;
    const underline = lines[index + 1].trim();
    if (!/^[=-]{3,}$/.test(underline)) continue;
    seenLineIndexes.add(index);
    targets.push({
      id: `section-${index + 1}`,
      label: normalizeSectionMenuLabel(label),
      lineIndex: index,
    });
  }
  for (let index = 0; index < lines.length; index += 1) {
    if (seenLineIndexes.has(index)) continue;
    const label = lines[index].trim();
    if (!isStandaloneSectionHeading(label)) continue;
    targets.push({
      id: `section-${index + 1}`,
      label: normalizeSectionMenuLabel(label),
      lineIndex: index,
    });
  }
  targets.sort((a, b) => a.lineIndex - b.lineIndex);
  return targets;
};

const IndustryOutputView: React.FC<IndustryOutputViewProps> = ({
  text,
  listingSortObservationsBy,
  onChangeListingSortObservationsBy,
  onJumpToSourceLine,
}) => {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const pendingSortScrollRestoreRef = useRef<{
    top: number;
    left: number;
    sectionLabel: string | null;
    previousText: string;
    expectedSort: ListingSortObservationsBy;
  } | null>(null);
  const lines = useMemo(() => text.split('\n'), [text]);
  const sections = useMemo(() => extractSectionTargets(text), [text]);
  const sectionByLine = useMemo(() => {
    const next: Record<number, SectionTarget> = {};
    sections.forEach((section) => {
      next[section.lineIndex] = section;
    });
    return next;
  }, [sections]);

  useLayoutEffect(() => {
    const pendingRestore = pendingSortScrollRestoreRef.current;
    if (!pendingRestore) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (listingSortObservationsBy !== pendingRestore.expectedSort) return;
    if (text === pendingRestore.previousText) return;
    const isTransientResetState = text.trim().length === 0 || sections.length === 0;
    let restoredBySection = false;
    if (pendingRestore.sectionLabel) {
      const targetSection = sections.find((section) => section.label === pendingRestore.sectionLabel);
      const targetNode = targetSection ? sectionRefs.current[targetSection.id] : null;
      if (targetNode) {
        targetNode.scrollIntoView({ block: 'start' });
        restoredBySection = true;
      }
    }
    if (!restoredBySection && isTransientResetState) {
      return;
    }
    if (!restoredBySection) {
      viewport.scrollTop = pendingRestore.top;
    }
    viewport.scrollLeft = pendingRestore.left;
    const frame = window.requestAnimationFrame(() => {
      const activeViewport = viewportRef.current;
      if (activeViewport) {
        if (!restoredBySection) {
          activeViewport.scrollTop = pendingRestore.top;
        }
        activeViewport.scrollLeft = pendingRestore.left;
      }
      pendingSortScrollRestoreRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [text, listingSortObservationsBy, sections]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      if (viewportRef.current?.contains(target) && event.button === 2) return;
      close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menu]);

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const viewportWidth = event.currentTarget.clientWidth || bounds.width || 0;
    const viewportHeight = event.currentTarget.clientHeight || bounds.height || 0;
    const viewportScrollLeft = event.currentTarget.scrollLeft || 0;
    const viewportScrollTop = event.currentTarget.scrollTop || 0;
    const rawX = event.clientX - bounds.left;
    const rawY = event.clientY - bounds.top;
    const clampedX =
      viewportWidth > 0
        ? Math.min(
            Math.max(rawX, MENU_EDGE_PADDING_PX),
            Math.max(MENU_EDGE_PADDING_PX, viewportWidth - MAIN_MENU_WIDTH_PX - MENU_EDGE_PADDING_PX),
          )
        : rawX;
    const clampedY =
      viewportHeight > 0
        ? Math.min(
            Math.max(rawY, MENU_EDGE_PADDING_PX),
            Math.max(MENU_EDGE_PADDING_PX, viewportHeight - MAIN_MENU_HEIGHT_PX - MENU_EDGE_PADDING_PX),
          )
        : rawY;
    const sortSubmenuLeft =
      viewportWidth > 0 &&
      clampedX + MAIN_MENU_WIDTH_PX + SUBMENU_GAP_PX + SORT_SUBMENU_WIDTH_PX >
        viewportWidth - MENU_EDGE_PADDING_PX;
    const sectionsSubmenuLeft =
      viewportWidth > 0 &&
      clampedX + MAIN_MENU_WIDTH_PX + SUBMENU_GAP_PX + SECTION_SUBMENU_WIDTH_PX >
        viewportWidth - MENU_EDGE_PADDING_PX;
    setMenu({
      x: viewportScrollLeft + clampedX,
      y: viewportScrollTop + clampedY,
      submenu: 'none',
      sortSubmenuLeft,
      sectionsSubmenuLeft,
    });
  };

  const jumpToSection = (id: string) => {
    const target = sectionRefs.current[id];
    if (!target) return;
    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setMenu(null);
  };

  const getCurrentSectionLabel = (viewport: HTMLDivElement | null): string | null => {
    if (!viewport || sections.length === 0) return null;
    const currentTop = viewport.scrollTop;
    let activeLabel: string | null = sections[0]?.label ?? null;
    sections.forEach((section) => {
      const node = sectionRefs.current[section.id];
      if (!node) return;
      if (node.offsetTop <= currentTop + 2) {
        activeLabel = section.label;
      }
    });
    return activeLabel;
  };

  const renderLine = (line: string): React.ReactNode => {
    if (!onJumpToSourceLine) return line || ' ';
    const match = line.match(/^(.*?)(\s+)(\d+):(\d+)\s*$/u);
    if (!match) return line || ' ';
    const [, prefix, spacing, fileNumberText, sourceLineText] = match;
    const sourceLine = Number.parseInt(sourceLineText, 10);
    if (!Number.isFinite(sourceLine) || sourceLine <= 0) return line || ' ';
    return (
      <>
        {prefix}
        {spacing}
        <button
          type="button"
          className="font-mono text-blue-300 underline decoration-dotted underline-offset-2 hover:text-blue-200"
          title={`Jump to line ${sourceLineText} in the input editor`}
          data-industry-output-source-line-link={`${fileNumberText}:${sourceLineText}`}
          onClick={() => onJumpToSourceLine(sourceLine)}
        >
          {fileNumberText}:{sourceLineText}
        </button>
      </>
    );
  };

  return (
    <div className="h-full p-4 bg-slate-950 text-slate-100">
      <div
        ref={viewportRef}
        className="relative h-full border border-slate-700 bg-slate-900 overflow-auto rounded"
        onContextMenu={handleContextMenu}
        data-industry-output-viewport
      >
        <div className="text-xs leading-5 font-mono p-3 whitespace-pre">
          {lines.map((line, index) => {
            const section = sectionByLine[index];
            return (
              <div
                key={`industry-output-line-${index}`}
                ref={(node) => {
                  if (section) sectionRefs.current[section.id] = node;
                }}
                data-industry-section-id={section?.id}
              >
                {renderLine(line)}
              </div>
            );
          })}
        </div>

        {menu ? (
          <div
            ref={menuRef}
            className="absolute z-20 min-w-48 rounded border border-slate-600 bg-slate-800 shadow-lg"
            style={{ left: menu.x, top: menu.y }}
            onPointerDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
            data-industry-output-menu
          >
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-xs text-slate-200 hover:bg-slate-700"
              onMouseEnter={() => setMenu((current) => (current ? { ...current, submenu: 'sections' } : current))}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setMenu((current) =>
                  current
                    ? {
                        ...current,
                        submenu: current.submenu === 'sections' ? 'none' : 'sections',
                      }
                    : current,
                );
              }}
              data-industry-output-menu-go-to
            >
              Go to section &gt;
            </button>
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-xs text-slate-200 hover:bg-slate-700"
              onMouseEnter={() => setMenu((current) => (current ? { ...current, submenu: 'sort' } : current))}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setMenu((current) =>
                  current
                    ? {
                        ...current,
                        submenu: current.submenu === 'sort' ? 'none' : 'sort',
                      }
                    : current,
                );
              }}
              data-industry-output-menu-sort-by
            >
              Sort by &gt;
            </button>
            {menu.submenu === 'sections' && (
              <div
                className={`absolute top-0 max-h-72 min-w-64 overflow-auto rounded border border-slate-600 bg-slate-800 shadow-lg ${
                  menu.sectionsSubmenuLeft ? 'right-full mr-1' : 'left-full ml-1'
                }`}
                onPointerDown={(event) => event.stopPropagation()}
                data-industry-output-sections-submenu-side={
                  menu.sectionsSubmenuLeft ? 'left' : 'right'
                }
              >
                {sections.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-slate-400">No sections detected</div>
                ) : (
                  sections.map((section) => (
                    <button
                      key={section.id}
                      type="button"
                      className="w-full px-3 py-2 text-left text-xs text-slate-200 hover:bg-slate-700"
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        jumpToSection(section.id);
                      }}
                      data-industry-output-section-target={section.id}
                    >
                      {section.label}
                    </button>
                  ))
                )}
              </div>
            )}
            {menu.submenu === 'sort' && (
              <div
                className={`absolute top-0 min-w-48 rounded border border-slate-600 bg-slate-800 shadow-lg ${
                  menu.sortSubmenuLeft ? 'right-full mr-1' : 'left-full ml-1'
                }`}
                onPointerDown={(event) => event.stopPropagation()}
                data-industry-output-sort-submenu-side={menu.sortSubmenuLeft ? 'left' : 'right'}
              >
                {SORT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`w-full px-3 py-2 text-left text-xs hover:bg-slate-700 ${
                      option.value === listingSortObservationsBy
                        ? 'text-cyan-300'
                        : 'text-slate-200'
                    }`}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const viewport = viewportRef.current;
                      const currentSectionLabel = getCurrentSectionLabel(viewport);
                      if (viewport) {
                        pendingSortScrollRestoreRef.current = {
                          top: viewport.scrollTop,
                          left: viewport.scrollLeft,
                          sectionLabel: currentSectionLabel,
                          previousText: text,
                          expectedSort: option.value,
                        };
                      } else {
                        pendingSortScrollRestoreRef.current = null;
                      }
                      onChangeListingSortObservationsBy(option.value);
                      setMenu(null);
                    }}
                    data-industry-output-sort-option={option.value}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default IndustryOutputView;
