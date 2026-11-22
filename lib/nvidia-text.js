// Shared, server-only transport for short structured writing and search tasks.
module.exports = async function askModel(key, system, user, { maxTokens = 180, timeout = 6000, responseFormat } = {}) {
  const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeout),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'nvidia/nemotron-3.5-bolt-e4b', temperature: 0, max_tokens: maxTokens, stream: false,
      ...(responseFormat ? { response_format: responseFormat, chat_template_kwargs: { enable_thinking: false } } : {}),
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  if (!response.ok) throw new Error('Model unavailable');
  const data = await response.json();
  const choice = data.choices?.[0];
  if (choice?.finish_reason === 'length' || typeof choice?.message?.content !== 'string' || !choice.message.content.trim()) {
    throw new Error('Incomplete model response');
  }
  return choice.message.content;
};
