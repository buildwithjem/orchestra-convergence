/* Orchestra Competition — file: js/api.js
   Qwen Cloud API integration via DashScope (OpenAI-compatible endpoint).
   Exposes window.QwenAPI. The API key is read from window.__QWEN_API_KEY__
   (set by the API Key modal in app.js / stored in localStorage). */
window.App = window.App || {};

window.QwenAPI = {
  // DashScope OpenAI-compatible endpoint
  BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',

  // Models available on Qwen Cloud
  MODELS: {
    'qwen3.7-plus':  'qwen3.7-plus', // latest, best balance
    'qwen3.7-max':   'qwen3.7-max',   // strongest reasoning
    'qwen-plus':     'qwen-plus',     // stable
    'qwen-max':      'qwen-max',      // stable reasoning
    'qwen-turbo':    'qwen-turbo',    // fastest, cheapest
  },

  /** Quick synchronous check whether an API key has been configured. */
  hasKey(){
    return !!(window.__QWEN_API_KEY__ && window.__QWEN_API_KEY__.trim());
  },

  /**
   * Send a chat completion request to the Qwen API.
   * @param {string} model - model name (qwen-plus | qwen-max | qwen-turbo)
   * @param {Array} messages - [{role:'system'|'user'|'assistant', content:'...'}]
   * @param {object} options - {temperature, max_tokens, stream, onChunk}
   * @returns {Promise<string>} full response text
   */
  async chat(model, messages, options = {}){
    const { temperature = 0.7, max_tokens = 2048, stream = false, onChunk = null } = options;

    if(!this.hasKey()){
      throw new Error('Qwen API key not set. Click 🔑 API Key to configure it.');
    }

    // Defensive logging — helps diagnose 401 / key-passing issues
    console.log('[QwenAPI] chat() called:', {
      model,
      resolvedModel: this.MODELS[model] || model,
      keyLength: window.__QWEN_API_KEY__.length,
      keyPrefix: window.__QWEN_API_KEY__.slice(0, 6) + '...',
      messageCount: messages.length,
      stream
    });

    const body = {
      model: this.MODELS[model] || model,
      messages,
      temperature,
      max_tokens,
      stream,
    };

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${window.__QWEN_API_KEY__}`,
    };

    if(stream && onChunk){
      // Streaming SSE implementation
      const response = await fetch(this.BASE_URL + '/chat/completions', {
        method: 'POST', headers, body: JSON.stringify(body),
      });
      if(!response.ok){
        const errText = await response.text().catch(()=>'');
        throw new Error(`Qwen API error ${response.status}: ${errText.slice(0,300)}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';

      while(true){
        const { done, value } = await reader.read();
        if(done) break;
        buffer += decoder.decode(value, { stream:true });
        const lines = buffer.split('\n');
        // keep last (possibly partial) line in buffer
        buffer = lines.pop() || '';
        for(const line of lines){
          const trimmed = line.trim();
          if(!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(6).trim();
          if(data === '[DONE]') { buffer=''; return fullText; }
          try{
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if(delta){
              fullText += delta;
              onChunk(delta, fullText);
            }
          }catch(e){ /* ignore partial JSON */ }
        }
      }
      // flush any remaining buffered line
      if(buffer.trim().startsWith('data:')){
        const data = buffer.trim().slice(6).trim();
        if(data && data !== '[DONE]'){
          try{
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if(delta){ fullText += delta; onChunk(delta, fullText); }
          }catch(e){}
        }
      }
      return fullText;
    } else {
      // Non-streaming
      const response = await fetch(this.BASE_URL + '/chat/completions', {
        method: 'POST', headers, body: JSON.stringify(body),
      });
      if(!response.ok){
        const errText = await response.text().catch(()=>'');
        throw new Error(`Qwen API error ${response.status}: ${errText.slice(0,300)}`);
      }
      const data = await response.json();
      return data.choices?.[0]?.message?.content || '';
    }
  }
};

// Expose on shared namespace
window.App.QwenAPI = window.QwenAPI;
