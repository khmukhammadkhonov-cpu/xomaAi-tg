async function callInteraction({ apiKey, model, input, systemInstruction, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();

  try {
    const payload = {
      model,
      input,
      system_instruction: systemInstruction
    };

    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timer);
    const elapsed = Date.now() - t0;
    const rawText = await response.text();

    let data = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      return { ok: false, status: 502, error: `Некорректный ответ (${model})`, elapsed };
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: data.error?.message || `Ошибка ${model} (${response.status})`,
        elapsed
      };
    }

    const textFromOutputs = Array.isArray(data.outputs)
      ? data.outputs
          .map((item) => item?.text || item?.content || '')
          .filter(Boolean)
          .join('\n')
      : '';

    const textFromSteps = Array.isArray(data.steps)
      ? data.steps
          .filter((s) => s?.type === 'model_output')
          .map((s) => s?.content || s?.text || '')
          .filter(Boolean)
          .join('\n')
      : '';

    const reply = data.output_text || textFromOutputs || textFromSteps || 'Пустой ответ от модели';

    return {
      ok: true,
      reply,
      interactionId: data.id || null,
      model,
      elapsed
    };
  } catch (err) {
    clearTimeout(timer);
    const elapsed = Date.now() - t0;
    if (err?.name === 'AbortError') {
      return { ok: false, status: 504, error: `Таймаут ${model} (${elapsed}ms)`, elapsed };
    }
    return { ok: false, status: 500, error: err?.message || `Ошибка ${model}`, elapsed };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { prompt, messages } = req.body || {};
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'Не задан GEMINI_API_KEY в Vercel' });
    }

    const lastUserMessage =
      typeof prompt === 'string' && prompt.trim()
        ? prompt.trim()
        : Array.isArray(messages)
          ? [...messages].reverse().find((m) => m.role === 'user')?.content?.trim()
          : '';

    if (!lastUserMessage) {
      return res.status(400).json({ error: 'Пустое сообщение' });
    }

    const compactInput =
      !Array.isArray(messages) || messages.length <= 1
        ? lastUserMessage
        : messages
            .slice(-2)
            .map((m) => `${m.role === 'assistant' ? 'Ассистент' : 'Пользователь'}: ${m.content}`)
            .join('\n');

    const systemInstruction = 'Отвечай максимально кратко и по делу.';
    const candidates = [
      { model: 'gemini-3.8-flash', timeoutMs: 4000 },
      { model: 'gemini-3.5-flash', timeoutMs: 4000 }
    ];

    let lastFailure = { status: 504, error: 'Сервер Google отвечает слишком долго.' };

    for (const item of candidates) {
      console.log(`[chat] Trying ${item.model} (timeout ${item.timeoutMs}ms)...`);
      const result = await callInteraction({
        apiKey,
        model: item.model,
        input: compactInput,
        systemInstruction,
        timeoutMs: item.timeoutMs
      });

      if (result.ok) {
        console.log(`[chat] Success with ${result.model} in ${result.elapsed}ms`);
        return res.status(200).json({
          reply: result.reply,
          interactionId: result.interactionId
        });
      }

      lastFailure = result;
      console.warn(`[chat] ${item.model} failed in ${result.elapsed}ms: ${result.error}`);

      if (result.status === 400 || result.status === 401 || result.status === 403) {
        break;
      }
    }

    return res.status(lastFailure.status || 504).json({
      error: lastFailure.error || 'Сервер Google не успел ответить. Попробуй еще раз.'
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Внутренняя ошибка сервера' });
  }
}
