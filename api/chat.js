export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7500);

  try {
    const { prompt, messages, previousInteractionId } = req.body || {};
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      clearTimeout(timeoutId);
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
              .slice(-4)
              .map((m) => `${m.role === 'assistant' ? 'Ассистент' : 'Пользователь'}: ${m.content}`)
              .join('\n'),
      system_instruction: 'Отвечай максимально кратко, по делу и на русском языке.'
    };

    if (previousInteractionId) {
      payload.previous_interaction_id = previousInteractionId;
    }

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

    const rawText = await response.text();
    let data = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      return res.status(502).json({ error: 'Некорректный ответ от Gemini API' });
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || `Ошибка Gemini API (${response.status})`
      });
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

    return res.status(200).json({
      reply,
      interactionId: data.id || null
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err?.name === 'AbortError') {
      return res.status(504).json({
        error: 'Google не успел ответить за 7.5 сек. Попробуй отправить сообщение еще раз.'
      });
    }
    return res.status(500).json({ error: err?.message || 'Внутренняя ошибка сервера' });
  }
}
