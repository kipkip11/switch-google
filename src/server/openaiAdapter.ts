import { Router, Request, Response, NextFunction } from 'express';
import { ProfileManager } from '../profiles/manager';
import { AccountRotator } from '../profiles/rotator';
import { cleanJSONSchemaForAntigravity } from './schemaCleaner';
import { usageTracker } from '../usage/tracker';

const ANTIGRAVITY_SYSTEM_INSTRUCTION =
  'You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding. You are pair programming with a USER to solve their coding task.';

const DEFAULT_THINKING_AG_SIGNATURE =
  'EuwGCukGAXLI2nxwZIq54WWSoL/YN0P3TsDZ7zRnLi8g0S4aVr2HUGxvaHKySuY6HAVzcE0GPGjXrytLIldxthSvfxgUlJh6Qa9Z+Oj5QZBlYdg6HaJ6yuY5R7waE6rdwBsRf7Ft2j3DJ9rMi9qhWFqApewYtPhls3VHtuvND3l8Rm09+lbAXQs6KKWEWrxNLKTBkfpMgXhRERc/TQRMZu1twAablm6/Zk1tsYRvfWKLsNbeKF+CCojJdXJKvnR/8Ouuoa+Y2Ti20hcW7aZIIjZDFYPU//k6Ybmhg69J/imbFai2ckhfLaisqdDkdoIiBJScTOUvYqP6AE9d4MsydSC+UlhIMk4hoP76R8vUSCZRMkjOaDXstf/QoVZKbt94wyRZgAJ1G0BqI8L5ow86kLpA4wJEtxsRGymOE4bKUvApveBakYDNM9APkf+LbtbzWSseGjoZcSlycF9iN8Q2XNYKRrHbv3Lr5Y8JjdH/5y/6SHkNehTEZugaeGnSPSyCTWto1kQgHpxdWmhkLfJGNUGLmue7Mesj4TSms4J33mRpYVhNB/J333FCqIP0hr/E7BkkjEn7yZ4X7SQlh+xKPurapsnHRwiKmtsilmEFrnTE9iQr+pMr6M29qqFNv1tr5yumbaJw8JW9sB15tNsRv+dW6BjNanbsKz7HCgKUBc8tGy+7YuhXzAfViyRefcjK7eZW0Fbyt7AbybJTKz78W8NH7ye6LAwzOebXpeZ4D43fNIt8bKh26qgduSQv/7o+pAflkuqHZ99YWgHQ8h8OkZFi3eOiSYjsjhdZ/czWOdoPI/OnqIldzMPF5YlrKBLFX8VhRKVmqgsmWf5PHGulHhMkVlS+XG2UIseGy69ARa93D78Gsa+1n1kJr7EEB7Rh+27vUMxVYLdz1yMSvE5nalTAlg/ZeG8+XQ0cHuAI3KbQpHW2Q++RdXfm5JzD5WdJZUU+Zn8t8UUn85BH4RxZLeE0qJikgSsKoYVBc6YhiMjhPgkR95ReimY4Z0xCJdRo1gjexOFeODZMpQF6Yxnoic7IrdgsFA3iePTbFnPp3IAM1fAThWhXJUn3QInUOTd5o1qmTmn6REbL15g/JQNl+dqUoPkhleeb2V3kjqp1okmO3wMZbPknR3S1LZNmlS72/iBQUm+n2b/RCn4PjmM2';

/**
 * Ánh xạ model request từ client (Hermes/OpenAI) sang upstream model của Antigravity
 */
function resolveUpstreamModel(model: string): string {
  const m = model.toLowerCase();
  if (m.includes('claude-3-7-sonnet') || m.includes('claude-3.7-sonnet') || m.includes('claude-3-5-sonnet') || m.includes('claude-sonnet')) {
    return 'claude-sonnet-5-5-high';
  }
  if (m.includes('claude-3-opus') || m.includes('claude-opus')) {
    return 'claude-opus-5-5-high';
  }
  if (m === 'gemini-3.8-flash' || m === 'gemini-flash' || m === 'flash') {
    return 'gemini-3.8-flash-high';
  }
  if (m === 'gemini-3.8-pro' || m === 'gemini-pro' || m === 'gemini-4' || m.includes('argon')) {
    return 'gemini-4-argon-high';
  }
  if (m === 'gpt-4o' || m === 'gpt-4' || m.includes('deepseek')) {
    return 'gemini-4-argon-high';
  }
  return model;
}

/**
 * Chuyển đổi OpenAI Tools spec sang Google Gemini functionDeclarations
 */
function convertToolsToGemini(tools: any[]): any[] {
  if (!Array.isArray(tools) || tools.length === 0) return [];
  const functionDeclarations: any[] = [];

  for (const t of tools) {
    if (t.type === 'function' && t.function) {
      const fn = t.function;
      const decl: any = {
        name: fn.name,
        description: fn.description || ''
      };
      if (fn.parameters) {
        decl.parameters = cleanJSONSchemaForAntigravity(fn.parameters);
      }
      functionDeclarations.push(decl);
    }
  }

  if (functionDeclarations.length === 0) return [];
  return [{ functionDeclarations }];
}

const ANTIGRAVITY_PROMPT_REWRITES = [
  { from: /You are a Claude agent[^\n.]*/gi, to: '' },
  { from: /You are Hermes(?: Agent)?(?:,\s*(?:an intelligent AI assistant|an AI assistant|an AI agent))?(?:,?\s*(?:built|created)\s+by\s+Nous Research)?\./gi, to: 'You are an AI assistant.' },
  { from: /hermes\s*agent/gi, to: 'coding assistant' },
  { from: /hermes-agent/gi, to: 'coding-agent' },
  { from: /hermes/gi, to: 'assistant' },
  { from: /nous\s*research/gi, to: 'DeepMind' },
  { from: /https?:\/\/hermes-agent\.nousresearch\.com\/docs/gi, to: 'https://docs.example.com' },
  { from: /^x-anthropic-billing-header:[^\n]*(?:\r?\n)*/gim, to: '' },
  { from: /opencode/gi, to: 'Antigravity' }
];

function sanitizePromptForAntigravity(text: string): string {
  if (!text || typeof text !== 'string') return text;
  let res = text;
  for (const { from, to } of ANTIGRAVITY_PROMPT_REWRITES) {
    res = res.replace(from, to as any);
  }
  return res;
}

/**
 * Chuyển đổi danh sách tin nhắn OpenAI (kèm Tool Calls & Tool Responses) sang Gemini Contents
 */
function convertMessagesToGemini(messages: any[]): { systemInstruction?: any; contents: any[] } {
  let clientSystemText = '';
  const contents: any[] = [];
  const toolCallMap = new Map<string, string>(); // tool_call_id -> function name

  for (const msg of messages) {
    if (msg.role === 'system') {
      const rawText = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      const text = sanitizePromptForAntigravity(rawText);
      clientSystemText = clientSystemText ? `${clientSystemText}\n\n${text}` : text;
      continue;
    }

    if (msg.role === 'assistant') {
      const parts: any[] = [];
      if (msg.content) {
        const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        parts.push({ text });
      }

      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          if (tc.id && tc.function?.name) {
            toolCallMap.set(tc.id, tc.function.name);
          }
          let args = {};
          try {
            args = typeof tc.function?.arguments === 'string'
              ? JSON.parse(tc.function.arguments || '{}')
              : (tc.function?.arguments || {});
          } catch (_) {
            args = {};
          }
          parts.push({
            functionCall: {
              name: tc.function?.name || 'function',
              args
            },
            thoughtSignature: DEFAULT_THINKING_AG_SIGNATURE
          });
        }
      }

      if (parts.length > 0) {
        contents.push({
          role: 'model',
          parts
        });
      }
      continue;
    }

    if (msg.role === 'tool') {
      // Tin nhắn phản hồi kết quả Tool từ Hermes Agent
      const fnName = msg.name || toolCallMap.get(msg.tool_call_id) || 'tool_function';
      let responseObj: any;
      try {
        responseObj = typeof msg.content === 'string' && msg.content.trim().startsWith('{')
          ? JSON.parse(msg.content)
          : { output: msg.content };
      } catch (_) {
        responseObj = { output: msg.content };
      }

      contents.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: fnName,
              response: responseObj
            }
          }
        ]
      });
      continue;
    }

    // Default: User message
    const rawText = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    const text = sanitizePromptForAntigravity(rawText);
    contents.push({
      role: 'user',
      parts: [{ text }]
    });
  }

  if (clientSystemText) {
    const firstUser = contents.find((c) => c.role === 'user');
    if (firstUser && firstUser.parts && firstUser.parts[0]?.text) {
      firstUser.parts[0].text = `[Instructions & Context:\n${clientSystemText}\n]\n\n${firstUser.parts[0].text}`;
    } else {
      contents.unshift({
        role: 'user',
        parts: [{ text: `[Instructions & Context:\n${clientSystemText}\n]` }]
      });
    }
  }

  const systemInstruction = {
    parts: [{ text: ANTIGRAVITY_SYSTEM_INSTRUCTION }]
  };

  return { systemInstruction, contents };
}

export function createOpenAiRouter(manager: ProfileManager, rotator: AccountRotator): Router {
  const router = Router();

  // Authentication Middleware for Virtual API Keys
  router.use((req: Request, res: Response, next: NextFunction) => {
    const keys = manager.getApiKeys();
    if (keys.length === 0) {
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: {
          message: 'Missing or invalid Authorization header. Provide: Bearer sk-switch-...',
          type: 'invalid_request_error',
          code: 'unauthorized'
        }
      });
      return;
    }

    const token = authHeader.slice(7).trim();
    const matched = keys.find((k) => k.key === token);
    if (!matched) {
      res.status(401).json({
        error: {
          message: 'Invalid API Key provided',
          type: 'invalid_request_error',
          code: 'invalid_api_key'
        }
      });
      return;
    }

    manager.touchApiKey(token);
    next();
  });

  // GET /v1/models
  router.get('/models', (req: Request, res: Response) => {
    const baseModels = [
      'claude-3-7-sonnet',
      'claude-3-7-sonnet-thinking',
      'claude-3-5-sonnet',
      'gemini-3.8-pro',
      'gemini-3.8-flash',
      'gpt-4o',
      'deepseek-r1',
      'deepseek-v3',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-1.5-pro',
      'gemini-1.5-flash'
    ];

    const modelList = baseModels.map((m) => {
      let ownedBy = 'google';
      if (m.startsWith('claude')) ownedBy = 'anthropic (antigravity)';
      else if (m.startsWith('gpt')) ownedBy = 'openai (antigravity)';
      else if (m.startsWith('deepseek')) ownedBy = 'deepseek (antigravity)';
      return {
        id: m,
        object: 'model',
        created: 1700000000,
        owned_by: ownedBy
      };
    });

    const combos = manager.getCombos();
    for (const c of combos) {
      modelList.push({
        id: c.name,
        object: 'model',
        created: c.createdAt,
        owned_by: 'combo'
      } as any);
    }

    res.json({
      object: 'list',
      data: modelList
    });
  });

  // POST /v1/chat/completions
  router.post('/chat/completions', async (req: Request, res: Response) => {
    const requestStartTime = Date.now();
    try {
      const {
        model = 'gemini-1.5-flash',
        messages = [],
        temperature,
        max_tokens,
        tools,
        tool_choice,
        stream = false
      } = req.body;

      console.log(`[Request] model=${model}, stream=${stream}, msgs=${messages.length}, tools=${tools?.length || 0}`);

      // Check if requested model is a Model Combo
      const combos = manager.getCombos();
      const combo = combos.find((c) => c.name.toLowerCase() === model.toLowerCase());

      let modelCandidates: string[] = [];
      if (combo && combo.models.length > 0) {
        modelCandidates = [...combo.models];
        if (combo.strategy === 'round-robin') {
          const first = modelCandidates.shift()!;
          modelCandidates.push(first);
        }
      } else {
        modelCandidates = [model];
      }

      // Convert messages (including tool calls & function results) to Gemini format
      const { systemInstruction, contents } = convertMessagesToGemini(messages);

      const geminiBody: any = {
        contents
      };

      if (systemInstruction) {
        geminiBody.systemInstruction = systemInstruction;
      }

      // Convert tools
      const geminiTools = convertToolsToGemini(tools);
      if (geminiTools.length > 0) {
        geminiBody.tools = geminiTools;
      }

      // Convert tool_choice
      if (tool_choice) {
        if (typeof tool_choice === 'string') {
          if (tool_choice.toUpperCase() === 'NONE') {
            geminiBody.toolConfig = { functionCallingConfig: { mode: 'NONE' } };
          } else if (tool_choice.toUpperCase() === 'REQUIRED' || tool_choice.toUpperCase() === 'ANY') {
            geminiBody.toolConfig = { functionCallingConfig: { mode: 'ANY' } };
          } else {
            geminiBody.toolConfig = { functionCallingConfig: { mode: 'VALIDATED' } };
          }
        } else if (tool_choice.type === 'function' && tool_choice.function?.name) {
          geminiBody.toolConfig = {
            functionCallingConfig: {
              mode: 'ANY',
              allowedFunctionNames: [tool_choice.function.name]
            }
          };
        }
      } else if (geminiTools.length > 0) {
        geminiBody.toolConfig = { functionCallingConfig: { mode: 'VALIDATED' } };
      }

      geminiBody.sessionId = String(Math.floor(Date.now() / 1000));

      const generationConfig: any = {};
      if (temperature !== undefined) generationConfig.temperature = temperature;
      if (max_tokens !== undefined) generationConfig.maxOutputTokens = max_tokens;
      if (Object.keys(generationConfig).length > 0) {
        geminiBody.generationConfig = generationConfig;
      }

      let lastError: any = null;

      for (const targetModel of modelCandidates) {
        const actualModel = resolveUpstreamModel(targetModel);
        try {
          if (stream) {
            // Streaming SSE response
            const { result } = await rotator.executeWithFailover(async (creds) => {
              let apiUrl = '';
              const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'User-Agent': 'antigravity/hub/2.24.0 darwin/arm64'
              };

              let requestPayload: any = geminiBody;

              if (creds.type === 'api_key' && creds.apiKey) {
                apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${actualModel}:streamGenerateContent?alt=sse&key=${creds.apiKey}`;
              } else {
                apiUrl = `https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse`;
                headers['Authorization'] = `Bearer ${creds.access_token}`;
                requestPayload = {
                  project: 'aicode-consumers',
                  model: actualModel,
                  userAgent: 'antigravity',
                  request: geminiBody
                };
              }

              try {
                const fs = require('fs');
                fs.writeFileSync('/tmp/hermes_payload.json', JSON.stringify(requestPayload, null, 2));
              } catch (_) {}

              let res = await fetch(apiUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestPayload)
              });


              if (!res.ok) {
                const errText = await res.text();
                const err: any = new Error(errText);
                err.status = res.status;
                throw err;
              }

              return { geminiRes: res, account: creds.profile };
            });

            const { geminiRes, account } = result;
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Account-Used', account);
            res.setHeader('X-Model-Used', targetModel);

            const reader = geminiRes.body?.getReader();
            const decoder = new TextDecoder();
            const completionId = `chatcmpl-${Date.now()}`;
            let hadToolCalls = false;
            let firstChunkSent = false;
            let sseBuffer = '';
            let toolCallIndex = 0;
            let finalFinishReason = 'stop';
            let streamPromptTokens = 0;
            let streamCompletionTokens = 0;

            const sendFirstChunkIfNeeded = () => {
              if (!firstChunkSent) {
                firstChunkSent = true;
                res.write(`data: ${JSON.stringify({
                  id: completionId,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: targetModel,
                  choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }]
                })}\n\n`);
              }
            };

            const processDataJson = (data: any) => {
              const usageMeta = data.usageMetadata || data.response?.usageMetadata;
              if (usageMeta) {
                if (usageMeta.promptTokenCount !== undefined) streamPromptTokens = usageMeta.promptTokenCount;
                if (usageMeta.candidatesTokenCount !== undefined) streamCompletionTokens = usageMeta.candidatesTokenCount;
              }

              const candidate = data.candidates?.[0] || data.response?.candidates?.[0];
              if (!candidate) return;

              if (candidate.finishReason) {
                finalFinishReason = candidate.finishReason.toLowerCase();
              }

              const parts = candidate.content?.parts || [];
              for (const part of parts) {
                // Thinking / Reasoning parts
                if (part.thought === true || (part.text && (part.thoughtSignature || part.thought_signature))) {
                  sendFirstChunkIfNeeded();
                  if (part.text) {
                    res.write(`data: ${JSON.stringify({
                      id: completionId,
                      object: 'chat.completion.chunk',
                      created: Math.floor(Date.now() / 1000),
                      model: targetModel,
                      choices: [{ index: 0, delta: { reasoning_content: part.text }, finish_reason: null }]
                    })}\n\n`);
                  }
                  continue;
                }

                // Regular assistant text
                if (part.text !== undefined && part.text !== '') {
                  sendFirstChunkIfNeeded();
                  res.write(`data: ${JSON.stringify({
                    id: completionId,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: targetModel,
                    choices: [{ index: 0, delta: { content: part.text }, finish_reason: null }]
                  })}\n\n`);
                }

                // Function / Tool calls
                if (part.functionCall) {
                  hadToolCalls = true;
                  sendFirstChunkIfNeeded();
                  const callId = part.functionCall.id || `call_${Date.now().toString(36)}_${toolCallIndex}`;
                  const toolChunk = {
                    id: completionId,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: targetModel,
                    choices: [
                      {
                        index: 0,
                        delta: {
                          tool_calls: [
                            {
                              index: toolCallIndex++,
                              id: callId,
                              type: 'function',
                              function: {
                                name: part.functionCall.name,
                                arguments: JSON.stringify(part.functionCall.args || {})
                              }
                            }
                          ]
                        },
                        finish_reason: null
                      }
                    ]
                  };
                  res.write(`data: ${JSON.stringify(toolChunk)}\n\n`);
                }
              }
            };

            if (reader) {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                sseBuffer += decoder.decode(value, { stream: true });
                const lines = sseBuffer.split('\n');
                // Retain unfinished line in buffer
                sseBuffer = lines.pop() || '';

                for (const line of lines) {
                  const trimmed = line.trim();
                  if (trimmed.startsWith('data: ')) {
                    const jsonStr = trimmed.slice(6).trim();
                    if (!jsonStr || jsonStr === '[DONE]') continue;
                    try {
                      const data = JSON.parse(jsonStr);
                      processDataJson(data);
                    } catch (_) {
                      // ignore parse errors of individual chunks
                    }
                  }
                }
              }

              // Flush remaining buffer if any
              if (sseBuffer.trim().startsWith('data: ')) {
                const jsonStr = sseBuffer.trim().slice(6).trim();
                if (jsonStr && jsonStr !== '[DONE]') {
                  try {
                    const data = JSON.parse(jsonStr);
                    processDataJson(data);
                  } catch (_) {}
                }
              }
            }

            sendFirstChunkIfNeeded();

            // Final chunk
            const finishReason = hadToolCalls ? 'tool_calls' : (finalFinishReason === 'stop' ? 'stop' : finalFinishReason);
            res.write(`data: ${JSON.stringify({
              id: completionId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: targetModel,
              choices: [{ index: 0, delta: {}, finish_reason: finishReason }]
            })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();

            // Record token usage
            usageTracker.record({
              profile: account,
              email: account,
              model: targetModel,
              virtualKey: (req.headers['authorization'] || '').replace('Bearer ', '').slice(0, 16),
              promptTokens: streamPromptTokens,
              completionTokens: streamCompletionTokens,
              totalTokens: streamPromptTokens + streamCompletionTokens,
              latencyMs: Date.now() - requestStartTime,
              statusCode: 200,
              stream: true
            });
            return;
          }

          // Non-streaming response with failover
          const { result: data, accountUsed } = await rotator.executeWithFailover(async (creds) => {
            let apiUrl = '';
            const headers: Record<string, string> = {
              'Content-Type': 'application/json',
              'User-Agent': 'antigravity/hub/2.24.0 darwin/arm64'
            };

            let requestPayload: any = geminiBody;

            if (creds.type === 'api_key' && creds.apiKey) {
              apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${actualModel}:generateContent?key=${creds.apiKey}`;
            } else {
              apiUrl = `https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent`;
              headers['Authorization'] = `Bearer ${creds.access_token}`;
              requestPayload = {
                project: 'aicode-consumers',
                model: actualModel,
                userAgent: 'antigravity',
                request: geminiBody
              };
            }

            let res = await fetch(apiUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify(requestPayload)
            });


            if (!res.ok) {
              const errText = await res.text();
              const err: any = new Error(errText);
              err.status = res.status;
              throw err;
            }

            return await res.json();
          });

          const candidate = (data.candidates || data.response?.candidates || [])[0] || {};
          const parts = candidate.content?.parts || [];

          let contentText = '';
          let reasoningText = '';
          const toolCalls: any[] = [];

          for (const part of parts) {
            if (part.thought === true || (part.text && (part.thoughtSignature || part.thought_signature))) {
              if (part.text) {
                reasoningText += part.text;
              }
              continue;
            }
            if (part.text) {
              contentText += part.text;
            }
            if (part.functionCall) {
              toolCalls.push({
                id: part.functionCall.id || `call_${Math.random().toString(36).substring(2, 11)}`,
                type: 'function',
                function: {
                  name: part.functionCall.name,
                  arguments: JSON.stringify(part.functionCall.args || {})
                }
              });
            }
          }

          const promptTokens = data.usageMetadata?.promptTokenCount || 0;
          const completionTokens = data.usageMetadata?.candidatesTokenCount || 0;

          res.setHeader('X-Account-Used', accountUsed);
          res.setHeader('X-Model-Used', targetModel);

          const choiceMessage: any = {
            role: 'assistant',
            content: contentText || null
          };

          if (reasoningText) {
            choiceMessage.reasoning_content = reasoningText;
          }

          if (toolCalls.length > 0) {
            choiceMessage.tool_calls = toolCalls;
          }

          res.json({
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: targetModel,
            choices: [
              {
                index: 0,
                message: choiceMessage,
                finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop'
              }
            ],
            usage: {
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
              total_tokens: promptTokens + completionTokens
            }
          });

          // Record token usage
          usageTracker.record({
            profile: accountUsed,
            email: accountUsed,
            model: targetModel,
            virtualKey: (req.headers['authorization'] || '').replace('Bearer ', '').slice(0, 16),
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
            latencyMs: Date.now() - requestStartTime,
            statusCode: 200,
            stream: false
          });
          return;
        } catch (err: any) {
          lastError = err;
          rotator.clearCooldowns();
          console.warn(`[Failover] Model [${targetModel}] gặp lỗi: ${err.message}. Tiếp tục thử...`);
        }
      }

      throw lastError || new Error('All model candidates failed.');
    } catch (err: any) {
      res.status(err.status || 500).json({
        error: {
          message: err.message || 'Internal Server Error',
          code: err.status || 500
        }
      });
    }
  });

  return router;
}
