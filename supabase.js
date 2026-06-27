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

        /* 인증 직후 호출 — 행은 남기고 개인정보만 null + status='received'.
           폐기완료 화면을 보는 동안 DB 가 이 상태로 유지되어 양쪽 앱이 일치.
           새로고침 시 부트스트랩이 received 행을 DELETE 로 깨끗하게 초기화함. */
        async markReceived(id) {
          try {
            if (!id) throw new Error('markReceived: id 필수');
            const { error, count, status } = await client
              .from('deliveries')
              .update({
                name: null, address: null, phone: null,
                status: 'received',
                updated_at: new Date().toISOString()
              }, { count: 'exact' })
              .eq('id', id);
            if (error) {
              console.error('[NL] ✗ markReceived UPDATE 오류 (HTTP', status + '):', error);
              throw error;
            }
            console.log('[NL] markReceived UPDATE — id:', id, '/ 영향 행:', count);
            if (!count) {
              console.warn('[NL] ⚠️ UPDATE 0 행 — id 없음 또는 RLS UPDATE 정책 누락');
              console.warn('[NL] SQL: create policy "anon_update" on public.deliveries for update to anon using (true) with check (true);');
              return false;
            }
            console.log('[NL] ✓ markReceived 완료');
            return true;
          } catch (e) {
            console.error('[NL] ✗ markReceived 실패:', (e && e.message) || e);
            return false;
          }
        },

        /* 개인정보 실제 폐기 — 행 자체를 DELETE.
           ⚠️ Supabase 는 RLS DELETE 정책이 없으면 silently 0 행이 삭제되고
           error 도 안 나옴. count:'exact' 로 실제 영향 행수를 확인해
           0 이면 실패로 간주하고 콘솔에 RLS 안내를 띄움.

           필요 SQL (Supabase SQL editor 에서 한 번 실행):
             alter table public.deliveries enable row level security;
             create policy "anon_delete" on public.deliveries
               for delete to anon using (true);
             create policy "anon_select" on public.deliveries
               for select to anon using (true);
             create policy "anon_insert" on public.deliveries
               for insert to anon with check (true);
             create policy "anon_update" on public.deliveries
               for update to anon using (true) with check (true);
           driver_location 도 동일 4종 정책. */
        async clearInfo(id) {
          try {
            if (!id) throw new Error('clearInfo: id 필수');
            const { error, count, status } = await client
              .from('deliveries')
              .delete({ count: 'exact' })
              .eq('id', id);
            if (error) {
              console.error('[NL] ✗ clearInfo DELETE 오류 (HTTP', status + '):', error);
              throw error;
            }
            console.log('[NL] clearInfo DELETE 결과 — id:', id, '/ 영향 행:', count);
            if (!count) {
              console.warn('[NL] ⚠️ DELETE 적용 0 행 — id 가 없거나 RLS DELETE 정책 누락 가능');
              console.warn('[NL] SQL: create policy "anon_delete" on public.deliveries for delete to anon using (true);');
              return false;
            }
            console.log('[NL] ✓ clearInfo 완료');
            return true;
          } catch (e) {
            console.error('[NL] ✗ clearInfo 실패:', (e && e.message) || e);
            return false;
          }
        },

        /* 데모 리셋 — deliveries 전부 + driver_location 삭제. count 로 검증. */
        async resetDemo() {
          const stats = { deliveriesDeleted: 0, driverLocDeleted: 0, errors: [] };
          try {
            const { error, count } = await client
              .from('deliveries')
              .delete({ count: 'exact' })
              .not('id', 'is', null);
            if (error) throw error;
            stats.deliveriesDeleted = count || 0;
            console.log('[NL] resetDemo deliveries DELETE — 영향 행:', count);
          } catch (e) {
            const msg = (e && e.message) || String(e);
            stats.errors.push('deliveries:' + msg);
            console.error('[NL] ✗ resetDemo deliveries 실패:', msg);
            console.warn('[NL] RLS DELETE 정책이 없을 수 있음 (anon 권한 확인)');
          }
          try {
            const { error, count } = await client
              .from('driver_location')
              .delete({ count: 'exact' })
              .not('id', 'is', null);
            if (error) throw error;
            stats.driverLocDeleted = count || 0;
            console.log('[NL] resetDemo driver_location DELETE — 영향 행:', count);
          } catch (e) {
            const msg = (e && e.message) || String(e);
            stats.errors.push('driver_location:' + msg);
            console.warn('[NL] resetDemo driver_location 실패:', msg);
          }
          console.log('[NL] resetDemo: deliveries ' + stats.deliveriesDeleted + '행, driver_location ' + stats.driverLocDeleted + '행 삭제');
          return stats;
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
