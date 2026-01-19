// src/stores/selectors.js
// Zustand 选择器优化 - 避免不必要的重渲染
//
// 使用方式：
// import { useTranslationSelectors } from '../stores/selectors';
// const { sourceText, translatedText } = useTranslationSelectors();

import { useCallback } from 'react';
import { shallow } from 'zustand/shallow';
import useTranslationStore from './translation-store';

/**
 * 翻译状态选择器 - 只订阅需要的字段
 * 使用 shallow 比较避免不必要的重渲染
 */
export const useTranslationSelectors = () => {
  return useTranslationStore(
    useCallback(
      (state) => ({
        // 当前翻译
        sourceText: state.currentTranslation.sourceText,
        translatedText: state.currentTranslation.translatedText,
        sourceLanguage: state.currentTranslation.sourceLanguage,
        targetLanguage: state.currentTranslation.targetLanguage,
        status: state.currentTranslation.status,
        error: state.currentTranslation.error,
        // 版本
        versions: state.currentTranslation.versions,
        currentVersionId: state.currentTranslation.currentVersionId,
      }),
      []
    ),
    shallow
  );
};

/**
 * 翻译设置选择器
 */
export const useTranslationSettings = () => {
  return useTranslationStore(
    useCallback(
      (state) => ({
        translationMode: state.translationMode,
        useStreamOutput: state.useStreamOutput,
        autoTranslate: state.autoTranslate,
        autoTranslateDelay: state.autoTranslateDelay,
      }),
      []
    ),
    shallow
  );
};

/**
 * OCR 状态选择器
 */
export const useOcrStatus = () => {
  return useTranslationStore(
    useCallback(
      (state) => ({
        isProcessing: state.ocrStatus.isProcessing,
        engine: state.ocrStatus.engine,
        lastResult: state.ocrStatus.lastResult,
        error: state.ocrStatus.error,
      }),
      []
    ),
    shallow
  );
};

/**
 * 历史记录选择器
 */
export const useHistorySelector = () => {
  return useTranslationStore(
    useCallback(
      (state) => ({
        history: state.history,
        historyLimit: state.historyLimit,
      }),
      []
    ),
    shallow
  );
};

/**
 * 收藏选择器
 */
export const useFavoritesSelector = () => {
  return useTranslationStore(
    useCallback(
      (state) => ({
        favorites: state.favorites,
      }),
      []
    ),
    shallow
  );
};

/**
 * 统计数据选择器
 */
export const useStatisticsSelector = () => {
  return useTranslationStore(
    useCallback(
      (state) => ({
        statistics: state.statistics,
      }),
      []
    ),
    shallow
  );
};

/**
 * Actions 选择器 - actions 不会触发重渲染
 */
export const useTranslationActions = () => {
  return useTranslationStore(
    useCallback(
      (state) => ({
        // 设置方法
        setSourceText: state.setSourceText,
        setTranslatedText: state.setTranslatedText,
        setLanguages: state.setLanguages,
        setTargetLanguage: state.setTargetLanguage,
        swapLanguages: state.swapLanguages,
        setTranslationMode: state.setTranslationMode,
        setUseStreamOutput: state.setUseStreamOutput,
        setAutoTranslate: state.setAutoTranslate,
        setAutoTranslateDelay: state.setAutoTranslateDelay,
        setOcrEngine: state.setOcrEngine,
        // 翻译方法
        translate: state.translate,
        streamTranslate: state.streamTranslate,
        recognizeImage: state.recognizeImage,
        batchTranslate: state.batchTranslate,
        // 历史/收藏
        addToHistory: state.addToHistory,
        removeFromHistory: state.removeFromHistory,
        restoreFromHistory: state.restoreFromHistory,
        clearHistory: state.clearHistory,
        addToFavorites: state.addToFavorites,
        removeFromFavorites: state.removeFromFavorites,
        // 版本管理
        addStyleVersion: state.addStyleVersion,
        switchVersion: state.switchVersion,
        // 剪贴板
        copyToClipboard: state.copyToClipboard,
        pasteFromClipboard: state.pasteFromClipboard,
        // 工具
        searchHistory: state.searchHistory,
        exportHistory: state.exportHistory,
        importHistory: state.importHistory,
        getGlossaryTerms: state.getGlossaryTerms,
        // 隐私模式
        isFeatureEnabled: state.isFeatureEnabled,
        isProviderAllowed: state.isProviderAllowed,
        canSaveHistory: state.canSaveHistory,
        canUseOnlineApi: state.canUseOnlineApi,
        canUseCache: state.canUseCache,
        getModeConfig: state.getModeConfig,
      }),
      []
    ),
    shallow
  );
};

/**
 * 组合选择器 - 常用组合
 */
export const useTranslationPanel = () => {
  const state = useTranslationSelectors();
  const settings = useTranslationSettings();
  const actions = useTranslationActions();
  
  return {
    ...state,
    ...settings,
    ...actions,
  };
};

export default {
  useTranslationSelectors,
  useTranslationSettings,
  useOcrStatus,
  useHistorySelector,
  useFavoritesSelector,
  useStatisticsSelector,
  useTranslationActions,
  useTranslationPanel,
};
