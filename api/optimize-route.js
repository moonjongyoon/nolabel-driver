// Vercel Node Serverless Function (CommonJS)
// POST /api/optimize-route
//   body: { start: {lat,lng}, deliveries: [{id, address, lat, lng}, ...] }
//   res : { order: [...], total_km: number, eta_min: number, source: 'claude'|'nearest_neighbor' }
//
// 정책: 항상 거리 기반으로 보정한다.
//   - Claude 가 정상 order 를 주면 Claude order vs nearest-neighbor 의 총거리를 비교해 더 짧은 쪽 채택
//   - Claude 실패/파싱실패 → nearest-neighbor 로 폴백 (입력순서 폴백 금지)

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

  // 좌표 있는 항목만으로 계산. 좌표 없는 항목은 맨 뒤로 보존
  const withCoord  = deliveries.filter(d => typeof d.lat === 'number' && typeof d.lng === 'number');
  const noCoordIds = deliveries.filter(d => !(typeof d.lat === 'number' && typeof d.lng === 'number')).map(d => d.id);

  // 항상 nearest-neighbor 한 번은 미리 계산 (베이스라인 + 폴백)
  const nnOrder = nearestNeighborOrder(start, withCoord);
  const nnKm    = totalKm(start, withCoord, nnOrder);
  console.log('[optimize-route] nearest-neighbor:', nnKm.toFixed(2), 'km / order:', nnOrder.join(','));

  let claudeOrder = null;
  let claudeKm   = null;
  let claudeError = null;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    claudeError = 'ANTHROPIC_API_KEY not configured';
    console.warn('[optimize-route]', claudeError);
  } else {
    try {
      const userText = [
        `시작점(기사 현재 위치): lat=${start.lat}, lng=${start.lng}`,
        `배송지 ${withCoord.length}건:`,
        ...withCoord.map(d => `- id=${d.id}, lat=${d.lat}, lng=${d.lng}, 주소=${d.address || ''}`),
        '',
        '시작점에서 출발해 모든 배송지를 한 번씩 방문하는 가장 짧은 순서의 id 배열을 JSON 으로만 반환하라.'
      ].join('\n');

      const systemPrompt =
        '너는 배송 경로 최적화기다. 시작점(기사 현재 위치)에서 출발해 모든 배송지를 한 번씩 방문하는 최단 순서를 구한다. ' +
        '반드시 JSON 만 출력하고 설명/마크다운/코드펜스를 절대 포함하지 마라. ' +
        '형식: {"order":["id1","id2",...],"total_km":12.3,"eta_min":95}';

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
        claudeError = 'Anthropic HTTP ' + apiRes.status;
        const errText = await apiRes.text();
        console.error('[optimize-route] Anthropic API error', apiRes.status, errText);
      } else {
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
          const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
          parsed = JSON.parse(cleaned);
        } catch (e) {
          claudeError = 'parse_failed';
          console.warn('[optimize-route] Claude 출력 파싱 실패:', text);
        }

        if (parsed && Array.isArray(parsed.order) && parsed.order.length > 0) {
          // Claude 가 준 id 중 유효한 것만, 누락된 좌표 있는 id 는 뒤로
          const validIds = new Set(withCoord.map(d => d.id));
          const ordered  = parsed.order.filter(id => validIds.has(id));
          const missing  = withCoord.map(d => d.id).filter(id => !ordered.includes(id));
          claudeOrder = ordered.concat(missing);
          claudeKm    = totalKm(start, withCoord, claudeOrder);
          console.log('[optimize-route] Claude:', claudeKm.toFixed(2), 'km / order:', claudeOrder.join(','));
        } else if (!claudeError) {
          claudeError = 'empty_order';
        }
      }
    } catch (e) {
      claudeError = (e && e.message) || String(e);
      console.error('[optimize-route] Claude 호출 예외:', e);
    }
  }

  // 두 결과 비교 — 더 짧은 쪽 채택. Claude 가 없거나 nn 보다 길면 nn 채택.
  let finalOrder, finalKm, source;
  if (claudeOrder && claudeKm !== null && claudeKm < nnKm) {
    finalOrder = claudeOrder;
    finalKm    = claudeKm;
    source     = 'claude';
    console.log('[optimize-route] ✓ Claude 채택 (', claudeKm.toFixed(2), 'km <', nnKm.toFixed(2), 'km)');
  } else {
    finalOrder = nnOrder;
    finalKm    = nnKm;
    source     = 'nearest_neighbor';
    const reason = !claudeOrder
      ? `Claude 결과 없음(${claudeError || 'unknown'})`
      : `nearest-neighbor 가 더 짧음(${nnKm.toFixed(2)} <= ${claudeKm.toFixed(2)})`;
    console.log('[optimize-route] ✓ nearest-neighbor 채택 —', reason);
  }

  // 좌표 없는 항목 id 는 맨 뒤에 (구버전 호환)
  if (noCoordIds.length > 0) finalOrder = finalOrder.concat(noCoordIds);

  res.status(200).json({
    order: finalOrder,
    total_km: round1(finalKm),
    eta_min: Math.round(finalKm * 2),   // ≈ 30km/h
    source,
    claude_km: claudeKm !== null ? round1(claudeKm) : null,
    nn_km: round1(nnKm),
    claude_error: claudeError
  });
};

// ===========================================================
// helpers
// ===========================================================
function haversineKm(a, b) {
  const R = 6371;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) *
            Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function totalKm(start, deliveries, orderIds) {
  const map = {};
  for (const d of deliveries) map[d.id] = d;
  let total = 0;
  let prev = start;
  for (const id of orderIds) {
    const d = map[id];
    if (!d) continue;
    total += haversineKm(prev, d);
    prev = d;
  }
  return total;
}

function nearestNeighborOrder(start, deliveries) {
  const remaining = deliveries.slice();
  const order = [];
  let cur = start;
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(cur, remaining[i]);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    order.push(next.id);
    cur = next;
  }
  return order;
}

function round1(x) {
  return Math.round(x * 10) / 10;
}
// NOLABEL · AI 최적경로 서버리스 함수 — Claude + 최단거리 보정
