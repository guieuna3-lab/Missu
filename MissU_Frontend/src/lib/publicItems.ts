import { api, apiBase, ApiError } from './backend';
import { itemRepository as fixtures, type PublicItem, type SearchFilters } from './items';

type ApiItem = {
  id: string;
  name: string;
  publicFeatures: string | null;
  foundAt: string;
  foundLocation: { label: string };
  storagePlace: string;
  pickupGuide: string | null;
  photos: { url: string }[];
  status: string;
};

function fromApi(item: ApiItem): PublicItem {
  return {
    id: item.id,
    name: item.name,
    description: item.publicFeatures ?? '',
    foundAt: item.foundAt,
    location: item.foundLocation.label,
    storage: item.storagePlace,
    collectionGuide: item.pickupGuide ?? '',
    photoUrl: item.photos[0] ? new URL(item.photos[0].url, apiBase).href : undefined,
    statusLabel:
      item.status === 'AVAILABLE'
        ? '보관 중'
        : item.status === 'RESERVED'
          ? '반환 진행 중'
          : '반환 완료',
  };
}

// 시연 모드에서는 빈 목록과 연결 실패도 서버의 결과 그대로 화면에 전달합니다.
export const itemRepository = !apiBase
  ? fixtures
  : {
      async search(filters: SearchFilters) {
        const query = new URLSearchParams({ q: filters.query.trim(), limit: '50' });
        if (filters.place.trim()) query.set('place', filters.place.trim());
        if (filters.period !== 'all') {
          query.set(
            'foundFrom',
            new Date(Date.now() - Number(filters.period) * 86400000).toISOString(),
          );
        }
        const out = await api<{ data: ApiItem[] }>('/items?' + query.toString());
        return out.data.map(fromApi);
      },
      async find(id: string) {
        try {
          return fromApi((await api<{ data: ApiItem }>('/items/' + encodeURIComponent(id))).data);
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) return undefined;
          throw error;
        }
      },
    };
