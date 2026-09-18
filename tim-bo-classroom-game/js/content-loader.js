/**
 * Content Loader for "Tìm Bò - Let's Save the Cows!"
 * Conforms to external-content.md specification (Schema v1, Content Hash Versioning, Sanitization)
 */
(function (global) {
  'use strict';
  // Fetch headers AND body under one deadline, with a byte cap on the stream.
  async function readSource(rawUrl, externalSignal, timeoutMs = 10000) {
    const url = new URL(rawUrl, global.location.href);
    const hosts = ['static-mass.edupia.vn','edupia.vn','docs.google.com','drive.google.com','script.google.com','raw.githubusercontent.com'];
    if(url.username || url.password || (url.origin !== global.location.origin && (url.protocol !== 'https:' || !hosts.includes(url.hostname)))) throw Error('Nguồn câu hỏi không nằm trong danh sách HTTPS cho phép.');
    const ctl=new AbortController(), abort=()=>ctl.abort(externalSignal?.reason);
    if(externalSignal?.aborted)abort();
    externalSignal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>ctl.abort(),timeoutMs);let reader;
    try{
      const response=await fetch(url.href,{signal:ctl.signal,cache:'no-store',redirect:'error',credentials:url.origin===global.location.origin?'same-origin':'omit'});
      if(!response.ok)throw Error('Không tải được nguồn câu hỏi (HTTP '+response.status+').');
      if(Number(response.headers.get('content-length'))>1048576)throw Error('Nguồn câu hỏi vượt quá 1 MiB.');
      if(!response.body?.getReader)throw Error('Trình duyệt không hỗ trợ tải có giới hạn.');
      reader=response.body.getReader();let bytes=0,text='';const decoder=new TextDecoder();
      for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>1048576){await reader.cancel();throw Error('Nguồn câu hỏi vượt quá 1 MiB.')}text+=decoder.decode(value,{stream:true})}
      return text+decoder.decode();
    }finally{clearTimeout(timer);externalSignal?.removeEventListener('abort',abort);if(reader){try{await reader.cancel()}catch{}reader.releaseLock()}}
  }


  function simpleHash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return 'v-' + Math.abs(hash).toString(16).padStart(8, '0');
  }

  function validateBank(data) {
    if(data && Array.isArray(data.questions)){
      if(data.questions.length>100)throw Error('Tối đa 100 câu hỏi.');
      for(const q of data.questions){
        if(!q || typeof q.id!=='string' || !/^[A-Za-z0-9_-]{1,36}$/.test(q.id) || ['__proto__','constructor','prototype'].includes(q.id))throw Error('ID câu hỏi không hợp lệ.');
        if(typeof q.prompt!=='string'||q.prompt.length>600||!Array.isArray(q.options)||q.options.length>4)throw Error('Câu hỏi vượt giới hạn.');
        for(const o of q.options)if(!o || typeof o.id!=='string'||!/^[A-Za-z0-9_-]{1,10}$/.test(o.id)||typeof o.text!=='string'||o.text.length>240)throw Error('Lựa chọn không hợp lệ.');
      }
    }
    if (!data || typeof data !== 'object') {
      throw new Error('Dữ liệu ngân hàng câu hỏi không hợp lệ (không phải object).');
    }
    if (data.schemaVersion !== 1) {
      throw new Error(`Phiên bản schema ${data.schemaVersion} không được hỗ trợ (cần phiên bản 1).`);
    }
    if (!Array.isArray(data.questions) || data.questions.length === 0) {
      throw new Error('Danh sách câu hỏi trống hoặc không phải mảng.');
    }

    const qIds = new Set();
    const validatedQuestions = [];

    data.questions.forEach((q, idx) => {
      const qNum = idx + 1;
      if (!q || typeof q !== 'object') {
        throw new Error(`Câu hỏi #${qNum} không hợp lệ.`);
      }
      if (!q.id || typeof q.id !== 'string') {
        throw new Error(`Câu hỏi #${qNum} thiếu trường 'id'.`);
      }
      if (qIds.has(q.id)) {
        throw new Error(`Trùng lặp ID câu hỏi '${q.id}' tại câu #${qNum}.`);
      }
      qIds.add(q.id);

      if (!q.prompt || typeof q.prompt !== 'string' || !q.prompt.trim()) {
        throw new Error(`Câu hỏi #${qNum} (${q.id}) có nội dung câu hỏi rỗng.`);
      }

      if (q.type && q.type !== 'single-choice') {
        throw new Error(`Câu hỏi #${qNum} (${q.id}) có dạng '${q.type}' chưa hỗ trợ.`);
      }

      if (!Array.isArray(q.options) || q.options.length < 2) {
        throw new Error(`Câu hỏi #${qNum} (${q.id}) phải có ít nhất 2 lựa chọn.`);
      }

      const optIds = new Set();
      const validatedOptions = [];
      q.options.forEach((opt, optIdx) => {
        if (!opt || typeof opt !== 'object' || !opt.id || typeof opt.text !== 'string') {
          throw new Error(`Lựa chọn #${optIdx + 1} của câu #${qNum} không hợp lệ.`);
        }
        if (optIds.has(opt.id)) {
          throw new Error(`Trùng lặp id lựa chọn '${opt.id}' tại câu #${qNum}.`);
        }
        optIds.add(opt.id);
        validatedOptions.push({
          id: String(opt.id).trim(),
          text: String(opt.text).trim()
        });
      });

      if (!q.correctOptionId || !optIds.has(q.correctOptionId)) {
        throw new Error(`Câu hỏi #${qNum} (${q.id}) có correctOptionId '${q.correctOptionId}' không khớp với bất kỳ lựa chọn nào.`);
      }

      const points = Number.isFinite(q.points) && q.points >= 0 ? q.points : 10;

      validatedQuestions.push({
        id: String(q.id).trim().slice(0, 36),
        type: 'single-choice',
        prompt: String(q.prompt).trim().slice(0, 500),
        options: validatedOptions,
        correctOptionId: String(q.correctOptionId).trim().slice(0, 10),
        points: points
      });
    });

    // Giới hạn tối đa 100 câu hỏi (theo chuẩn phòng chống DoS bộ nhớ)
    const finalQuestions = validatedQuestions.slice(0, 100);

    // Content version hash based on canonical string representation
    const canonicalStr = JSON.stringify(finalQuestions);
    const contentVersion = simpleHash(canonicalStr);

    return {
      schemaVersion: 1,
      bankId: String(data.bankId || 'bank-' + contentVersion).slice(0, 64),
      title: String(data.title || 'Tìm Bò - Let\'s Save the Cows').slice(0, 120),
      description: String(data.description || '').slice(0, 300),
      contentVersion: contentVersion,
      fetchedAt: new Date().toISOString(),
      questions: finalQuestions
    };
  }

  /**
   * Tạo bản copy câu hỏi cho học sinh (LOẠI BỎ correctOptionId)
   */
  function createLearnerPayload(questions) {
    return questions.map(q => ({
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      options: q.options.map(opt => ({ id: opt.id, text: opt.text })),
      points: q.points
    }));
  }

  /**
   * Tải ngân hàng câu hỏi an toàn (Kiểm tra HTTPS, Whitelist host, Timeout 10s, Max 1MB)
   * @param {Object} sourceConfig { type: 'local'|'url'|'json', url?: string, rawJson?: string }
   * @param {Object} options { signal?: AbortSignal }
   */
  async function loadQuestionBank(sourceConfig = { type: 'local' }, options = {}) {
    let rawData;
    if(sourceConfig?.type==='json' && sourceConfig.rawJson){
      if(new TextEncoder().encode(sourceConfig.rawJson).byteLength>1048576)throw Error('Nguồn câu hỏi vượt quá 1 MiB.');
      rawData=JSON.parse(sourceConfig.rawJson);
    }else{
      const text=await readSource(sourceConfig?.type==='url'?sourceConfig.url:'./content.json',options.signal);
      rawData=JSON.parse(text);
    }
    return validateBank(rawData);
  }

  // Quản lý cấu hình nguồn câu hỏi lưu ở LocalStorage
  const SOURCE_KEY = 'TIM_BO_CONTENT_SOURCE';
  function getSavedSourceConfig() {
    try {
      const s = localStorage.getItem(SOURCE_KEY);
      return s ? JSON.parse(s) : { type: 'local' };
    } catch {
      return { type: 'local' };
    }
  }

  function saveSourceConfig(cfg) {
    localStorage.setItem(SOURCE_KEY, JSON.stringify(cfg));
  }

  global.ContentLoader = Object.freeze({
    loadQuestionBank,
    createLearnerPayload,
    validateBank,
    getSavedSourceConfig,
    saveSourceConfig
  });
})(typeof window !== 'undefined' ? window : this);
