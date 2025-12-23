// src/App.jsx
import React, { useEffect, useState } from 'react';
import TitleBar from './components/TitleBar';
import MainWindow from './components/MainWindow';
import './styles/App.css'; 

function App() {
  console.log("▶ App component started rendering...");

  try {
    const [theme, setTheme] = useState('light');

    useEffect(() => {
      console.log("▶ App useEffect running...");
      
      // 1. 初始化主题
      const savedTheme = localStorage.getItem('theme') || 'light';
      setTheme(savedTheme);
      document.documentElement.setAttribute('data-theme', savedTheme);

      const handleStorageChange = () => {
        const newTheme = localStorage.getItem('theme') || 'light';
        setTheme(newTheme);
        document.documentElement.setAttribute('data-theme', newTheme);
      };
      
      window.addEventListener('storage', handleStorageChange);

      // =========================================================
      // 🔴 关键修复：通知 index.html 移除加载动画
      // =========================================================
      const timer = setTimeout(() => {
        console.log("🚀 Signaling app-ready to index.html...");
        // 设置全局标记，防止超时报错
        if (window) {
            window.__APP_LOADED__ = true;
            // 触发自定义事件，通知 index.html 淡出加载屏
            window.dispatchEvent(new Event('app-ready'));
        }
      }, 500); // 稍微延迟一点，确保界面渲染完成
      // =========================================================

      return () => {
        window.removeEventListener('storage', handleStorageChange);
        clearTimeout(timer);
      };
    }, []);

    console.log("▶ App state initialized, rendering JSX...");

    return (
      <div className={`app ${theme} no-titlebar`}>
        {/* Electron 标题栏 */}
        <TitleBar />
        
        {/* 主应用界面 */}
        <MainWindow />
      </div>
    );

  } catch (error) {
    console.error("❌ App crashed:", error);
    return (
      <div style={{ color: 'white', backgroundColor: '#333', padding: '20px', height: '100vh' }}>
        <h1>程序启动失败</h1>
        <pre>{error.toString()}</pre>
      </div>
    );
  }
}

export default App;