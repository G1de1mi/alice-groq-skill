export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { request, session, version } = req.body;
  const command = request.original_utterance;
  
  let sessionState = session.session_state || {};
  let history = sessionState.history || [];

  let searchContext = "";
  const needsSearch = /найди|поищи|погугли|новости|погода|курс|кто такой|что такое/i.test(command);

  if (needsSearch) {
    try {
      const serperRes = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': process.env.SERPER_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ q: command, gl: 'ru', hl: 'ru' })
      });
      const serperData = await serperRes.json();
      
      if (serperData.organic && serperData.organic.length > 0) {
        searchContext = serperData.organic.slice(0, 3).map(item => 
          `Заголовок: ${item.title}\nСсылка: ${item.link}\nОписание: ${item.snippet}`
        ).join('\n\n');
      }
    } catch (e) {
      console.error("Serper error:", e);
    }
  }

  const systemPrompt = `Ты — голосовой ассистент Алиса. Отвечай кратко, дружелюбно и по делу. 
  Твои ответы будут озвучены, поэтому избегай маркдауна, списков и сложных символов.
  ${searchContext ? `Вот актуальная информация из интернета, используй её для ответа:\n${searchContext}` : ''}`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: command }
  ];

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: messages,
        temperature: 0.7,
        max_tokens: 300
      })
    });

    const groqData = await groqRes.json();
    let replyText = "Извините, я не смогла обработать ответ.";
    
    if (groqData.choices && groqData.choices[0].message) {
      replyText = groqData.choices[0].message.content;
      history.push({ role: 'user', content: command });
      history.push({ role: 'assistant', content: replyText });
    }

    if (history.length > 10) {
      history = history.slice(-10);
    }

    replyText = replyText.replace(/[*#_`]/g, '').trim();

    return res.status(200).json({
      response: {
        text: replyText,
        end_session: false
      },
      session_state: {
        history: history
      },
      version: version
    });

  } catch (error) {
    console.error("Groq error:", error);
    return res.status(200).json({
      response: {
        text: "Произошла ошибка при обращении к нейросети.",
        end_session: false
      },
      version: version
    });
  }
}
