import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

export const useAppLayoutState = () => {
  const [splitPercent, setSplitPercent] = useState(35);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const isResizingRef = useRef(false);

  useEffect(() => {
    const handleMouseMove = (e: globalThis.MouseEvent) => {
      if (!isResizingRef.current || !layoutRef.current || !isSidebarOpen) return;

      const bounds = layoutRef.current.getBoundingClientRect();
      const offsetX = e.clientX - bounds.left;
      let pct = (offsetX / bounds.width) * 100;

      const min = 20;
      const max = 80;
      if (pct < min) pct = min;
      if (pct > max) pct = max;

      setSplitPercent(pct);
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isSidebarOpen]);

  const handleDividerMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    isResizingRef.current = true;
  };

  return {
    splitPercent,
    setSplitPercent,
    isSidebarOpen,
    setIsSidebarOpen,
    layoutRef,
    handleDividerMouseDown,
  };
};
