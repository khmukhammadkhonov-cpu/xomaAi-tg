export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { prompt, messages, previousInteractionId } = req.body || {};
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

    const payload = {
      model: 'gemini-3.8-flash',
      input:
        previousInteractionId || !Array.isArray(messages) || messages.length <= 1
          ? lastUserMessage
          : messages.map((m) => `${m.role === 'assistant' ? 'Ассистент' : 'Пользователь'}: ${m.content}`).join('\n'),
      system_instruction: 'Ты дружелюбный и полезный AI-ассистент внутри Telegram. Отвечай четко и по делу.',
      generation_config: {
        thinking_level: 'medium'
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
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || 'Ошибка запроса к Gemini Interactions API'
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
    return res.status(500).json({ error: err.message || 'Внутренняя ошибка сервера' });
  }
}
