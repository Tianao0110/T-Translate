// src/components/ErrorBoundary/index.jsx
// 通用错误边界组件 - 捕获 React 渲染错误，防止应用崩溃

import React from 'react';
import i18n from '../../i18n.js';
import createLogger from '../../utils/logger.js';

const logger = createLogger('ErrorBoundary');

// Class component 不能用 useTranslation hook，直接用 i18n.t()
const t = (key, fallback) => {
  const result = i18n.t(key);
  return result === key ? fallback : result;
};

/**
 * 错误边界组件
 * 用于捕获子组件的渲染错误，显示友好的错误界面
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null, 
      errorInfo: null,
      retryCount: 0,
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    logger.error('React Error:', error.message);
    logger.debug('Component Stack:', errorInfo?.componentStack);
    
    this.setState({
      error,
      errorInfo,
    });

    // 可以在这里上报错误到日志系统
  }

  handleRetry = () => {
    this.setState(prev => ({
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: prev.retryCount + 1,
    }));
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    const { hasError, error, errorInfo, retryCount } = this.state;
    const { children, fallback, minimal, windowName } = this.props;

    if (!hasError) {
      return children;
    }

    // 自定义 fallback
    if (fallback) {
      return fallback;
    }

    // 最小化模式（用于小窗口如划词翻译）
    if (minimal) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          padding: '12px',
          backgroundColor: '#fef2f2',
          color: '#991b1b',
          fontSize: '13px',
          textAlign: 'center',
        }}>
          <div style={{ marginBottom: '8px' }}>😕 {t('errorBoundary.title', 'Something went wrong')}</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {retryCount < 3 && (
              <button
                onClick={this.handleRetry}
                style={{
                  padding: '4px 12px',
                  backgroundColor: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                {t('errorBoundary.retry', 'Retry')}
              </button>
            )}
            <button
              onClick={this.handleReload}
              style={{
                padding: '4px 12px',
                backgroundColor: '#6b7280',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              {t('errorBoundary.reload', 'Reload')}
            </button>
          </div>
        </div>
      );
    }

    // 完整错误界面
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        padding: '20px',
        backgroundColor: '#f9fafb',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}>
        <div style={{
          maxWidth: '500px',
          textAlign: 'center',
        }}>
          <div style={{ 
            fontSize: '48px', 
            marginBottom: '16px',
          }}>
            😕
          </div>
          
          <h1 style={{ 
            color: '#1f2937', 
            fontSize: '20px',
            fontWeight: '600',
            marginBottom: '8px',
          }}>
            {windowName 
              ? t('errorBoundary.windowError', '{{name}} encountered a problem').replace('{{name}}', windowName)
              : t('errorBoundary.title', 'Something went wrong')
            }
          </h1>
          
          <p style={{ 
            color: '#6b7280', 
            fontSize: '14px',
            marginBottom: '24px',
          }}>
            {t('errorBoundary.description', 'An error occurred. Please try again or reload the page.')}
          </p>

          <div style={{ 
            display: 'flex', 
            gap: '12px', 
            justifyContent: 'center',
            marginBottom: '24px',
          }}>
            {retryCount < 3 && (
              <button
                onClick={this.handleRetry}
                style={{
                  padding: '10px 24px',
                  backgroundColor: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                  transition: 'background-color 0.2s',
                }}
                onMouseOver={(e) => e.target.style.backgroundColor = '#2563eb'}
                onMouseOut={(e) => e.target.style.backgroundColor = '#3b82f6'}
              >
                {t('errorBoundary.retry', 'Retry')}
              </button>
            )}
            <button
              onClick={this.handleReload}
              style={{
                padding: '10px 24px',
                backgroundColor: '#f3f4f6',
                color: '#374151',
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '500',
                transition: 'background-color 0.2s',
              }}
              onMouseOver={(e) => e.target.style.backgroundColor = '#e5e7eb'}
              onMouseOut={(e) => e.target.style.backgroundColor = '#f3f4f6'}
            >
              {t('errorBoundary.reload', 'Reload')}
            </button>
          </div>

          <details style={{ 
            textAlign: 'left',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '8px',
            padding: '12px',
          }}>
            <summary style={{ 
              cursor: 'pointer', 
              color: '#991b1b',
              fontSize: '13px',
              fontWeight: '500',
              marginBottom: '8px',
            }}>
              {t('errorBoundary.details', 'Error Details')}
            </summary>
            <pre style={{ 
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: '12px',
              color: '#7f1d1d',
              margin: 0,
              maxHeight: '200px',
              overflow: 'auto',
            }}>
              {error?.toString()}
              {errorInfo?.componentStack}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
