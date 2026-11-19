import { apiBase } from './backend.ts';

/** 서버가 발급한 상대 주소를 절대 주소로 바꾸고 학교 다운로드는 이미지 API로 엽니다. */
export function displayPhotoUrls(id: string, urls: readonly string[] = []) {
  return [...new Set(urls.filter(Boolean))]
    .slice(0, 8)
    .map((url, index) =>
      /^hansung:\d+$/.test(id)
        ? `${apiBase}/institution-items/image/${encodeURIComponent(id)}/${index}`
        : url.startsWith('/')
          ? new URL(url, apiBase).href
          : url,
    );
}

type Entry = { until: number; value: Promise<string[]> };
const cache = new Map<string, Entry>();
let active = 0;
const waiting: (() => void)[] = [];
async function queued<T>(work: () => Promise<T>) {
  if (active >= 3) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await work();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

/** 목록·상세가 같은 물품을 요청하면 공유하고, 사진이 빠진 오래된 목록도 보완합니다. */
export function loadItemPhotos(id: string, refresh = false) {
  if (!/^(?:hansung:\d+|lost112:[A-Z0-9]+:\d+|[a-f\d-]{36})$/.test(id)) return Promise.resolve([]);
  const existing = cache.get(id);
  if (existing && (existing.until === Infinity || (!refresh && existing.until > Date.now())))
    return existing.value;
  if (cache.size >= 200) cache.delete(cache.keys().next().value!);
  const value = queued(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const institution = /^(hansung|lost112):/.test(id);
      const path = institution ? '/institution-items/photos/' : '/items/';
      const response = await fetch(apiBase + path + encodeURIComponent(id), {
        credentials: 'omit',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('사진을 다시 확인하지 못했어요.');
      const body = (await response.json()) as { data: string[] | { photos?: { url: string }[] } };
      const urls = Array.isArray(body.data)
        ? body.data
        : (body.data.photos?.map((p) => p.url) ?? []);
      return displayPhotoUrls(id, urls);
    } finally {
      clearTimeout(timer);
    }
  });
  const entry = { until: Number.POSITIVE_INFINITY, value };
  cache.set(id, entry);
  void value.then(
    (urls) => {
      if (cache.get(id) === entry) entry.until = Date.now() + (urls.length ? 240_000 : 60_000);
    },
    () => {
      // 일시 실패를 '사진 없음'으로 저장하지 않습니다. 다음 화면에서 다시 확인합니다.
      if (cache.get(id) === entry) cache.delete(id);
    },
  );
  return value;
}
