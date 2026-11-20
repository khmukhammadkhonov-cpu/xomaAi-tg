export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8500);

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

    const modelsToTry = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.0-flash'];
    let lastError = 'Ошибка запроса к Gemini Interactions API';
    let lastStatus = 503;

    for (const modelName of modelsToTry) {
      const payload = {
        model: modelName,
        input:
          previousInteractionId || !Array.isArray(messages) || messages.length <= 1
            ? lastUserMessage
            : messages.map((m) => `${m.role === 'assistant' ? 'Ассистент' : 'Пользователь'}: ${m.content}`).join('\n'),
        system_instruction: 'Ты дружелюбный и полезный AI-ассистент внутри Telegram. Отвечай четко и по делу.',
        generation_config: {
          thinking_level: 'low'
        }
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

      const rawText = await response.text();
      let data = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        lastStatus = 502;
        lastError = 'Некорректный ответ от Gemini API';
        continue;
      }

      if (response.ok) {
        clearTimeout(timeoutId);

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
          interactionId: data.id || null,
          modelUsed: modelName
        });
      }

      lastStatus = response.status;
      lastError = data.error?.message || `Ошибка Gemini API (${response.status})`;

      const isOverloaded =
        response.status === 503 ||
        response.status === 429 ||
        /high demand|overloaded|temporarily|not found/i.test(lastError);

      if (!isOverloaded) {
        break;
      }
    }

    clearTimeout(timeoutId);
    return res.status(lastStatus).json({ error: lastError });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err?.name === 'AbortError') {
      return res.status(504).json({
        error: 'Модель отвечает слишком долго. Попробуй отправить сообщение еще раз.'
      });
    }
    return res.status(500).json({ error: err?.message || 'Внутренняя ошибка сервера' });
  }
}
