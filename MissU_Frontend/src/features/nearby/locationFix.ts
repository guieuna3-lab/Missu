type Fix = {
  timestamp: number;
  coords: { latitude: number; longitude: number; accuracy: number | null };
};

const waitMs = 15000;

// 주변 검색과 경로 기록에 같은 기준을 적용합니다. 오차는 기기가 보고한 반경입니다.
export function usableLocation({ coords, timestamp }: Fix, now = Date.now()) {
  const { latitude, longitude, accuracy } = coords;
  return (
    Number.isFinite(latitude) &&
    Math.abs(latitude) <= 90 &&
    Number.isFinite(longitude) &&
    Math.abs(longitude) <= 180 &&
    accuracy !== null &&
    Number.isFinite(accuracy) &&
    accuracy >= 0 &&
    accuracy <= 250 &&
    Number.isFinite(timestamp) &&
    timestamp >= now - waitMs &&
    timestamp <= now + 1000
  );
}

export function readFreshLocation<T extends Fix>(
  subscribe: (
    onFix: (fix: T) => void,
    onError: (error: Error) => void,
  ) => Promise<{ remove: () => void }>,
): Promise<T> {
  let subscription: { remove: () => void } | undefined;
  let finished = false;
  let timer: ReturnType<typeof setTimeout>;
  let refineTimer: ReturnType<typeof setTimeout> | undefined;
  let best: T | undefined;
  let received = false;
  return new Promise<T>((resolve, reject) => {
    const useBest = () => {
      if (best && usableLocation(best)) {
        resolve(best);
        return true;
      }
      best = undefined;
      return false;
    };
    timer = setTimeout(() => {
      if (useBest()) return;
      reject(
        new Error(
          received
            ? '최근의 정확한 위치 신호를 받지 못했어요. 잠시 후 다시 시도해 주세요.'
            : '현재 위치를 찾지 못했어요. 기기의 위치 서비스를 확인해 주세요.',
        ),
      );
    }, waitMs);
    subscribe((fix) => {
      received = true;
      if (!usableLocation(fix) || fix.coords.accuracy === null) return;
      if (
        !best ||
        !usableLocation(best) ||
        fix.coords.accuracy <= (best.coords.accuracy ?? Infinity)
      ) {
        best = fix;
      }
      // 첫 Wi-Fi 추정치가 넓으면 잠시 더 측정해, 그 사이 받은 가장 정밀한 좌표를 씁니다.
      if (fix.coords.accuracy <= 25) resolve(fix);
      else if (!refineTimer) {
        refineTimer = setTimeout(() => {
          refineTimer = undefined;
          useBest();
        }, 4000);
      }
    }, reject)
      .then((watch) => {
        // 네이티브 구독은 첫 신호나 제한 시간보다 늦게 준비될 수 있습니다.
        if (finished) watch.remove();
        else subscription = watch;
      })
      .catch(reject);
  }).finally(() => {
    finished = true;
    clearTimeout(timer);
    clearTimeout(refineTimer);
    subscription?.remove();
  });
}
