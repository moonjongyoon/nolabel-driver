// Vercel Node Serverless Function (CommonJS)
// POST /api/optimize-route
//   body: { start: {lat,lng}, deliveries: [{id, address, lat, lng}, ...] }
//   res : { order: ["id1","id2",...], total_km: number, eta_min: number }

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let body = req.body;
  try {
    if (typeof body === 'string') body = JSON.parse(body);
  } catch (e) {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  const start = body && body.start;
  const deliveries = Array.isArray(body && body.deliveries) ? body.deliveries : [];

  if (!start || typeof start.lat !== 'number' || typeof start.lng !== 'number') {
    res.status(400).json({ error: 'start (lat,lng) required' });
    return;
  }
  if (deliveries.length === 0) {
    res.status(400).json({ error: 'deliveries required' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' });
    return;
  }

  const userText = [
    `시작점(기사 현재 위치): lat=${start.lat}, lng=${start.lng}`,
    `배송지 ${deliveries.length}건:`,
    ...deliveries.map(d =>
      `- id=${d.id}, lat=${d.lat}, lng=${d.lng}, 주소=${d.address || ''}`
    ),
    '',
    '시작점에서 출발해 모든 배송지를 한 번씩 방문하는 가장 짧은 순서의 id 배열을 JSON으로만 반환하라.'
  ].join('\n');

  const systemPrompt =
    '너는 배송 경로 최적화기다. 시작점(기사 현재 위치)에서 출발해 모든 배송지를 한 번씩 방문하는 최단 순서를 구한다. ' +
    '반드시 JSON만 출력하고 설명/마크다운/코드펜스를 절대 포함하지 마라. ' +
    '형식: {"order":["id1","id2",...],"total_km":12.3,"eta_min":95}';

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userText }]
      })
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error('Anthropic API error', apiRes.status, errText);
      // 폴백: 입력 순서 그대로 반환
      res.status(200).json(fallbackOrder(start, deliveries, 'api_error'));
      return;
    }

    const data = await apiRes.json();
    let text = '';
    if (Array.isArray(data.content)) {
      text = data.content
        .filter(c => c && c.type === 'text' && typeof c.text === 'string')
        .map(c => c.text)
        .join('');
    }

    let parsed = null;
    try {
      const cleaned = text
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.warn('Failed to parse Claude output:', text);
    }

    if (!parsed || !Array.isArray(parsed.order) || parsed.order.length === 0) {
      res.status(200).json(fallbackOrder(start, deliveries, 'parse_fallback'));
      return;
    }

    // 유효 id만 남기고, 누락된 id는 뒤로 보존
    const validIds = new Set(deliveries.map(d => d.id));
    const orderedIds = parsed.order.filter(id => validIds.has(id));
    const remaining = deliveries.map(d => d.id).filter(id => !orderedIds.includes(id));
    const finalOrder = orderedIds.concat(remaining);

    res.status(200).json({
      order: finalOrder,
      total_km: typeof parsed.total_km === 'number' ? parsed.total_km : null,
      eta_min: typeof parsed.eta_min === 'number' ? parsed.eta_min : null
    });
  } catch (e) {
    console.error('optimize-route exception:', e);
    res.status(500).json({ error: String(e && e.message || e) });
  }
};

function fallbackOrder(start, deliveries, reason) {
  return {
    order: deliveries.map(d => d.id),
    total_km: null,
    eta_min: null,
    fallback: reason || true
  };
}
