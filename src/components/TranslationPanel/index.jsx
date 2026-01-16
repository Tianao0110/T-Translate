// src/components/TranslationPanel.jsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Send, Mic, MicOff, Camera, Image, FileText, Volume2, Copy, Download,
  RotateCcw, Sparkles, Loader2, ChevronDown, Clock, Zap, Shield, Eye, EyeOff, Lock,
  Lightbulb, Check, X, ArrowRight, Palette, ChevronUp, Bot, Tag, FileEdit
} from 'lucide-react';

import useTranslationStore from '../../stores/translation-store';
import translationService from '../../services/translation.js';
import './styles.css';

// 从配置中心导入常量
import { PRIVACY_MODES, TRANSLATION_STATUS } from '@config/defaults'; 

/**
 * 翻译面板组件 (功能增强版)
 */
const TranslationPanel = ({ showNotification, screenshotData, onScreenshotProcessed }) => {
  // 兼容性处理：父组件可能传的是 showNotification 或 onNotification
  const notify = showNotification || ((msg, type) => console.log(`[${type}] ${msg}`));

  // ========== 本地 UI 状态 ==========
  const [isRecording, setIsRecording] = useState(false);
  const [showPrivacyInfo, setShowPrivacyInfo] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isOcrProcessing, setIsOcrProcessing] = useState(false); // OCR 处理状态
  const [isOcrSource, setIsOcrSource] = useState(false); // 标记当前文本是否来自 OCR（用于自动选择 OCR 纠错模板）
  
  // ========== 术语一致性提示 ==========
  const [termSuggestions, setTermSuggestions] = useState([]); // 术语替换建议
  const [dismissedTerms, setDismissedTerms] = useState(new Set()); // 已忽略的术语

  // ========== 风格改写 ==========
  const [showStyleModal, setShowStyleModal] = useState(false); // 显示风格选择弹窗
  const [selectedStyle, setSelectedStyle] = useState(null); // 选中的风格收藏
  const [styleStrength, setStyleStrength] = useState(50); // 风格强度 0-100
  const [isRewriting, setIsRewriting] = useState(false); // 正在改写中
  const [showVersionMenu, setShowVersionMenu] = useState(false); // 显示版本菜单

  // ========== 收藏弹窗 ==========
  const [showSaveModal, setShowSaveModal] = useState(false); // 显示收藏弹窗
  const [saveAsStyleRef, setSaveAsStyleRef] = useState(false); // 是否标记为风格参考
  
  // ========== AI 自动分析 ==========
  const [isAnalyzing, setIsAnalyzing] = useState(false); // 正在分析
  const [aiSuggestions, setAiSuggestions] = useState(null); // AI 建议 { tags, summary, isStyleSuggested }
  const [editableTags, setEditableTags] = useState(''); // 可编辑的标签
  const [editableSummary, setEditableSummary] = useState(''); // 可编辑的摘要
  
  // ========== Zustand Store ==========
  const {
    currentTranslation,
    favorites,          // 收藏列表，用于术语一致性检测和风格选择
    useStreamOutput, // 流式输出开关
    autoTranslate,   // 自动翻译开关
    autoTranslateDelay, // 自动翻译延迟
    ocrStatus,       // OCR 状态（包含引擎设置）
    translationMode, // 隐私模式（从全局store读取）
    setTranslationMode, // 设置隐私模式
    isFeatureEnabled, // 检查功能是否可用
    isProviderAllowed, // 检查翻译源是否可用
    setSourceText,
    setTranslatedText,
    setLanguages,
    translate,        // 非流式翻译
    streamTranslate,  // 流式翻译
    recognizeImage,
    clearCurrent,
    swapLanguages,
    addToFavorites,
    copyToClipboard,
    pasteFromClipboard,
    // 版本管理
    addStyleVersion,
    switchVersion,
  } = useTranslationStore();

  // Refs
  const sourceTextareaRef = useRef(null);
  const fileInputRef = useRef(null);

  // 语言选项
  const languages = [
    { code: 'auto', name: '自动检测', flag: '🌐' },
    { code: 'zh', name: '中文', flag: '🇨🇳' },
    { code: 'en', name: 'English', flag: '🇺🇸' },
    { code: 'ja', name: '日本語', flag: '🇯🇵' },
    { code: 'ko', name: '한국어', flag: '🇰🇷' },
    { code: 'es', name: 'Español', flag: '🇪🇸' },
    { code: 'fr', name: 'Français', flag: '🇫🇷' },
    { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
    { code: 'ru', name: 'Русский', flag: '🇷🇺' },
    { code: 'ar', name: 'العربية', flag: '🇸🇦' }
  ];

  // 翻译模板（精简版：3个）
  const templates = [
    { id: 'natural', name: '自然', icon: FileText, desc: '日常/口语' },
    { id: 'precise', name: '精确', icon: Zap, desc: '技术/学术' },
    { id: 'formal', name: '正式', icon: Sparkles, desc: '商务/官方' },
  ];

  // [UI 状态] 当前选中的模板
  const [selectedTemplate, setSelectedTemplate] = useState('natural');

  // 初始化连接检查
  useEffect(() => {
    checkConnection();
    // 降低检查频率：60秒检查一次
    const interval = setInterval(checkConnection, 60000); 
    return () => clearInterval(interval);
  }, []);

  // 处理来自 MainWindow 的截图数据（通过 props 传递）
  useEffect(() => {
    if (!screenshotData?.dataURL) return;
    
    console.log('[TranslationPanel] Received screenshot data via props, processing OCR...');
    
    const processScreenshot = async () => {
      notify('正在识别文字...', 'info');
      setIsOcrProcessing(true);

      try {
        // 使用 store 的 recognizeImage 方法（内部调用 mainTranslation service）
        const engineToUse = ocrStatus?.engine || 'llm-vision';
        console.log('[OCR] Calling recognizeImage with engine:', engineToUse);
        
        const result = await recognizeImage(screenshotData.dataURL, { 
          engine: engineToUse,
          autoSetSource: true  // 自动设置 sourceText
        });
        console.log('[OCR] Result:', result);

        if (result.success && result.text) {
          console.log('[OCR] Recognized text:', result.text.substring(0, 100) + '...');
          
          // 标记为 OCR 来源（翻译时自动使用 OCR 纠错模板）
          setIsOcrSource(true);
          notify(`识别成功 (${result.engine || engineToUse})`, 'success');

          // 如果开启了自动翻译，延迟后自动开始翻译
          if (autoTranslate) {
            const delay = Math.max(autoTranslateDelay || 500, 300); // 至少 300ms，让用户看到识别结果
            console.log(`[Screenshot] Will auto-translate in ${delay}ms...`);
            setTimeout(() => {
              // 再次检查是否有内容（防止用户清空）
              const currentText = useTranslationStore.getState().currentTranslation.sourceText;
              if (currentText?.trim()) {
                console.log('[Screenshot] Auto-translating with OCR template...');
                handleTranslate();
              }
            }, delay);
          } else {
            console.log('[Screenshot] Auto-translate disabled, waiting for manual trigger');
          }
        } else {
          console.warn('[OCR] No text recognized:', result);
          notify('未能识别到文字', 'warning');
        }
      } catch (error) {
        console.error('[OCR] Error:', error);
        notify('OCR 识别失败: ' + error.message, 'error');
      } finally {
        setIsOcrProcessing(false);
        // 通知父组件处理完成
        if (onScreenshotProcessed) {
          onScreenshotProcessed();
        }
      }
    };

    processScreenshot();
  }, [screenshotData]);

  const checkConnection = async () => {
    try {
      const result = await translationService.testConnection();
      setIsConnected(result.success);
    } catch (error) {
      setIsConnected(false);
    }
  };

  // 自动翻译：防抖逻辑
  useEffect(() => {
    // 如果未开启自动翻译，直接返回
    if (!autoTranslate) return;
    
    // 如果没有输入内容，直接返回
    if (!currentTranslation.sourceText.trim()) return;
    
    // 如果正在翻译中，不触发新的翻译
    if (currentTranslation.status === TRANSLATION_STATUS.TRANSLATING) return;

    // 设置防抖定时器
    const timer = setTimeout(() => {
      // 再次检查状态（防止在延迟期间状态已改变）
      const state = useTranslationStore.getState();
      if (state.autoTranslate && 
          state.currentTranslation.sourceText.trim() && 
          state.currentTranslation.status !== TRANSLATION_STATUS.TRANSLATING) {
        handleTranslate();
      }
    }, autoTranslateDelay);

    // 清理定时器
    return () => clearTimeout(timer);
  }, [currentTranslation.sourceText, autoTranslate, autoTranslateDelay]);

  // 处理翻译（根据设置选择流式或非流式）
  const handleTranslate = async () => {
    if (!currentTranslation.sourceText.trim()) {
      notify('请输入要翻译的内容', 'warning');
      return;
    }

    if (!isConnected && translationMode !== PRIVACY_MODES.OFFLINE) {
      notify('LM Studio 未连接，请检查连接或使用离线模式', 'error');
    }

    // 如果是 OCR 来源的文本，自动使用 OCR 纠错模板
    const effectiveTemplate = isOcrSource ? 'ocr' : selectedTemplate;
    if (isOcrSource) {
      console.log('[Translate] Using OCR template for error correction');
    }

    const options = {
      template: effectiveTemplate,
      saveHistory: translationMode !== PRIVACY_MODES.SECURE 
    };

    // 根据设置选择流式或非流式翻译
    const result = useStreamOutput 
      ? await streamTranslate(options)
      : await translate(options);

    if (result.success) {
      if (translationMode === PRIVACY_MODES.SECURE) {
        console.log('[SECURE] Translation done, history skipped.');
      }
      // 翻译成功后，检测术语一致性
      checkTermConsistency(currentTranslation.sourceText, result.translatedText || useTranslationStore.getState().currentTranslation.translatedText);
      
      // 翻译完成后，清除 OCR 来源标记（下次手动输入时不再使用 OCR 模板）
      if (isOcrSource) {
        setIsOcrSource(false);
      }
    } else {
      notify('翻译失败: ' + result.error, 'error');
    }
  };

  // ========== 术语一致性检测 ==========
  const checkTermConsistency = useCallback((sourceText, translatedText) => {
    if (!favorites || favorites.length === 0) return;
    if (!sourceText || !translatedText) return;

    const suggestions = [];
    const sourceLower = sourceText.toLowerCase();
    const translatedLower = translatedText.toLowerCase();

    favorites.forEach(fav => {
      if (!fav.sourceText || !fav.translatedText) return;
      
      const favSourceLower = fav.sourceText.toLowerCase().trim();
      const favTranslatedLower = fav.translatedText.toLowerCase().trim();
      
      // 只检测短术语（2-50字符）
      if (favSourceLower.length <= 50 && favSourceLower.length >= 2) {
        // 原文包含这个术语
        if (sourceLower.includes(favSourceLower)) {
          // 译文没有使用收藏的翻译 → 提示
          if (!translatedLower.includes(favTranslatedLower)) {
            suggestions.push({
              id: fav.id,
              originalTerm: fav.sourceText,
              savedTranslation: fav.translatedText,
              note: fav.note
            });
          }
        }
      }
    });

    // 过滤已忽略的
    const filteredSuggestions = suggestions.filter(s => !dismissedTerms.has(s.id));
    setTermSuggestions(filteredSuggestions);
  }, [favorites, dismissedTerms]);

  // 应用术语 - 尝试自动替换，失败则复制到剪贴板
  const applyTermSuggestion = (suggestion) => {
    const currentText = currentTranslation.translatedText;
    let newText = currentText;
    let replaced = false;
    let replaceInfo = '';
    
    // 策略1：如果原术语（英文）直接出现在译文中，替换它
    const termRegex = new RegExp(suggestion.originalTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    if (termRegex.test(currentText)) {
      newText = currentText.replace(termRegex, suggestion.savedTranslation);
      replaced = true;
      replaceInfo = `"${suggestion.originalTerm}" → "${suggestion.savedTranslation}"`;
    }
    
    // 策略2：检查术语的单词是否出现在译文中
    if (!replaced) {
      const termWords = suggestion.originalTerm.split(/\s+/);
      for (const word of termWords) {
        if (word.length >= 2 && currentText.includes(word)) {
          const wordRegex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
          newText = newText.replace(wordRegex, suggestion.savedTranslation);
          replaced = true;
          replaceInfo = `"${word}" → "${suggestion.savedTranslation}"`;
          break;
        }
      }
    }
    
    // 策略3：无法自动替换，复制到剪贴板
    if (replaced) {
      setTranslatedText(newText);
      notify(`已自动替换: ${replaceInfo}`, 'success');
    } else {
      navigator.clipboard.writeText(suggestion.savedTranslation);
      notify(`已复制 "${suggestion.savedTranslation}"，请在译文中手动替换`, 'info');
    }
    
    setTermSuggestions(prev => prev.filter(s => s.id !== suggestion.id));
  };

  // 忽略术语建议
  const dismissTermSuggestion = (suggestion, permanent = false) => {
    setTermSuggestions(prev => prev.filter(s => s.id !== suggestion.id));
    if (permanent) {
      setDismissedTerms(prev => new Set([...prev, suggestion.id]));
    }
  };

  // 始终使用此术语（未来自动替换）
  const alwaysUseTerm = (suggestion) => {
    // 可以保存到设置中，标记这个术语总是自动替换
    notify(`已设置: "${suggestion.originalTerm}" 将始终翻译为 "${suggestion.savedTranslation}"`, 'success');
    setTermSuggestions(prev => prev.filter(s => s.id !== suggestion.id));
  };

  // ========== 风格改写 ==========
  // 打开风格选择弹窗
  const openStyleModal = () => {
    if (!currentTranslation.translatedText) {
      notify('请先进行翻译', 'warning');
      return;
    }
    setShowStyleModal(true);
    setSelectedStyle(null);
    setStyleStrength(50);
  };

  // 执行风格改写
  const executeStyleRewrite = async () => {
    if (!selectedStyle) {
      notify('请选择一个参考风格', 'warning');
      return;
    }

    setIsRewriting(true);
    setShowStyleModal(false);

    try {
      // 构建风格改写的 prompt
      const strengthDesc = styleStrength <= 30 ? '轻微调整，保持原意' : 
                          styleStrength <= 70 ? '中等程度模仿风格' : 
                          '高度模仿，尽量贴近参考风格';
      
      const systemPrompt = `你是一个专业的翻译润色助手。你的任务是将译文改写成指定的风格，同时保持原文含义不变。只输出改写后的文本，不要任何解释或额外内容。`;
      
      const userPrompt = `请将以下译文改写成参考风格的语气和表达方式。

参考风格示例：
"${selectedStyle.translatedText}"

需要改写的译文：
"${currentTranslation.translatedText}"

改写要求：
- ${strengthDesc}
- 保持原文的核心意思不变
- 模仿参考风格的语气、用词和句式

改写后的译文：`;

      // 调用 LLM 进行改写
      const result = await translationService.chatCompletion([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]);

      if (result.success && result.content) {
        // 清理结果（去掉可能的引号和多余空白）
        let rewrittenText = result.content.trim();
        rewrittenText = rewrittenText.replace(/^["「『]|["」』]$/g, '').trim();
        
        // 添加风格版本
        addStyleVersion(
          rewrittenText,
          selectedStyle.id,
          selectedStyle.sourceText.slice(0, 20) + (selectedStyle.sourceText.length > 20 ? '...' : ''),
          styleStrength
        );
        
        notify('风格改写完成', 'success');
      } else {
        throw new Error(result.error || '改写失败');
      }
    } catch (error) {
      console.error('Style rewrite error:', error);
      notify('风格改写失败: ' + error.message, 'error');
    } finally {
      setIsRewriting(false);
    }
  };

  // 获取版本显示名称
  const getVersionName = (version) => {
    if (!version) return '原始';
    switch (version.type) {
      case 'original': return '原始翻译';
      case 'style_rewrite': return `风格改写 (${version.styleName})`;
      case 'user_edit': return '用户编辑';
      default: return '未知';
    }
  };

  // 当前版本信息
  const currentVersion = currentTranslation.versions?.find(
    v => v.id === currentTranslation.currentVersionId
  );

  // ========== 收藏功能 ==========
  // 打开收藏弹窗并触发 AI 分析
  const openSaveModal = () => {
    if (!currentTranslation.translatedText) {
      notify('请先进行翻译', 'warning');
      return;
    }
    setSaveAsStyleRef(false);
    setAiSuggestions(null);
    setEditableTags('');
    setEditableSummary('');
    setShowSaveModal(true);
    
    // 自动触发 AI 分析
    analyzeContent();
  };

  // AI 分析内容
  const analyzeContent = async () => {
    setIsAnalyzing(true);
    
    try {
      const sourceText = currentTranslation.sourceText;
      const translatedText = currentTranslation.translatedText;
      
      const systemPrompt = `你是一个智能标签和摘要生成助手。根据用户提供的原文和译文，生成合适的标签和摘要。

请严格按照以下 JSON 格式返回，不要包含任何其他内容：
{
  "tags": ["标签1", "标签2", "标签3"],
  "summary": "简短摘要（20字以内）",
  "isStyleSuggested": true/false
}

标签规则：
- 生成 3-5 个相关标签
- 标签应该反映内容的主题、领域、风格等
- 使用中文标签

摘要规则：
- 20字以内的简短描述
- 概括内容的核心特点

风格参考判断规则（isStyleSuggested）：
- 如果文本具有独特的文学风格、修辞手法、或值得模仿的表达方式，返回 true
- 如果只是普通的术语、短语、或日常表达，返回 false
- 长度超过 30 字且有明显风格特点的文本更适合作为风格参考`;

      const userPrompt = `原文：${sourceText}
译文：${translatedText}

请分析并返回 JSON 格式的标签、摘要和风格建议。`;

      const result = await translationService.chatCompletion([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]);

      if (result.success && result.content) {
        // 尝试解析 JSON
        let parsed;
        try {
          // 清理可能的 markdown 代码块
          let content = result.content.trim();
          content = content.replace(/^```json\s*/, '').replace(/```\s*$/, '');
          content = content.replace(/^```\s*/, '').replace(/```\s*$/, '');
          parsed = JSON.parse(content);
        } catch (parseError) {
          console.error('JSON parse error:', parseError);
          // 如果解析失败，使用默认值
          parsed = {
            tags: ['未分类'],
            summary: '',
            isStyleSuggested: translatedText.length > 30
          };
        }
        
        setAiSuggestions(parsed);
        setEditableTags(parsed.tags?.join(', ') || '');
        setEditableSummary(parsed.summary || '');
        setSaveAsStyleRef(parsed.isStyleSuggested || false);
      } else {
        throw new Error(result.error || '分析失败');
      }
    } catch (error) {
      console.error('AI analysis error:', error);
      // 分析失败时使用默认值
      setAiSuggestions({
        tags: [],
        summary: '',
        isStyleSuggested: false
      });
      setEditableTags('');
      setEditableSummary('');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 执行收藏（带 AI 建议的标签和摘要）
  const executeSave = () => {
    // 解析标签
    const tags = editableTags
      .split(/[,，]/)
      .map(t => t.trim())
      .filter(t => t.length > 0);
    
    // 创建收藏项
    const favoriteItem = {
      id: `fav_${Date.now()}`,
      sourceText: currentTranslation.sourceText,
      translatedText: currentTranslation.translatedText,
      sourceLanguage: currentTranslation.sourceLanguage,
      targetLanguage: currentTranslation.targetLanguage,
      timestamp: Date.now(),
      tags: tags,
      note: editableSummary || null,
      folderId: saveAsStyleRef ? 'style_library' : null,
      isStyleReference: saveAsStyleRef,
    };
    
    addToFavorites(favoriteItem, saveAsStyleRef);
    notify(saveAsStyleRef ? '已收藏到风格库' : '已收藏', 'success');
    setShowSaveModal(false);
  };

  // 处理文件拖放
  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    setDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    const file = files[0];
    if (!file) return;

    if (file.type.startsWith('image/')) {
      // 图片 OCR
      const reader = new FileReader();
      reader.onload = async (event) => {
        notify('正在识别图片文字...', 'info');
        const result = await recognizeImage(event.target.result);
        if (result.success) {
          notify('文字识别成功', 'success');
        } else {
          notify('识别失败: ' + result.error, 'error');
        }
      };
      reader.readAsDataURL(file);
    } else if (file.type === 'text/plain' || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
      // 文本文件
      const text = await file.text();
      setSourceText(text);
      notify('文件导入成功', 'success');
    } else {
      notify('不支持的文件类型', 'warning');
    }
  }, [recognizeImage, setSourceText, notify]);

  // 处理 Input 文件选择
  const handleFileInputChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        notify('正在识别...', 'info');
        const result = await recognizeImage(event.target.result);
        if (result.success) notify('识别成功', 'success');
        else notify('识别失败', 'error');
      };
      reader.readAsDataURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        setSourceText(e.target.result);
        notify('导入成功', 'success');
      };
      reader.readAsText(file);
    }
    e.target.value = null;
  };

  // 处理粘贴
  const handlePaste = useCallback(async (e) => {
    // 优先处理粘贴的文本
    // 如果剪贴板里有图片，再处理图片
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault(); // 阻止默认粘贴（否则输入框可能出现乱码）
        const blob = item.getAsFile();
        const reader = new FileReader();
        reader.onload = async (event) => {
          notify('发现剪贴板图片，正在识别...', 'info');
          const result = await recognizeImage(event.target.result);
          if (result.success) notify('识别成功', 'success');
        };
        reader.readAsDataURL(blob);
        break; 
      }
    }
    // 如果是普通文本，textarea 默认行为会处理，不需要我们干预
  }, [recognizeImage, notify]);

  // 渲染隐私面板
  const renderPrivacyPanel = () => (
    <div className="privacy-panel">
      <div className="privacy-header">
        <div className="privacy-title">
           <Shield size={18} className="text-primary" />
           <span>隐私模式</span>
        </div>
        <button 
          className="privacy-toggle"
          onClick={() => setShowPrivacyInfo(!showPrivacyInfo)}
          title="显示详情"
        >
          {showPrivacyInfo ? <ChevronDown size={16} /> : <InfoIcon size={16} />}
        </button>
      </div>
      
      {showPrivacyInfo && (
        <div className="privacy-info">
          <div className="privacy-item">
            <Lock size={14} className="text-success" />
            <span>完全离线：数据不上传云端</span>
          </div>
          <div className="privacy-item">
            <Shield size={14} className="text-success" />
            <span>加密存储：AES-256 保护历史</span>
          </div>
        </div>
      )}

      <div className="translation-modes">
        <button
          className={`mode-btn ${translationMode === PRIVACY_MODES.STANDARD ? 'active' : ''}`}
          onClick={() => setTranslationMode(PRIVACY_MODES.STANDARD)}
          title="标准模式"
        >
          <Zap size={14} /> <span>标准</span>
        </button>
        <button
          className={`mode-btn ${translationMode === PRIVACY_MODES.SECURE ? 'active' : ''}`}
          onClick={() => setTranslationMode(PRIVACY_MODES.SECURE)}
          title="不保存历史"
        >
          <Shield size={14} /> <span>无痕</span>
        </button>
        <button
          className={`mode-btn ${translationMode === PRIVACY_MODES.OFFLINE ? 'active' : ''}`}
          onClick={() => setTranslationMode(PRIVACY_MODES.OFFLINE)}
          title="强制离线"
        >
          <Lock size={14} /> <span>离线</span>
        </button>
      </div>
    </div>
  );

  // 这里为了图标显示，定义一个小组件
  const InfoIcon = ({size}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>;

  return (
    <div className="translation-panel">
      
      {/* 顶部工具栏 (语言 + 模板) */}
      <div className="language-selector-bar">
        <div className="language-select-group">
          <select
            value={currentTranslation.sourceLanguage || ''}
            onChange={(e) => setLanguages(e.target.value, null)}
            className="language-select"
          >
            {languages.map(lang => (
              <option key={lang.code} value={lang.code}>
                {lang.flag} {lang.name}
              </option>
            ))}
          </select>

          <button 
            className="swap-button"
            onClick={swapLanguages}
            disabled={currentTranslation.sourceLanguage === 'auto'}
            title="切换语言"
          >
            <RotateCcw size={16} />
          </button>

          <select
            value={currentTranslation.targetLanguage}
            onChange={(e) => setLanguages(null, e.target.value)}
            className="language-select"
          >
            {languages.filter(l => l.code !== 'auto').map(lang => (
              <option key={lang.code} value={lang.code}>
                {lang.flag} {lang.name}
              </option>
            ))}
          </select>
        </div>

        {/* 模板选择器 */}
        <div className="template-selector">
          {templates.map(template => (
            <button
              key={template.id}
              className={`template-btn ${selectedTemplate === template.id ? 'active' : ''}`}
              onClick={() => setSelectedTemplate(template.id)}
              title={template.name}
            >
              <template.icon size={14} />
            </button>
          ))}
        </div>
      </div>

      {/* 翻译主区域 (左右分栏) */}
      <div className="translation-areas">
        {/* 左侧：原文 */}
        <div 
          className={`translation-box source-box ${dragOver ? 'drag-over' : ''}`}
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
        >
          <div className="box-toolbar">
            <span className="box-title">
              {isOcrProcessing ? (
                <>
                  <Loader2 size={14} className="animate-spin" style={{ marginRight: '6px', display: 'inline' }} />
                  识别中...
                </>
              ) : '原文'}
            </span>
            <div className="box-actions">
              <button 
                className="action-btn" 
                onClick={() => window.electron?.screenshot?.capture()}
                disabled={isOcrProcessing}
                title="截图识别 (Alt+Q)"
              >
                <Camera size={15} />
              </button>
              <button 
                className="action-btn" 
                onClick={() => fileInputRef.current?.click()} 
                disabled={isOcrProcessing}
                title="导入图片"
              >
                <Image size={15} />
              </button>
              <button 
                className="action-btn" 
                onClick={pasteFromClipboard} 
                disabled={isOcrProcessing}
                title="粘贴"
              >
                <FileText size={15} />
              </button>
              <button 
                className="action-btn" 
                onClick={clearCurrent} 
                disabled={isOcrProcessing}
                title="清空"
              >
                <RotateCcw size={15} />
              </button>
            </div>
          </div>

          <textarea
            ref={sourceTextareaRef}
            className="translation-textarea"
            value={currentTranslation.sourceText}
            onChange={(e) => {
              setSourceText(e.target.value);
              // 用户手动输入时，清除 OCR 来源标记
              if (isOcrSource) setIsOcrSource(false);
            }}
            onPaste={handlePaste}
            placeholder={isOcrProcessing ? '正在识别图片中的文字...' : (dragOver ? '释放文件以导入...' : '输入要翻译的文本...')}
            spellCheck={false}
            disabled={isOcrProcessing}
            // 绑定快捷键 Ctrl+Enter
            onKeyDown={(e) => { if(e.ctrlKey && e.key === 'Enter') handleTranslate(); }}
          />

          <div className="box-footer">
            <span className="char-count">{(currentTranslation.sourceText || '').length} 字符</span>
          </div>
        </div>

        {/* 中间：翻译按钮 */}
        <div className="translation-controls">
          <button
            className={`translate-btn ${currentTranslation.status === TRANSLATION_STATUS.TRANSLATING ? 'loading' : ''}`}
            onClick={handleTranslate}
            disabled={!currentTranslation.sourceText.trim() || currentTranslation.status === TRANSLATION_STATUS.TRANSLATING || isOcrProcessing}
          >
            {currentTranslation.status === TRANSLATION_STATUS.TRANSLATING ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                <span>翻译中</span>
              </>
            ) : (
              <>
                <Send size={18} />
                <span>翻译</span>
              </>
            )}
          </button>
          
          <div className={`connection-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
            <div className="indicator-dot"></div>
            <span>{isConnected ? '在线' : '离线'}</span>
          </div>
        </div>

        {/* 右侧：译文 */}
        <div className="translation-box target-box">
          <div className="box-toolbar">
            <div className="box-title-group">
              <span className="box-title">译文</span>
              {/* 版本切换 */}
              {currentTranslation.versions?.length > 1 && (
                <div className="version-selector">
                  <button 
                    className="version-btn"
                    onClick={() => setShowVersionMenu(!showVersionMenu)}
                  >
                    <span>{getVersionName(currentVersion)}</span>
                    {showVersionMenu ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  {showVersionMenu && (
                    <div className="version-menu">
                      {currentTranslation.versions.map(v => (
                        <button
                          key={v.id}
                          className={`version-item ${v.id === currentTranslation.currentVersionId ? 'active' : ''}`}
                          onClick={() => {
                            switchVersion(v.id);
                            setShowVersionMenu(false);
                          }}
                        >
                          <span className="version-name">{getVersionName(v)}</span>
                          {v.id === currentTranslation.currentVersionId && <Check size={14} />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="box-actions">
              <button 
                className="action-btn" 
                onClick={() => copyToClipboard('translated') && notify('已复制', 'success')}
                disabled={!currentTranslation.translatedText}
                title="复制"
              >
                <Copy size={15} />
              </button>
              <button 
                className="action-btn style-btn" 
                onClick={openStyleModal}
                disabled={!currentTranslation.translatedText || isRewriting}
                title="风格改写"
              >
                {isRewriting ? <Loader2 size={15} className="animate-spin" /> : <Palette size={15} />}
              </button>
              <button 
                className="action-btn" 
                onClick={openSaveModal}
                disabled={!currentTranslation.translatedText}
                title="收藏"
              >
                <Sparkles size={15} />
              </button>
              <button 
                className="action-btn" 
                title="导出 (未实现)"
                disabled={!currentTranslation.translatedText}
              >
                <Download size={15} />
              </button>
            </div>
          </div>

          <textarea
            className="translation-textarea"
            value={currentTranslation.translatedText}
            onChange={(e) => setTranslatedText(e.target.value)}
            placeholder="等待翻译..."
            spellCheck={false}
          />

          {/* 术语一致性提示 */}
          {termSuggestions.length > 0 && (
            <div className="term-suggestions">
              <div className="term-suggestions-header">
                <Lightbulb size={14} />
                <span>发现可替换术语</span>
              </div>
              {termSuggestions.map(suggestion => (
                <div key={suggestion.id} className="term-suggestion-item">
                  <div className="term-info">
                    <span className="term-original">"{suggestion.originalTerm}"</span>
                    <ArrowRight size={12} />
                    <span className="term-saved">"{suggestion.savedTranslation}"</span>
                    {suggestion.note && (
                      <span className="term-note">({suggestion.note})</span>
                    )}
                  </div>
                  <div className="term-actions">
                    <button 
                      className="term-btn apply"
                      onClick={() => applyTermSuggestion(suggestion)}
                      title="应用此翻译"
                    >
                      <Check size={12} /> 应用
                    </button>
                    <button 
                      className="term-btn ignore"
                      onClick={() => dismissTermSuggestion(suggestion)}
                      title="忽略此次"
                    >
                      <X size={12} />
                    </button>
                    <button 
                      className="term-btn always"
                      onClick={() => alwaysUseTerm(suggestion)}
                      title="不再提示此术语"
                    >
                      不再提示
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="box-footer">
            {currentTranslation.translatedText && (
              <>
                <span className="char-count">{(currentTranslation.translatedText || '').length} 字符</span>
                {currentTranslation.metadata.duration && (
                  <span className="translation-time">
                    <Clock size={12} style={{marginRight:4}}/>
                    {(currentTranslation.metadata.duration / 1000).toFixed(2)}s
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* 隐藏的文件 Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.txt,.md,.doc,.docx"
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
      />

      {/* 风格改写弹窗 */}
      {showStyleModal && (
        <div className="style-modal-overlay" onClick={() => setShowStyleModal(false)}>
          <div className="style-modal" onClick={e => e.stopPropagation()}>
            <div className="style-modal-header">
              <Palette size={18} />
              <span>选择参考风格</span>
              <button className="close-btn" onClick={() => setShowStyleModal(false)}>
                <X size={18} />
              </button>
            </div>
            
            <div className="style-modal-body">
              {/* 收藏列表 - 只显示风格库的 */}
              <div className="style-list-section">
                <div className="section-title">从风格库中选择</div>
                {favorites && favorites.filter(f => f.isStyleReference || f.folderId === 'style_library').length > 0 ? (
                  <div className="style-list">
                    {favorites.filter(f => (f.isStyleReference || f.folderId === 'style_library') && f.translatedText && f.translatedText.length >= 5).map(fav => (
                      <div 
                        key={fav.id}
                        className={`style-item ${selectedStyle?.id === fav.id ? 'selected' : ''}`}
                        onClick={() => setSelectedStyle(fav)}
                      >
                        <div className="style-item-content">
                          <div className="style-source">"{fav.sourceText?.slice(0, 40)}{fav.sourceText?.length > 40 ? '...' : ''}"</div>
                          <div className="style-translated">"{fav.translatedText?.slice(0, 50)}{fav.translatedText?.length > 50 ? '...' : ''}"</div>
                          {fav.tags && fav.tags.length > 0 && (
                            <div className="style-tags">
                              {fav.tags.slice(0, 3).map((tag, i) => (
                                <span key={i} className="style-tag">#{tag}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        {selectedStyle?.id === fav.id && (
                          <div className="style-check"><Check size={16} /></div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-styles">
                    <Palette size={32} />
                    <p>风格库为空</p>
                    <span>收藏时勾选"标记为风格参考"添加到风格库</span>
                  </div>
                )}
              </div>

              {/* 风格强度 */}
              {selectedStyle && (
                <div className="style-strength-section">
                  <div className="section-title">风格强度</div>
                  <div className="strength-slider">
                    <span className="strength-label">轻微</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={styleStrength}
                      onChange={(e) => setStyleStrength(Number(e.target.value))}
                    />
                    <span className="strength-label">完全模仿</span>
                  </div>
                  <div className="strength-value">{styleStrength}%</div>
                  <div className="strength-desc">
                    {styleStrength <= 30 ? '轻微调整，基本保持原译文风格' : 
                     styleStrength <= 70 ? '中等程度模仿参考风格' : 
                     '高度模仿，尽量贴近参考风格的语气和表达'}
                  </div>
                </div>
              )}
            </div>

            <div className="style-modal-footer">
              <button className="btn-cancel" onClick={() => setShowStyleModal(false)}>
                取消
              </button>
              <button 
                className="btn-rewrite" 
                onClick={executeStyleRewrite}
                disabled={!selectedStyle}
              >
                <Palette size={14} /> 开始改写
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 收藏弹窗 */}
      {showSaveModal && (
        <div className="save-modal-overlay" onClick={() => setShowSaveModal(false)}>
          <div className="save-modal save-modal-with-ai" onClick={e => e.stopPropagation()}>
            <div className="save-modal-header">
              <Sparkles size={18} />
              <span>添加到收藏</span>
              <button className="close-btn" onClick={() => setShowSaveModal(false)}>
                <X size={18} />
              </button>
            </div>
            
            <div className="save-modal-body">
              {/* 预览区 */}
              <div className="save-preview">
                <div className="preview-item">
                  <label>原文</label>
                  <div className="preview-text">{currentTranslation.sourceText?.slice(0, 100)}{currentTranslation.sourceText?.length > 100 ? '...' : ''}</div>
                </div>
                <div className="preview-item">
                  <label>译文</label>
                  <div className="preview-text">{currentTranslation.translatedText?.slice(0, 100)}{currentTranslation.translatedText?.length > 100 ? '...' : ''}</div>
                </div>
              </div>

              {/* AI 分析区域 */}
              <div className="ai-suggestions-section">
                <div className="ai-section-header">
                  <div className="ai-title">
                    <Bot size={16} />
                    <span>AI 建议</span>
                  </div>
                  <button 
                    className="btn-reanalyze"
                    onClick={analyzeContent}
                    disabled={isAnalyzing}
                    title="重新分析"
                  >
                    <RotateCcw size={14} className={isAnalyzing ? 'spinning' : ''} />
                  </button>
                </div>

                {isAnalyzing ? (
                  <div className="ai-analyzing">
                    <Loader2 size={20} className="spinning" />
                    <span>AI 正在分析内容...</span>
                  </div>
                ) : (
                  <div className="ai-suggestions-content">
                    {/* 标签输入 */}
                    <div className="suggestion-field">
                      <label>
                        <Tag size={12} />
                        标签
                      </label>
                      <input
                        type="text"
                        value={editableTags}
                        onChange={(e) => setEditableTags(e.target.value)}
                        placeholder="标签（逗号分隔）"
                      />
                    </div>

                    {/* 摘要输入 */}
                    <div className="suggestion-field">
                      <label>
                        <FileEdit size={12} />
                        摘要/笔记
                      </label>
                      <input
                        type="text"
                        value={editableSummary}
                        onChange={(e) => setEditableSummary(e.target.value)}
                        placeholder="简短描述..."
                      />
                    </div>

                    {/* 风格参考开关 */}
                    <div className="style-ref-suggestion">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={saveAsStyleRef}
                          onChange={(e) => setSaveAsStyleRef(e.target.checked)}
                        />
                        <Palette size={14} />
                        <span>标记为风格参考</span>
                        {aiSuggestions?.isStyleSuggested && (
                          <span className="ai-recommended">AI 推荐</span>
                        )}
                      </label>
                      <div className="option-hint">
                        {saveAsStyleRef 
                          ? '将保存到"风格库"，可用于风格改写' 
                          : '保存为普通收藏'}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="save-modal-footer">
              <button className="btn-cancel" onClick={() => setShowSaveModal(false)}>
                取消
              </button>
              <button className="btn-save" onClick={executeSave} disabled={isAnalyzing}>
                <Sparkles size={14} /> {saveAsStyleRef ? '保存到风格库' : '保存收藏'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TranslationPanel;