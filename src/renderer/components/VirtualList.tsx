import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';

/**
 * 虚拟滚动列表组件
 * 
 * 功能：
 * 1. 只渲染可见区域的元素
 * 2. 支持动态高度
 * 3. 平滑滚动
 * 4. 自动滚动到底部
 */

interface VirtualListProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  estimateItemHeight?: number;
  overscan?: number;
  className?: string;
  autoScrollToBottom?: boolean;
  onScrollToBottom?: () => void;
  keyExtractor?: (item: T, index: number) => string;
}

export function VirtualList<T>({
  items,
  renderItem,
  estimateItemHeight = 100,
  overscan = 5,
  className = '',
  autoScrollToBottom = true,
  onScrollToBottom,
  keyExtractor,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [itemHeights, setItemHeights] = useState<Map<number, number>>(new Map());
  const [isAutoScroll, setIsAutoScroll] = useState(autoScrollToBottom);

  // 计算每个元素的位置
  const itemPositions = useMemo(() => {
    const positions: Array<{ top: number; height: number }> = [];
    let currentTop = 0;

    for (let i = 0; i < items.length; i++) {
      const height = itemHeights.get(i) || estimateItemHeight;
      positions.push({ top: currentTop, height });
      currentTop += height;
    }

    return positions;
  }, [items.length, itemHeights, estimateItemHeight]);

  // 计算总高度
  const totalHeight = useMemo(() => {
    if (itemPositions.length === 0) return 0;
    const last = itemPositions[itemPositions.length - 1];
    return last.top + last.height;
  }, [itemPositions]);

  // 计算可见范围
  const visibleRange = useMemo(() => {
    if (containerHeight === 0) {
      return { start: 0, end: Math.min(10, items.length) };
    }

    let start = 0;
    let end = items.length;

    // 找到第一个可见元素
    for (let i = 0; i < itemPositions.length; i++) {
      if (itemPositions[i].top + itemPositions[i].height > scrollTop) {
        start = Math.max(0, i - overscan);
        break;
      }
    }

    // 找到最后一个可见元素
    for (let i = start; i < itemPositions.length; i++) {
      if (itemPositions[i].top > scrollTop + containerHeight) {
        end = Math.min(items.length, i + overscan);
        break;
      }
    }

    return { start, end };
  }, [scrollTop, containerHeight, itemPositions, items.length, overscan]);

  // 可见元素
  const visibleItems = useMemo(() => {
    return items.slice(visibleRange.start, visibleRange.end).map((item, index) => ({
      item,
      index: visibleRange.start + index,
    }));
  }, [items, visibleRange]);

  // 监听容器大小变化
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // 监听滚动事件
  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    setScrollTop(container.scrollTop);

    // 检查是否滚动到底部
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;
    setIsAutoScroll(isAtBottom);

    if (isAtBottom && onScrollToBottom) {
      onScrollToBottom();
    }
  }, [onScrollToBottom]);

  // 自动滚动到底部
  useEffect(() => {
    if (isAutoScroll && autoScrollToBottom) {
      const container = containerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }
  }, [items.length, isAutoScroll, autoScrollToBottom]);

  // 更新元素高度
  const updateItemHeight = useCallback((index: number, height: number) => {
    setItemHeights(prev => {
      const next = new Map(prev);
      next.set(index, height);
      return next;
    });
  }, []);

  return (
    <div
      ref={containerRef}
      className={`overflow-auto ${className}`}
      onScroll={handleScroll}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {visibleItems.map(({ item, index }) => {
          const position = itemPositions[index];
          const key = keyExtractor ? keyExtractor(item, index) : index;

          return (
            <div
              key={key}
              style={{
                position: 'absolute',
                top: position.top,
                left: 0,
                right: 0,
              }}
            >
              <VirtualListItem
                index={index}
                onHeightChange={updateItemHeight}
              >
                {renderItem(item, index)}
              </VirtualListItem>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 虚拟列表项组件 - 自动测量高度
 */
interface VirtualListItemProps {
  index: number;
  onHeightChange: (index: number, height: number) => void;
  children: React.ReactNode;
}

function VirtualListItem({ index, onHeightChange, children }: VirtualListItemProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        onHeightChange(index, entry.contentRect.height);
      }
    });

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [index, onHeightChange]);

  return <div ref={ref}>{children}</div>;
}

/**
 * 简化版虚拟滚动 Hook
 */
export function useVirtualScroll<T>(
  items: T[],
  containerHeight: number,
  itemHeight: number = 100,
  overscan: number = 5
) {
  const [scrollTop, setScrollTop] = useState(0);

  const totalHeight = items.length * itemHeight;

  const visibleRange = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const visibleCount = Math.ceil(containerHeight / itemHeight);
    const end = Math.min(items.length, start + visibleCount + overscan * 2);
    return { start, end };
  }, [scrollTop, containerHeight, itemHeight, items.length, overscan]);

  const visibleItems = useMemo(() => {
    return items.slice(visibleRange.start, visibleRange.end).map((item, index) => ({
      item,
      index: visibleRange.start + index,
      style: {
        position: 'absolute' as const,
        top: (visibleRange.start + index) * itemHeight,
        height: itemHeight,
        left: 0,
        right: 0,
      },
    }));
  }, [items, visibleRange, itemHeight]);

  return {
    totalHeight,
    visibleItems,
    onScroll: (e: React.UIEvent<HTMLDivElement>) => {
      setScrollTop(e.currentTarget.scrollTop);
    },
  };
}
