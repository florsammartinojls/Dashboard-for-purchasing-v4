// src/components/ErrorBoundary.jsx
import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    if (typeof console !== 'undefined' && console.error) {
      console.error('[ErrorBoundary]', this.props.label || 'unnamed', error, errorInfo);
    }
  }

  reset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  copyDetails = () => {
    const { error, errorInfo } = this.state;
    const text = [
      `Component: ${this.props.label || 'unknown'}`,
      `Time: ${new Date().toISOString()}`,
      `Message: ${error?.message || 'no message'}`,
      `Stack:`,
      error?.stack || 'no stack',
      `Component stack:`,
      errorInfo?.componentStack || 'no component stack',
    ].join('\n');
    try {
      navigator.clipboard.writeText(text);
    } catch {
      console.log(text);
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const { error } = this.state;
    const { label, compact } = this.props;

    if (compact) {
      return (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 m-4">
          <div className="flex items-start gap-3">
            <span className="text-red-400 text-xl">⚠</span>
            <div className="flex-1 min-w-0">
              <h3 className="text-red-300 font-semibold text-sm mb-1">
                {label || 'Section'} crashed
              </h3>
              <p className="text-gray-300 text-xs mb-2 break-words">{error?.message || 'Unknown error'}</p>
              <div className="flex gap-2">
                <button
                  onClick={this.reset}
                  className="text-xs bg-blue-600 text-white px-3 py-1 rounded"
                >
                  Try again
                </button>
                <button
                  onClick={this.copyDetails}
                  className="text-xs bg-gray-700 text-gray-300 px-3 py-1 rounded"
                >
                  Copy error
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="bg-gray-900 border border-red-500/40 rounded-xl p-6 max-w-xl w-full">
          <div className="flex items-start gap-3 mb-4">
            <span className="text-red-400 text-3xl">⚠</span>
            <div className="flex-1">
              <h2 className="text-white text-xl font-bold mb-1">
                {label ? `${label} crashed` : 'Something went wrong'}
              </h2>
              <p className="text-gray-400 text-sm">
                The rest of the app may still work — try reloading or report this if it persists.
              </p>
            </div>
          </div>
          <div className="bg-gray-950 border border-gray-800 rounded p-3 mb-4 text-xs text-gray-300 break-words font-mono max-h-32 overflow-y-auto">
            {error?.message || 'Unknown error'}
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => window.location.reload()}
              className="flex-1 bg-blue-600 text-white py-2 rounded font-medium"
            >
              Reload
            </button>
            <button
              onClick={this.reset}
              className="flex-1 bg-gray-700 text-white py-2 rounded font-medium"
            >
              Try again
            </button>
            <button
              onClick={this.copyDetails}
              className="bg-gray-800 text-gray-300 px-4 py-2 rounded text-sm"
            >
              Copy details
            </button>
          </div>
        </div>
      </div>
    );
  }
}
