import React, { Component, ErrorInfo, ReactNode } from 'react';

/**
 * 错误边界组件
 * 
 * 功能：
 * 1. 捕获子组件的 JavaScript 错误
 * 2. 显示友好的错误界面
 * 3. 支持错误重试
 * 4. 记录错误日志
 */

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({
      error,
      errorInfo,
    });

    // 调用回调
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // 记录到控制台
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError) {
      // 使用自定义 fallback
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // 默认错误界面
      return (
        <div className="flex flex-col items-center justify-center min-h-[200px] p-8 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
          <div className="text-4xl mb-4">💥</div>
          <h3 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">
            出现了一些问题
          </h3>
          <p className="text-sm text-red-600 dark:text-red-400 mb-4 text-center max-w-md">
            {this.state.error?.message || '发生了未知错误'}
          </p>
          
          {process.env.NODE_ENV === 'development' && this.state.errorInfo && (
            <details className="mb-4 w-full max-w-lg">
              <summary className="cursor-pointer text-sm text-red-500 hover:text-red-700">
                查看详细错误信息
              </summary>
              <pre className="mt-2 p-4 bg-red-100 dark:bg-red-900/40 rounded text-xs overflow-auto max-h-48 text-red-800 dark:text-red-300">
                {this.state.error?.stack}
                {'\n\n'}
                {this.state.errorInfo.componentStack}
              </pre>
            </details>
          )}
          
          <div className="flex gap-3">
            <button
              onClick={this.handleReset}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors"
            >
              重试
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-sm font-medium text-red-600 border border-red-300 hover:bg-red-50 rounded-md transition-colors"
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * 函数式错误边界包装器
 */
interface SafeComponentProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function SafeComponent({ children, fallback }: SafeComponentProps) {
  return (
    <ErrorBoundary fallback={fallback}>
      {children}
    </ErrorBoundary>
  );
}

/**
 * 异步操作错误处理 Hook
 */
export function useAsyncError() {
  const [, setError] = React.useState();

  return React.useCallback(
    (error: Error) => {
      setError(() => {
        throw error;
      });
    },
    [setError]
  );
}
