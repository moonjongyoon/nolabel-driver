/* NOLABEL — Supabase 공통 연동 모듈
 *   <script src="supabase.js"></script>
 *
 * 노출: window.NL = { client, upsertDelivery, updateStatus, fetchAll, subscribe }
 *       window.NL_READY  // Promise<NL> — SDK 로드/초기화 완료 시 resolve
 *
 * anon key 는 공개되어도 안전한 키 (Row Level Security 로 권한 통제).
 */
(function () {
  const SDK_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  const SUPABASE_URL  = 'https://ifhaqtplomcolxnyjzln.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlmaGFxdHBsb21jb2x4bnlqemxuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0Nzg4NTAsImV4cCI6MjA5ODA1NDg1MH0._LBM7P7uUXhrru-rDbrO8ZN8EXL3o5ZcwfT1r8tg6B8';

  // 외부에서 await NL_READY 로 초기화 완료 대기 가능
  let resolveReady;
  window.NL_READY = new Promise((res) => { resolveReady = res; });

  function init() {
    try {
      if (!window.supabase || typeof window.supabase.createClient !== 'function') {
        console.error('[NL] window.supabase.createClient 없음 — SDK 로드 실패?');
        return;
      }
      const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
        realtime: { params: { eventsPerSecond: 5 } }
      });

      const NL = {
        client,

        // {id,name,address,phone,lat,lng,region,status} → upsert (id 충돌 시 갱신)
        async upsertDelivery(d) {
          try {
            if (!d || !d.id) throw new Error('upsertDelivery: id 필수');
            const row = {
              id:      d.id,
              name:    d.name    ?? null,
              address: d.address ?? null,
              phone:   d.phone   ?? null,
              lat:     typeof d.lat === 'number' ? d.lat : null,
              lng:     typeof d.lng === 'number' ? d.lng : null,
              region:  d.region  ?? null,
              status:  d.status  ?? null,
              updated_at: new Date().toISOString()
            };
            const { error } = await client
              .from('deliveries')
              .upsert(row, { onConflict: 'id' });
            if (error) throw error;
            return true;
          } catch (e) {
            console.warn('[NL] upsertDelivery 실패:', (e && e.message) || e);
            return false;
          }
        },

        // status: 'in_transit' | 'delivered' | 'received'
        async updateStatus(id, status) {
          try {
            if (!id) throw new Error('updateStatus: id 필수');
            const { error } = await client
              .from('deliveries')
              .update({ status, updated_at: new Date().toISOString() })
              .eq('id', id);
            if (error) throw error;
            return true;
          } catch (e) {
            console.warn('[NL] updateStatus 실패:', (e && e.message) || e);
            return false;
          }
        },

        /* 개인정보 실제 폐기 — 행 자체를 DELETE.
           양쪽 앱의 subscribe DELETE 이벤트가 폐기 상태로 반영하고,
           수취인 completeReceipt 의 완료 화면은 클라이언트 상태로 보여줌. */
        async clearInfo(id) {
          try {
            if (!id) throw new Error('clearInfo: id 필수');
            const { error } = await client
              .from('deliveries')
              .delete()
              .eq('id', id);
            if (error) throw error;
            console.log('[NL] ✓ clearInfo (DELETE) 완료:', id);
            return true;
          } catch (e) {
            console.warn('[NL] clearInfo 실패:', (e && e.message) || e);
            return false;
          }
        },

        /* 데모 리셋 — deliveries 전부 삭제 + driver_location 초기화 */
        async resetDemo() {
          let okDeliveries = false;
          let okDriverLoc = false;
          try {
            // 모든 행 삭제 — Supabase 는 .delete() 에 filter 필수
            const { error } = await client
              .from('deliveries')
              .delete()
              .not('id', 'is', null);
            if (error) throw error;
            okDeliveries = true;
          } catch (e) {
            console.warn('[NL] resetDemo: deliveries 삭제 실패:', (e && e.message) || e);
          }
          try {
            const { error } = await client
              .from('driver_location')
              .delete()
              .eq('id', 'driver');
            if (error) throw error;
            okDriverLoc = true;
          } catch (e) {
            console.warn('[NL] resetDemo: driver_location 삭제 실패:', (e && e.message) || e);
          }
          console.log('[NL] ✓ resetDemo — deliveries:', okDeliveries, 'driver_location:', okDriverLoc);
          return okDeliveries; // deliveries 만 핵심
        },

        // 전체 조회 — updated_at 최신순
        async fetchAll() {
          try {
            const { data, error } = await client
              .from('deliveries')
              .select('*')
              .order('updated_at', { ascending: false });
            if (error) throw error;
            return data || [];
          } catch (e) {
            console.warn('[NL] fetchAll 실패:', (e && e.message) || e);
            return [];
          }
        },

        // 실시간 구독 — INSERT/UPDATE 변경 시 onChange(payload) 호출
        subscribe(onChange) {
          try {
            const channel = client
              .channel('deliveries-realtime-' + Math.random().toString(36).slice(2, 8))
              .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'deliveries' },
                (payload) => {
                  try { onChange && onChange(payload); }
                  catch (e) { console.warn('[NL] subscribe handler 오류:', e); }
                }
              )
              .subscribe((status) => {
                console.log('[NL] realtime status:', status);
              });
            return channel;
          } catch (e) {
            console.warn('[NL] subscribe 실패:', (e && e.message) || e);
            return null;
          }
        },

        /* 기사 현재 위치 공유 — driver_location 테이블에 id='driver' 로 upsert */
        async pushDriverLocation(lat, lng) {
          try {
            if (typeof lat !== 'number' || typeof lng !== 'number') {
              throw new Error('pushDriverLocation: lat/lng 숫자 필수');
            }
            const { error } = await client
              .from('driver_location')
              .upsert({
                id: 'driver',
                lat, lng,
                updated_at: new Date().toISOString()
              }, { onConflict: 'id' });
            if (error) throw error;
            return true;
          } catch (e) {
            console.warn('[NL] pushDriverLocation 실패:', (e && e.message) || e);
            return false;
          }
        },

        /* 기사 위치 실시간 구독 — driver_location INSERT/UPDATE 시 onMove({lat,lng}) */
        subscribeDriverLocation(onMove) {
          try {
            const channel = client
              .channel('driver-location-realtime-' + Math.random().toString(36).slice(2, 8))
              .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'driver_location' },
                (payload) => {
                  try {
                    const row = payload.new || payload.old;
                    if (row && typeof row.lat === 'number' && typeof row.lng === 'number') {
                      onMove && onMove({ lat: row.lat, lng: row.lng });
                    }
                  } catch (e) {
                    console.warn('[NL] subscribeDriverLocation handler 오류:', e);
                  }
                }
              )
              .subscribe((status) => {
                console.log('[NL] driver-location realtime status:', status);
              });
            return channel;
          } catch (e) {
            console.warn('[NL] subscribeDriverLocation 실패:', (e && e.message) || e);
            return null;
          }
        }
      };

      window.NL = NL;
      console.log('[NL] ✓ Supabase 클라이언트 초기화 완료');
      try { resolveReady(NL); } catch (_) {}
    } catch (e) {
      console.error('[NL] 초기화 실패:', e);
    }
  }

  // SDK 가 이미 있으면 바로, 없으면 CDN 로드 후 init
  if (window.supabase && window.supabase.createClient) {
    init();
  } else {
    const s = document.createElement('script');
    s.src = SDK_CDN;
    s.async = false;
    s.onload = () => {
      console.log('[NL] ✓ Supabase SDK CDN 로드');
      init();
    };
    s.onerror = () => {
      console.error('[NL] ✗ Supabase SDK CDN 로드 실패:', SDK_CDN);
    };
    document.head.appendChild(s);
  }
})();
