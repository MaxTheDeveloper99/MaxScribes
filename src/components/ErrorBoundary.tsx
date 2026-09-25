import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in component tree:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#FAF8F5] text-[#1C1917] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-[#E7E2D8] p-6 sm:p-8 rounded-lg shadow-sm text-center">
            <h2 className="font-serif text-2xl font-bold text-[#1C1917] mb-2">Something went wrong</h2>
            <p className="text-sm text-[#6E6659] mb-4">
              An unexpected error occurred while loading this view.
            </p>
            {this.state.error && (
              <pre className="text-xs bg-[#FAF8F5] p-3 rounded border border-[#E7E2D8] text-rose-700 text-left overflow-auto max-h-32 mb-6 font-mono">
                {this.state.error.message || String(this.state.error)}
              </pre>
            )}
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="bg-[#1C1917] text-[#FAF8F5] px-5 py-2.5 text-xs font-medium rounded-md hover:bg-[#2D2926] transition-colors cursor-pointer"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
