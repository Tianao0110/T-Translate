// src/stores/translation-store.js
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import translator from '../services/translator';
import ocrManager from '../services/ocr-manager';
import { v4 as uuidv4 } from 'uuid';

/**
 * 翻译状态管理
 * 使用 Zustand 进行状态管理
 */
const useTranslationStore = create(
  persist(
    immer((set, get) => ({
      // ==================== 状态 ====================
      // 当前翻译任务
      currentTranslation: {
        id: null,
        sourceText: '',
        translatedText: '',
        sourceLanguage: 'auto',
        targetLanguage: 'zh',
        status: 'idle', // idle | translating | success | error
        error: null,
        metadata: {
          timestamp: null,
          duration: null,
          model: null,
          template: 'general'
        }
      },

      // 翻译历史
      history: [],
      historyLimit: 1000,

      // 收藏的翻译
      favorites: [],

      // 翻译队列
      queue: [],
      isProcessingQueue: false,

      // OCR 状态
      ocrStatus: {
        isProcessing: false,
        engine: 'tesseract',
        lastResult: null,
        error: null
      },

      // 统计数据
      statistics: {
        totalTranslations: 0,
        totalCharacters: 0,
        todayTranslations: 0,
        weekTranslations: 0,
        mostUsedLanguagePair: null,
        averageTranslationTime: 0,
        lastUpdated: new Date().toISOString()
      },

      // 临时剪贴板
      clipboard: {
        source: '',
        translated: '',
        timestamp: null
      },

      // ==================== Actions ====================
      
      /**
       * 设置源文本
       */
      setSourceText: (text) => set((state) => {
        state.currentTranslation.sourceText = text;
        state.currentTranslation.status = 'idle';
        state.currentTranslation.error = null;
      }),

      /**
       * 设置翻译结果
       */
      setTranslatedText: (text) => set((state) => {
        state.currentTranslation.translatedText = text;
      }),

      /**
       * 设置语言对
       */
      setLanguages: (source, target) => set((state) => {
        if (source) state.currentTranslation.sourceLanguage = source;
        if (target) state.currentTranslation.targetLanguage = target;
      }),

      /**
       * 切换语言
       */
      swapLanguages: () => set((state) => {
        if (state.currentTranslation.sourceLanguage === 'auto') {
          return; // 自动检测时不能切换
        }
        
        const temp = state.currentTranslation.sourceLanguage;
        state.currentTranslation.sourceLanguage = state.currentTranslation.targetLanguage;
        state.currentTranslation.targetLanguage = temp;
        
        // 同时交换文本
        const tempText = state.currentTranslation.sourceText;
        state.currentTranslation.sourceText = state.currentTranslation.translatedText;
        state.currentTranslation.translatedText = tempText;
      }),

      /**
       * 执行翻译
       */
      translate: async (options = {}) => {
        const state = get();
        const { sourceText, sourceLanguage, targetLanguage } = state.currentTranslation;
        
        if (!sourceText.trim()) {
          return { success: false, error: '请输入要翻译的文本' };
        }

        // 更新状态
        set((state) => {
          state.currentTranslation.status = 'translating';
          state.currentTranslation.error = null;
          state.currentTranslation.id = uuidv4();
        });

        const startTime = Date.now();

        try {
          // 调用翻译服务
          const result = await translator.translate(sourceText, {
            from: sourceLanguage,
            to: targetLanguage,
            template: options.template || state.currentTranslation.metadata.template,
            ...options
          });

          if (result.success) {
            const duration = Date.now() - startTime;
            
            set((state) => {
              // 更新当前翻译
              state.currentTranslation.translatedText = result.translated;
              state.currentTranslation.status = 'success';
              state.currentTranslation.metadata = {
                timestamp: Date.now(),
                duration,
                model: result.model,
                template: options.template || state.currentTranslation.metadata.template
              };

              // 添加到历史
              const historyItem = {
                id: state.currentTranslation.id,
                sourceText: sourceText,
                translatedText: result.translated,
                sourceLanguage: result.from || sourceLanguage,
                targetLanguage: targetLanguage,
                timestamp: Date.now(),
                duration,
                model: result.model
              };

              state.history.unshift(historyItem);
              
              // 限制历史记录数量
              if (state.history.length > state.historyLimit) {
                state.history = state.history.slice(0, state.historyLimit);
              }

              // 更新统计
              state.statistics.totalTranslations++;
              state.statistics.totalCharacters += sourceText.length;
              
              // 更新今日统计
              const today = new Date().toDateString();
              const historyToday = state.history.filter(item => 
                new Date(item.timestamp).toDateString() === today
              );
              state.statistics.todayTranslations = historyToday.length;
              
              // 更新平均翻译时间
              const totalTime = state.history.slice(0, 100)
                .reduce((acc, item) => acc + (item.duration || 0), 0);
              state.statistics.averageTranslationTime = 
                Math.round(totalTime / Math.min(state.history.length, 100));
            });

            return { success: true, translated: result.translated };
          } else {
            throw new Error(result.error || '翻译失败');
          }
        } catch (error) {
          console.error('Translation error:', error);
          
          set((state) => {
            state.currentTranslation.status = 'error';
            state.currentTranslation.error = error.message;
          });

          return { success: false, error: error.message };
        }
      },

      /**
       * 批量翻译
       */
      batchTranslate: async (texts, options = {}) => {
        set((state) => {
          state.queue = texts.map(text => ({
            id: uuidv4(),
            text,
            status: 'pending',
            result: null
          }));
          state.isProcessingQueue = true;
        });

        const results = [];
        const state = get();

        for (let i = 0; i < texts.length; i++) {
          const item = state.queue[i];
          
          // 更新队列状态
          set((state) => {
            state.queue[i].status = 'processing';
          });

          try {
            const result = await translator.translate(item.text, {
              from: state.currentTranslation.sourceLanguage,
              to: state.currentTranslation.targetLanguage,
              ...options
            });

            if (result.success) {
              set((state) => {
                state.queue[i].status = 'completed';
                state.queue[i].result = result.translated;
              });
              results.push({ success: true, text: result.translated });
            } else {
              throw new Error(result.error);
            }
          } catch (error) {
            set((state) => {
              state.queue[i].status = 'error';
              state.queue[i].error = error.message;
            });
            results.push({ success: false, error: error.message });
          }

          // 通知进度
          if (options.onProgress) {
            options.onProgress(i + 1, texts.length);
          }
        }

        set((state) => {
          state.isProcessingQueue = false;
        });

        return results;
      },

      /**
       * OCR 识别
       */
      recognizeImage: async (image, options = {}) => {
        set((state) => {
          state.ocrStatus.isProcessing = true;
          state.ocrStatus.error = null;
        });

        try {
          const result = await ocrManager.recognize(image, {
            engine: get().ocrStatus.engine,
            ...options
          });

          if (result.success) {
            set((state) => {
              state.ocrStatus.isProcessing = false;
              state.ocrStatus.lastResult = result;
              
              // 自动设置为源文本
              if (options.autoSetSource !== false) {
                state.currentTranslation.sourceText = result.text;
              }
            });

            return { success: true, text: result.text };
          } else {
            throw new Error(result.error);
          }
        } catch (error) {
          set((state) => {
            state.ocrStatus.isProcessing = false;
            state.ocrStatus.error = error.message;
          });

          return { success: false, error: error.message };
        }
      },

      /**
       * 设置 OCR 引擎
       */
      setOcrEngine: (engine) => set((state) => {
        state.ocrStatus.engine = engine;
      }),

      /**
       * 添加到收藏
       */
      addToFavorites: (item = null) => set((state) => {
        const favoriteItem = item || {
          id: uuidv4(),
          sourceText: state.currentTranslation.sourceText,
          translatedText: state.currentTranslation.translatedText,
          sourceLanguage: state.currentTranslation.sourceLanguage,
          targetLanguage: state.currentTranslation.targetLanguage,
          timestamp: Date.now(),
          tags: []
        };

        // 检查是否已存在
        const exists = state.favorites.some(
          f => f.sourceText === favoriteItem.sourceText && 
               f.targetLanguage === favoriteItem.targetLanguage
        );

        if (!exists) {
          state.favorites.unshift(favoriteItem);
        }
      }),

      /**
       * 从收藏中移除
       */
      removeFromFavorites: (id) => set((state) => {
        state.favorites = state.favorites.filter(f => f.id !== id);
      }),

      /**
       * 清空当前翻译
       */
      clearCurrent: () => set((state) => {
        state.currentTranslation = {
          id: null,
          sourceText: '',
          translatedText: '',
          sourceLanguage: state.currentTranslation.sourceLanguage,
          targetLanguage: state.currentTranslation.targetLanguage,
          status: 'idle',
          error: null,
          metadata: {
            timestamp: null,
            duration: null,
            model: null,
            template: 'general'
          }
        };
      }),

      /**
       * 清空历史
       */
      clearHistory: () => set((state) => {
        state.history = [];
        state.statistics.totalTranslations = 0;
        state.statistics.totalCharacters = 0;
      }),

      /**
       * 从历史恢复
       */
      restoreFromHistory: (id) => set((state) => {
        const item = state.history.find(h => h.id === id);
        if (item) {
          state.currentTranslation.sourceText = item.sourceText;
          state.currentTranslation.translatedText = item.translatedText;
          state.currentTranslation.sourceLanguage = item.sourceLanguage;
          state.currentTranslation.targetLanguage = item.targetLanguage;
        }
      }),

      /**
       * 复制到剪贴板
       */
      copyToClipboard: (type = 'translated') => {
        const state = get();
        const text = type === 'source' 
          ? state.currentTranslation.sourceText 
          : state.currentTranslation.translatedText;

        if (text) {
          if (window.electron) {
            window.electron.clipboard.writeText(text);
          } else {
            navigator.clipboard.writeText(text);
          }

          set((state) => {
            state.clipboard = {
              source: type === 'source' ? text : state.clipboard.source,
              translated: type === 'translated' ? text : state.clipboard.translated,
              timestamp: Date.now()
            };
          });

          return true;
        }
        return false;
      },

      /**
       * 从剪贴板粘贴
       */
      pasteFromClipboard: async () => {
        try {
          let text;
          if (window.electron) {
            text = await window.electron.clipboard.readText();
          } else {
            text = await navigator.clipboard.readText();
          }

          if (text) {
            set((state) => {
              state.currentTranslation.sourceText = text;
              state.currentTranslation.status = 'idle';
            });
            return true;
          }
        } catch (error) {
          console.error('Paste error:', error);
        }
        return false;
      },

      /**
       * 导出历史
       */
      exportHistory: (format = 'json') => {
        const state = get();
        const data = state.history;

        if (format === 'json') {
          const blob = new Blob([JSON.stringify(data, null, 2)], {
            type: 'application/json'
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `translation-history-${Date.now()}.json`;
          a.click();
          URL.revokeObjectURL(url);
        } else if (format === 'csv') {
          const headers = ['时间', '源语言', '目标语言', '原文', '译文'];
          const rows = data.map(item => [
            new Date(item.timestamp).toLocaleString(),
            item.sourceLanguage,
            item.targetLanguage,
            `"${item.sourceText.replace(/"/g, '""')}"`,
            `"${item.translatedText.replace(/"/g, '""')}"`
          ]);
          
          const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
          const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `translation-history-${Date.now()}.csv`;
          a.click();
          URL.revokeObjectURL(url);
        }
      },

      /**
       * 导入历史
       */
      importHistory: async (file) => {
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          
          if (Array.isArray(data)) {
            set((state) => {
              // 合并历史，避免重复
              const existingIds = new Set(state.history.map(h => h.id));
              const newItems = data.filter(item => !existingIds.has(item.id));
              state.history = [...newItems, ...state.history].slice(0, state.historyLimit);
            });
            return { success: true, count: data.length };
          }
        } catch (error) {
          console.error('Import error:', error);
          return { success: false, error: error.message };
        }
      },

      /**
       * 搜索历史
       */
      searchHistory: (query) => {
        const state = get();
        const searchTerm = query.toLowerCase();
        
        return state.history.filter(item => 
          item.sourceText.toLowerCase().includes(searchTerm) ||
          item.translatedText.toLowerCase().includes(searchTerm)
        );
      },

      /**
       * 获取统计数据
       */
      getStatistics: () => {
        const state = get();
        
        // 更新语言对统计
        const languagePairs = {};
        state.history.forEach(item => {
          const pair = `${item.sourceLanguage}-${item.targetLanguage}`;
          languagePairs[pair] = (languagePairs[pair] || 0) + 1;
        });
        
        const mostUsedPair = Object.entries(languagePairs)
          .sort((a, b) => b[1] - a[1])[0];
        
        set((state) => {
          state.statistics.mostUsedLanguagePair = mostUsedPair ? mostUsedPair[0] : null;
          state.statistics.lastUpdated = new Date().toISOString();
        });
        
        return state.statistics;
      },

      /**
       * 重置所有状态
       */
      reset: () => set((state) => {
        // 保留语言设置
        const { sourceLanguage, targetLanguage } = state.currentTranslation;
        
        // 重置到初始状态
        Object.assign(state, {
          currentTranslation: {
            id: null,
            sourceText: '',
            translatedText: '',
            sourceLanguage,
            targetLanguage,
            status: 'idle',
            error: null,
            metadata: {
              timestamp: null,
              duration: null,
              model: null,
              template: 'general'
            }
          },
          history: [],
          favorites: [],
          queue: [],
          isProcessingQueue: false,
          ocrStatus: {
            isProcessing: false,
            engine: 'tesseract',
            lastResult: null,
            error: null
          },
          clipboard: {
            source: '',
            translated: '',
            timestamp: null
          }
        });
      })
    })),
    {
      name: 'translation-store',
      storage: createJSONStorage(() => {
        // 在 Electron 环境中使用 electron-store
        if (window.electron && window.electron.store) {
          return {
            getItem: async (name) => {
              return await window.electron.store.get(name);
            },
            setItem: async (name, value) => {
              await window.electron.store.set(name, value);
            },
            removeItem: async (name) => {
              await window.electron.store.delete(name);
            }
          };
        }
        // 否则使用 localStorage
        return localStorage;
      }),
      partialize: (state) => ({
        // 只持久化部分状态
        history: state.history,
        favorites: state.favorites,
        statistics: state.statistics,
        currentTranslation: {
          sourceLanguage: state.currentTranslation.sourceLanguage,
          targetLanguage: state.currentTranslation.targetLanguage
        }
      })
    }
  )
);

export default useTranslationStore;