import { useState, useEffect, useRef } from 'react';

/**
 * 流式文本 Hook - 打字机效果
 * 
 * @param text 完整文本
 * @param speed 打字速度（毫秒/字符）
 * @param enabled 是否启用动画
 * @returns 当前显示的文本
 */
export function useStreamingText(text: string, speed: number = 30, enabled: boolean = true): string {
  const [displayed, setDisplayed] = useState('');
  const indexRef = useRef(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!enabled) {
      setDisplayed(text);
      return;
    }

    // 重置
    indexRef.current = 0;
    setDisplayed('');

    if (!text) return;

    const animate = () => {
      if (indexRef.current < text.length) {
        indexRef.current++;
        setDisplayed(text.slice(0, indexRef.current));
        timerRef.current = setTimeout(animate, speed);
      }
    };

    timerRef.current = setTimeout(animate, speed);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [text, speed, enabled]);

  return displayed;
}

/**
 * 流式文本组件属性
 */
interface StreamingTextProps {
  text: string;
  speed?: number;
  enabled?: boolean;
  onComplete?: () => void;
  className?: string;
}

/**
 * 流式文本组件
 */
export function StreamingText({ 
  text, 
  speed = 30, 
  enabled = true, 
  onComplete,
  className = '' 
}: StreamingTextProps) {
  const displayed = useStreamingText(text, speed, enabled);
  const isComplete = displayed === text;

  useEffect(() => {
    if (isComplete && onComplete) {
      onComplete();
    }
  }, [isComplete, onComplete]);

  return (
    <span className={className}>
      {displayed}
      {!isComplete && (
        <span className="inline-block w-0.5 h-4 bg-current animate-pulse ml-0.5" />
      )}
    </span>
  );
}
