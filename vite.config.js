// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

// 读取 package.json
const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  const isDev = mode === 'development';
  const isProd = mode === 'production';
  
  console.log(`🔧 Building in ${mode} mode...`);

  return {
    // 根目录设为 public（HTML 入口所在位置）
    root: 'public',
    
    // 静态资源目录（相对于 root）
    publicDir: false,  // 禁用，因为我们已经在 public 目录了
    
    // 插件配置
    plugins: [
      react({
        // React Fast Refresh
        fastRefresh: true,
        // Babel 配置
        babel: {
          plugins: [
            // 生产环境移除 console (需要 babel-plugin-transform-remove-console)
            // isProd && ['transform-remove-console', { exclude: ['error', 'warn'] }]
          ].filter(Boolean)
        }
      })
    ],

    // 基础路径
    base: isProd ? './' : '/',

    // 路径别名（关键：把 /src 映射到项目根目录的 src）
    resolve: {
      alias: {
        '/src': path.resolve(__dirname, 'src'),
        '@': path.resolve(__dirname, 'src'),
        '@components': path.resolve(__dirname, 'src/components'),
        '@services': path.resolve(__dirname, 'src/services'),
        '@utils': path.resolve(__dirname, 'src/utils'),
        '@stores': path.resolve(__dirname, 'src/stores'),
        '@styles': path.resolve(__dirname, 'src/styles'),
        '@config': path.resolve(__dirname, 'src/config'),
        '@assets': path.resolve(__dirname, 'src/assets')
      }
    },

    // 开发服务器配置
    server: {
      port: 5173,
      strictPort: false, // 端口被占用时尝试下一个
      host: '127.0.0.1',
      open: false, // Electron 会自动打开，不需要浏览器
      cors: true,
      
      // 代理配置（用于开发环境）
      proxy: {
        // LM Studio API 代理
        '/v1': {
          target: 'http://localhost:1234',
          changeOrigin: true,
          secure: false,
          ws: true, // 支持 WebSocket
          configure: (proxy, options) => {
            proxy.on('error', (err, req, res) => {
              console.log('Proxy error:', err);
            });
            proxy.on('proxyReq', (proxyReq, req, res) => {
              console.log('Sending Request:', req.method, req.url);
            });
          }
        }
      },

      // HMR 配置
      hmr: {
        overlay: true,
        port: 5174
      },

      // 文件监听配置
      watch: {
        usePolling: false,
        interval: 100,
        // 忽略文件
        ignored: ['**/node_modules/**', '**/dist/**', '**/.git/**']
      },

      // 文件系统访问配置
      fs: {
        // 允许访问项目根目录（因为 root 是 public，需要访问外层的 src）
        allow: [
          path.resolve(__dirname, 'src'),
          path.resolve(__dirname, 'node_modules'),
          path.resolve(__dirname, 'public'),
          path.resolve(__dirname),
        ],
        strict: false,  // 允许通过 /@fs/ 访问
      }
    },

    // 构建配置
    build: {
      // 输出目录（相对于 root，即 public/../build）
      outDir: '../build',
      
      // 资源目录
      assetsDir: 'static',
      
      // 清空输出目录
      emptyOutDir: true,
      
      // 源码映射
      sourcemap: isDev ? 'inline' : false,
      
      // 压缩配置 - 使用 esbuild (Vite 内置，无需额外安装)
      minify: isProd ? 'esbuild' : false,
      
      // 代码分割 - 多入口配置
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'public/index.html'),
          glass: path.resolve(__dirname, 'public/glass.html'),  // 玻璃翻译窗口入口
          selection: path.resolve(__dirname, 'public/selection.html')  // 划词翻译窗口入口
        },
        output: {
          // 入口文件名
          entryFileNames: `static/js/[name].[hash].js`,
          
          // 代码块文件名
          chunkFileNames: `static/js/[name].[hash].js`,
          
          // 资源文件名
          assetFileNames: (assetInfo) => {
            const info = assetInfo.name.split('.');
            const ext = info[info.length - 1];
            
            if (/png|jpe?g|svg|gif|tiff|bmp|ico/i.test(ext)) {
              return `static/img/[name].[hash][extname]`;
            } else if (/woff|woff2|eot|ttf|otf/i.test(ext)) {
              return `static/fonts/[name].[hash][extname]`;
            } else if (/css/i.test(ext)) {
              return `static/css/[name].[hash][extname]`;
            }
            return `static/[name].[hash][extname]`;
          },
          
          // 手动代码分割
          manualChunks: {
            // React 相关
            'react-vendor': ['react', 'react-dom'],
            
            // UI 库
            'ui-vendor': ['lucide-react'],
            
            // 工具库
            'utils-vendor': ['dayjs', 'uuid']
          }
        },
        
        // 外部依赖（Electron 环境）
        external: isDev ? [] : [
          'electron',
          'electron-store',
          'fs',
          'path',
          'os',
          'child_process',
          'crypto'
        ]
      },
      
      // 块大小警告
      chunkSizeWarningLimit: isProd ? 1000 : 2000,
      
      // 资源内联限制
      assetsInlineLimit: 4096, // 4kb
      
      // CSS 代码分割
      cssCodeSplit: true,
      
      // 目标浏览器
      target: 'chrome89', // Electron 13+ 使用 Chrome 89
      
      // 预构建
      commonjsOptions: {
        transformMixedEsModules: true,
        // 包含 node_modules 和 electron/shared 的 CommonJS 模块
        include: [/node_modules/, /electron\/shared/]
      }
    },

    // CSS 配置
    css: {
      // CSS 预处理器配置
      preprocessorOptions: {
        css: {
          charset: false // 避免 charset 警告
        }
      },
      
      // PostCSS 配置
      postcss: {
        plugins: [
          // autoprefixer 等可以在这里添加
        ]
      },
      
      // CSS Modules
      modules: {
        localsConvention: 'camelCase',
        generateScopedName: isDev 
          ? '[name]__[local]__[hash:base64:5]'
          : '[hash:base64:8]'
      },
      
      // 开发模式下的配置
      devSourcemap: isDev
    },

    // 依赖优化
    optimizeDeps: {
      // 包含的依赖。dayjs 深路径只被懒加载面板引用，不写进来会在面板首次
      // 打开时才被发现，触发二次预构建 + 504 竞态（历史/收藏页白屏）。
      include: [
        'react',
        'react-dom',
        'zustand',
        'dayjs',
        'dayjs/plugin/relativeTime',
        'dayjs/plugin/isSameOrAfter',
        'dayjs/locale/zh-cn',
        'dayjs/locale/en',
        'lucide-react'
      ],
      
      // 排除的依赖
      exclude: [
        'electron',
        'electron-store'
      ],
      
      // 强制预构建
      force: isDev
    },

    // 性能优化
    esbuild: {
      // 生产环境移除 console 和 debugger
      drop: isProd ? ['console', 'debugger'] : [],
      
      // 压缩标识符
      minifyIdentifiers: isProd,
      
      // 压缩语法
      minifySyntax: isProd,
      
      // 压缩空白
      minifyWhitespace: isProd,
      
      // 合法注释
      legalComments: 'none',
      
      // 目标
      target: 'chrome89',
      
      // JSX 配置
      jsxFactory: 'React.createElement',
      jsxFragment: 'React.Fragment'
      //jsxInject: `import React from 'react'`
    },

    // 定义全局常量
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version),
      __APP_NAME__: JSON.stringify(packageJson.name),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
      __DEV__: isDev,
      __PROD__: isProd,
      
      // Electron 相关
      'process.env.IS_ELECTRON': JSON.stringify(true),
      'process.env.NODE_ENV': JSON.stringify(mode),
      
      // 防止某些库的警告
      'global': 'globalThis'
    },

    // Worker 配置
    worker: {
      format: 'es',
      plugins: [react()]
    },

    // 日志级别
    logLevel: isDev ? 'info' : 'warn',

    // 清屏
    clearScreen: false,

    // JSON 配置
    json: {
      namedExports: true,
      stringify: false
    },

    // 预览配置（用于预览构建结果）
    preview: {
      port: 4173,
      strictPort: false,
      host: '127.0.0.1',
      open: false
    },

    // 环境变量目录
    envDir: '.',
    
    // 环境变量前缀
    envPrefix: 'VITE_',

    // 应用类型
    appType: 'mpa'  // 改为多页应用
  };
});

// 自定义构建完成钩子
process.on('exit', () => {
  console.log('✨ Build process completed');
});

// 捕获未处理的错误
process.on('uncaughtException', (error) => {
  console.error('❌ Build error:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
