export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7500);

  try {
    const { prompt, messages, previousInteractionId } = req.body || {};
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      clearTimeout(timeoutId);
      console.error('[chat] Missing GEMINI_API_KEY');
      return res.status(500).json({ error: 'Не задан GEMINI_API_KEY в Vercel' });
    }

    const lastUserMessage =
      typeof prompt === 'string' && prompt.trim()
        ? prompt.trim()
        : Array.isArray(messages)
          ? [...messages].reverse().find((m) => m.role === 'user')?.content?.trim()
          : '';

    if (!lastUserMessage) {
      clearTimeout(timeoutId);
      return res.status(400).json({ error: 'Пустое сообщение' });
    }

    const payload = {
      model: 'gemini-3.8-flash',
      input:
        previousInteractionId || !Array.isArray(messages) || messages.length <= 1
          ? lastUserMessage
          : messages
              .slice(-3)
              .map((m) => `${m.role === 'assistant' ? 'Ассистент' : 'Пользователь'}: ${m.content}`)
              .join('\n'),
      system_instruction: 'Отвечай максимально кратко и по делу.'
    };

    if (previousInteractionId) {
      payload.previous_interaction_id = previousInteractionId;
    }

    console.log('[chat] Sending request to Gemini Interactions API...');

    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const elapsedMs = Date.now() - startedAt;

    const rawText = await response.text();
    let data = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      console.error(`[chat] Non-JSON response in ${elapsedMs}ms:`, rawText.slice(0, 200));
      return res.status(502).json({ error: 'Некорректный ответ от Gemini API' });
    }

    if (!response.ok) {
      const apiErr = data.error?.message || `Ошибка Gemini API (${response.status})`;
      console.error(`[chat] Gemini error ${response.status} in ${elapsedMs}ms:`, apiErr);
      return res.status(response.status).json({ error: apiErr });
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
    console.log(`[chat] Success in ${elapsedMs}ms, interactionId=${data.id || 'none'}`);

    return res.status(200).json({
      reply,
      interactionId: data.id || null
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const elapsedMs = Date.now() - startedAt;

    if (err?.name === 'AbortError') {
      console.error(`[chat] Aborted after ${elapsedMs}ms`);
      return res.status(504).json({
        error: `Google не ответил за ${elapsedMs} мс. Попробуй еще раз.`
      });
    }

    console.error(`[chat] Unexpected error after ${elapsedMs}ms:`, err?.message || err);
    return res.status(500).json({ error: err?.message || 'Внутренняя ошибка сервера' });
  }
}
