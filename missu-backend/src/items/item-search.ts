// 왼쪽은 같은 검색어, 오른쪽은 포괄어로도 찾을 수 있는 세부 품목입니다.
// 세부 이름으로 검색할 때는 같은 계열의 다른 제품까지 확장하지 않습니다.
const vocabulary: [string, string?][] = [
  [
    '핸드폰|휴대폰|휴대전화|휴대 전화|스마트폰|스마트 폰|handphone|smartphone|셀폰',
    '아이폰|iphone|갤럭시폰|갤럭시 폰|갤럭시s|갤럭시 s|갤럭시a|갤럭시 a|갤럭시 노트|플립|폴드|삼성휴대폰|lg폰',
  ],
  ['아이폰|iphone'],
  [
    '갤럭시폰|갤럭시 폰|삼성휴대폰',
    '갤럭시s|갤럭시 s|갤럭시a|갤럭시 a|플립|폴드',
  ],
  [
    '이어폰|이어 버드|이어버드|이어셋|earbuds|earphones',
    '에어팟|airpods|갤럭시버즈|갤럭시 버즈|버즈',
  ],
  ['에어팟|airpods'],
  ['버즈|갤럭시버즈|갤럭시 버즈|galaxy buds'],
  ['헤드폰|헤드셋|headphones'],
  ['노트북|랩탑|laptop', '맥북|macbook|그램|갤럭시북'],
  ['맥북|macbook'],
  [
    '태블릿|태블릿pc|타블렛|태블릿 pc|tablet',
    '아이패드|ipad|갤럭시탭|갤럭시 탭',
  ],
  ['아이패드|ipad'],
  ['갤럭시탭|갤럭시 탭|galaxy tab'],
  ['지갑|월렛|wallet', '카드홀더|카드 홀더|머니클립'],
  ['카드지갑|카드 지갑|카드홀더|카드 홀더|cardholder'],
  [
    '가방|bag',
    '백팩|배낭|숄더백|에코백|핸드백|토트백|크로스백|서류가방|캐리어',
  ],
  ['백팩|배낭|책가방|backpack'],
  ['캐리어|여행가방|여행 가방|트렁크|suitcase'],
  ['파우치|pouch'],
  ['열쇠|열쇠꾸러미|key', '차키|자동차키|자동차 키|스마트키|집키'],
  ['자동차 키|자동차키|차 키|차키|스마트키|스마트 키|car key'],
  ['신분증|신분 증명서', '주민등록증|민증|운전면허증|학생증|여권|외국인등록증'],
  ['주민등록증|민증'],
  ['면허증|운전면허증|운전 면허증'],
  ['여권|passport'],
  ['카드|card', '체크카드|신용카드|교통카드|티머니'],
  ['교통카드|교통 카드|티머니|t-money'],
  ['우산|umbrella', '장우산|접이식우산'],
  ['안경|안경테|eyeglasses', '선글라스|썬글라스'],
  ['선글라스|썬글라스|sunglasses'],
  ['시계|watch', '손목시계|스마트워치|애플워치|갤럭시워치'],
  [
    '스마트워치|스마트 워치|smartwatch',
    '애플워치|애플 워치|갤럭시워치|갤럭시 워치',
  ],
  ['충전기|어댑터|아답터|충전 어댑터|충전어댑터|charger'],
  ['충전선|충전케이블|충전 케이블'],
  ['보조배터리|보조 배터리|파워뱅크|powerbank'],
  ['usb|유에스비|usb메모리|플래시드라이브'],
  ['카메라|사진기|camera', '디카|디지털카메라'],
  ['현금|돈|cash', '지폐|동전'],
  ['책|도서|서적|book', '교재|단행본'],
  ['텀블러|보온병|tumbler'],
  ['물병|물통'],
  ['의류|옷|의복', '외투|코트|자켓|재킷|점퍼|패딩|셔츠|바지|가디건'],
  ['자켓|재킷|jacket'],
  ['가디건|카디건'],
  ['모자|hat', '볼캡|비니|야구모자'],
  ['목도리|머플러|스카프'],
  ['신발|슈즈', '운동화|스니커즈|구두|슬리퍼'],
  ['운동화|스니커즈|sneakers'],
  ['귀금속|장신구|주얼리|쥬얼리', '반지|귀걸이|목걸이|팔찌'],
  ['귀걸이|귀고리|이어링'],
  ['팔찌|브레이슬릿'],
  ['화장품|코스메틱', '립스틱|립밤|틴트|파운데이션|쿠션'],
  ['향수|퍼퓸|perfume'],
  // 국립국어원 전국 방언 지도(가위), 지역 언어문화 축제 보고서(주머니).
  ['가위|가새|가시개|scissors'],
  ['주머니|주머이|염당주머니|염당 주머니'],
  // 국립국어원 '지역어 낱말 듣기'에서 같은 도구로 조사한 이름.
  ['바구니|바구리|보굼치|바굼지|대바구리|바구리구덕'],
  ['반짇고리|바느질상자|바농쌍지|반주꾸리'],
  ['밥주걱|밥쭈걱|밥쭈게|밥주게|밥쭈개'],
  ['필통|펜케이스|펜 케이스'],
  ['인형|봉제인형'],
  ['악기|악기류', '통기타|일렉기타|바이올린|플루트'],
  ['무선마우스|무선 마우스'],
  ['마우스|mouse'],
  ['자전거|bicycle'],
  ['헬멧|헬멧모|helmet'],
];
const compact = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s()·-]/gu, '');
const aliases = new Map<string, string[]>();
const phrases = new Set<string>();
for (const [same, sub] of vocabulary) {
  const names = same.split('|');
  const variants = [...new Set([...names, ...(sub?.split('|') ?? [])])];
  for (const name of names) {
    aliases.set(compact(name), variants);
    if (name.includes(' ')) phrases.add(name);
  }
}
const multiword = [...phrases].sort((a, b) => b.length - a.length);
export const likeLiteral = (s: string) => s.replace(/[\\%_]/g, '\\$&');
export function itemSearch(query = '', place = '') {
  let q = query.normalize('NFKC').toLowerCase().trim();
  const inferred = q.match(
    /(?:^|\s)([가-힣a-z0-9·]{1,30}(?:역|대학교|공항|터미널|경찰서|파출소|지구대|유실물센터)(?:\s*\(?\d+호선\)?)?|한성대)(?=\s|$)/u,
  );
  if (inferred && (!place || compact(place).includes(compact(inferred[1])))) {
    place ||= inferred[1];
    q = q.replace(inferred[0], ' ').trim();
  }
  // '자동차 키'처럼 여러 단어로 된 물품명은 공백을 나누기 전에 합칩니다.
  for (const phrase of multiword) q = q.replaceAll(phrase, compact(phrase));
  const terms = q
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => aliases.get(compact(word)) ?? [word]);
  // '아이폰 케이스'처럼 액세서리 자체를 등록한 글과 본체를 구별합니다.
  const accessoryNames = [
    '케이스',
    '충전기',
    '충전선',
    '충전케이블',
    '케이블',
    '거치대',
    '스트랩',
    '보호필름',
    '커버',
  ];
  const device = terms.some((group) =>
    group.some((word) =>
      [
        '핸드폰',
        '아이폰',
        '갤럭시폰',
        '아이패드',
        '맥북',
        '에어팟',
        '버즈',
      ].includes(word),
    ),
  );
  const excludedEndings =
    device && !accessoryNames.some((word) => compact(q).includes(word))
      ? accessoryNames
      : [];
  // 기관 분류와 제품명이 충돌하면 제품명에 명시된 기종을 우선합니다.
  const brand = terms.find((group) =>
    ['아이폰', '갤럭시폰'].includes(group[0]),
  );
  const otherBrand = !brand
    ? []
    : brand[0] === '아이폰'
      ? [
          '삼성휴대폰',
          '삼성 휴대폰',
          '삼성핸드폰',
          '삼성 핸드폰',
          '삼성폰',
          '삼성스마트폰',
          '삼성 스마트폰',
          '갤럭시',
          'galaxy',
        ]
      : ['아이폰', 'iphone'];
  return { q, place: place.trim(), terms, excludedEndings, brand, otherBrand };
}
export type ItemSearch = ReturnType<typeof itemSearch>;
export function matchesName(search: ItemSearch, ...fields: string[]) {
  const values = fields.map(compact);
  const title = values[0] ?? '';
  if (
    search.otherBrand.some((word) => title.includes(compact(word))) &&
    !search.brand?.some((word) => title.includes(compact(word)))
  )
    return false;
  if (search.excludedEndings.some((word) => values[0]?.endsWith(word)))
    return false;
  return search.terms.every((group) =>
    group.some((word) => values.some((value) => value.includes(compact(word)))),
  );
}
export function matchesPlace(place: string, ...fields: (string | undefined)[]) {
  const key = compact(place);
  return (
    !key || fields.some((field) => !!field && compact(field).includes(key))
  );
}

export function brandNameFilter(search: ItemSearch) {
  if (!search.brand) return [];
  const inName = (word: string) => ({
    name: { contains: likeLiteral(word), mode: 'insensitive' as const },
  });
  return [
    {
      OR: [...search.brand.map(inName), { NOT: search.otherBrand.map(inName) }],
    },
  ];
}
