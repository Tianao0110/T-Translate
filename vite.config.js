// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isDev = mode === 'development';
  const isProd = mode === 'production';

  console.log(`🔧 Building in ${mode} mode...`);

  return {
    // HTML entries live in public/, so it doubles as the vite root.
    root: 'public',
    publicDir: false,

    plugins: [
      react({
        babel: {
          plugins: [
            // isProd && ['transform-remove-console', { exclude: ['error', 'warn'] }]
          ].filter(Boolean)
        }
      })
    ],

    base: isProd ? './' : '/',

    // '/src' alias is load-bearing: with root=public, source files sit outside
    // the vite root and resolve through this mapping.
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

    server: {
      port: 5173,
      strictPort: false,
      host: '127.0.0.1',
      open: false,
      cors: true,

      proxy: {
        '/v1': {
          target: 'http://localhost:1234',
          changeOrigin: true,
          secure: false,
          ws: true,
          configure: (proxy) => {
            proxy.on('error', (err) => {
              console.log('Proxy error:', err);
            });
            proxy.on('proxyReq', (proxyReq, req) => {
              console.log('Sending Request:', req.method, req.url);
            });
          }
        }
      },

      hmr: {
        overlay: true,
        port: 5174
      },

      watch: {
        usePolling: false,
        interval: 100,
        ignored: ['**/node_modules/**', '**/dist/**', '**/.git/**']
      },

      // src/ is outside the vite root (public/) — dev server must be allowed
      // to serve it via /@fs/.
      fs: {
        allow: [
          path.resolve(__dirname, 'src'),
          path.resolve(__dirname, 'node_modules'),
          path.resolve(__dirname, 'public'),
          path.resolve(__dirname),
        ],
        strict: false,
      }
    },

    build: {
      // Relative to root (public/), i.e. <project>/build
      outDir: '../build',
      assetsDir: 'static',
      emptyOutDir: true,
      sourcemap: isDev ? 'inline' : false,
      minify: isProd ? 'esbuild' : false,

      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'public/index.html'),
          floatingWindow: path.resolve(__dirname, 'public/floating-window.html'),
          selection: path.resolve(__dirname, 'public/selection.html'),
          aiResult: path.resolve(__dirname, 'public/ai-result.html')
        },
        output: {
          entryFileNames: `static/js/[name].[hash].js`,
          chunkFileNames: `static/js/[name].[hash].js`,
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
          manualChunks: {
            'react-vendor': ['react', 'react-dom'],
            'ui-vendor': ['lucide-react'],
            'utils-vendor': ['dayjs', 'uuid']
          }
        },

        // Node/Electron builtins must not be bundled into renderer output
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

      chunkSizeWarningLimit: isProd ? 1000 : 2000,
      assetsInlineLimit: 4096,
      cssCodeSplit: true,
      // Must track the Chromium shipped by our Electron (42 -> Chromium 148)
      target: 'chrome148',

      commonjsOptions: {
        transformMixedEsModules: true,
        // electron/shared modules are CJS and get imported by renderer code
        include: [/node_modules/, /electron\/shared/]
      }
    },

    css: {
      preprocessorOptions: {
        css: {
          charset: false
        }
      },
      postcss: {
        plugins: []
      },
      modules: {
        localsConvention: 'camelCase',
        generateScopedName: isDev
          ? '[name]__[local]__[hash:base64:5]'
          : '[hash:base64:8]'
      },
      devSourcemap: isDev
    },

    optimizeDeps: {
      // dayjs deep paths are only imported by lazy-loaded panels; without
      // pre-bundling they get discovered on first panel open, triggering a
      // re-optimization + 504 race (blank History/Favorites tabs).
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
      exclude: [
        'electron',
        'electron-store'
      ],
      force: isDev
    },

    esbuild: {
      drop: isProd ? ['console', 'debugger'] : [],
      minifyIdentifiers: isProd,
      minifySyntax: isProd,
      minifyWhitespace: isProd,
      legalComments: 'none',
      target: 'chrome148',
      jsxFactory: 'React.createElement',
      jsxFragment: 'React.Fragment'
    },

    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version),
      __APP_NAME__: JSON.stringify(packageJson.name),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
      __DEV__: isDev,
      __PROD__: isProd,
      'process.env.IS_ELECTRON': JSON.stringify(true),
      'process.env.NODE_ENV': JSON.stringify(mode),
      'global': 'globalThis'
    },

    worker: {
      format: 'es',
      // Array form is deprecated since Vite 5 (startup warning)
      plugins: () => [react()]
    },

    logLevel: isDev ? 'info' : 'warn',
    clearScreen: false,

    json: {
      namedExports: true,
      stringify: false
    },

    preview: {
      port: 4173,
      strictPort: false,
      host: '127.0.0.1',
      open: false
    },

    envDir: '.',
    envPrefix: 'VITE_',
    appType: 'mpa'
  };
});

process.on('exit', () => {
  console.log('✨ Build process completed');
});

process.on('uncaughtException', (error) => {
  console.error('❌ Build error:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
