// src/utils/llm-client.js
import axios from 'axios';
import config from '../config/default.js';

/**
 * LM Studio 客户端
 * 封装与本地 LLM 的所有交互
 */
class LLMClient {
  constructor(customConfig = {}) {
    this.config = { ...config.llm, ...customConfig };
    this.client = axios.create({
      baseURL: this.config.endpoint,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // 请求拦截器
    this.client.interceptors.request.use(
      (request) => {
        console.log('[LLM] Request:', request.method, request.url);
        return request;
      },
      (error) => {
        console.error('[LLM] Request error:', error);
        return Promise.reject(error);
      }
    );

    // 响应拦截器
    this.client.interceptors.response.use(
      (response) => {
        console.log('[LLM] Response:', response.status);
        return response;
      },
      (error) => {
        console.error('[LLM] Response error:', error.message);
        return Promise.reject(error);
      }
    );
  }

  /**
   * 测试连接
   */
  async testConnection() {
    try {
      const response = await this.client.get('/models');
      return {
        success: true,
        models: response.data?.data || [],
        message: 'LM Studio 连接成功'
      };
    } catch (error) {
      return {
        success: false,
        models: [],
        message: `连接失败: ${error.message}`
      };
    }
  }

  /**
   * 获取可用模型列表
   */
  async getModels() {
    try {
      const response = await this.client.get('/models');
      return response.data?.data || [];
    } catch (error) {
      console.error('获取模型列表失败:', error);
      return [];
    }
  }

  /**
   * 文本聊天完成
   */
  async chatCompletion(messages, options = {}) {
    try {
      const requestData = {
        model: options.model || this.config.models.chat || 'local-model',
        messages: messages,
        temperature: options.temperature || this.config.defaultParams.temperature,
        max_tokens: options.max_tokens || this.config.defaultParams.max_tokens,
        stream: options.stream || false
      };

      const response = await this.client.post('/chat/completions', requestData);
      
      if (response.data?.choices?.[0]?.message) {
        return {
          success: true,
          content: response.data.choices[0].message.content,
          usage: response.data.usage,
          model: response.data.model
        };
      } else {
        throw new Error('Invalid response format');
      }
    } catch (error) {
      console.error('Chat completion error:', error);
      return {
        success: false,
        error: error.message,
        content: null
      };
    }
  }

  /**
   * 翻译文本
   */
  async translate(text, targetLang = 'Chinese', sourceLang = 'auto', options = {}) {
    const systemPrompt = this.config.systemPrompt || config.translation.systemPrompt;
    const prompt = systemPrompt.replace('{targetLanguage}', targetLang);
    
    const messages = [
      { role: 'system', content: prompt },
      { role: 'user', content: `请翻译以下内容:\n\n${text}` }
    ];

    return await this.chatCompletion(messages, options);
  }

  /**
   * 视觉识别（用于OCR）
   * 需要 LM Studio 加载支持视觉的模型如 llava
   */
  async visionOCR(imageBase64, options = {}) {
    try {
      const messages = [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: options.prompt || config.ocr.visionPrompt
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`
              }
            }
          ]
        }
      ];

      const requestData = {
        model: options.model || this.config.models.vision || 'llava-v1.5-7b',
        messages: messages,
        max_tokens: options.max_tokens || 1000,
        temperature: 0.1  // OCR 需要低温度
      };

      const response = await this.client.post('/chat/completions', requestData);
      
      if (response.data?.choices?.[0]?.message) {
        return {
          success: true,
          text: response.data.choices[0].message.content,
          model: response.data.model
        };
      } else {
        throw new Error('Invalid vision response');
      }
    } catch (error) {
      console.error('Vision OCR error:', error);
      return {
        success: false,
        error: error.message,
        text: null
      };
    }
  }

  /**
   * 批量翻译
   */
  async batchTranslate(texts, targetLang = 'Chinese', options = {}) {
    if (!Array.isArray(texts)) {
      texts = [texts];
    }

    const delimiter = config.translation.batch.delimiter;
    const maxLength = config.translation.batch.maxLength;
    
    const results = [];
    let currentBatch = [];
    let currentLength = 0;

    for (const text of texts) {
      if (currentLength + text.length > maxLength && currentBatch.length > 0) {
        // 处理当前批次
        const batchText = currentBatch.join(delimiter);
        const result = await this.translate(batchText, targetLang, 'auto', options);
        
        if (result.success) {
          const translations = result.content.split(delimiter);
          results.push(...translations);
        } else {
          results.push(...currentBatch.map(() => '[翻译失败]'));
        }
        
        currentBatch = [text];
        currentLength = text.length;
      } else {
        currentBatch.push(text);
        currentLength += text.length;
      }
    }

    // 处理最后一批
    if (currentBatch.length > 0) {
      const batchText = currentBatch.join(delimiter);
      const result = await this.translate(batchText, targetLang, 'auto', options);
      
      if (result.success) {
        const translations = result.content.split(delimiter);
        results.push(...translations);
      } else {
        results.push(...currentBatch.map(() => '[翻译失败]'));
      }
    }

    return results;
  }

  /**
   * 流式聊天（用于实时显示）
   */
  async *streamChat(messages, options = {}) {
    try {
      const requestData = {
        model: options.model || this.config.models.chat,
        messages: messages,
        temperature: options.temperature || this.config.defaultParams.temperature,
        max_tokens: options.max_tokens || this.config.defaultParams.max_tokens,
        stream: true
      };

      const response = await this.client.post('/chat/completions', requestData, {
        responseType: 'stream'
      });

      const stream = response.data;
      let buffer = '';

      for await (const chunk of stream) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              return;
            }
            try {
              const json = JSON.parse(data);
              if (json.choices?.[0]?.delta?.content) {
                yield json.choices[0].delta.content;
              }
            } catch (e) {
              console.error('Parse stream error:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('Stream chat error:', error);
      yield `[错误: ${error.message}]`;
    }
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.client.defaults.baseURL = this.config.endpoint;
    this.client.defaults.timeout = this.config.timeout;
  }
}

// 创建默认实例
const llmClient = new LLMClient();

// 导出类和默认实例
export default llmClient;
export { LLMClient };