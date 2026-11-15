import { DomUtils, parseDocument } from 'htmlparser2';

export type Source = '한성대' | '경찰' | '지하철' | '포털기관';
export type Point = { lat: number; lng: number };
export type InstitutionItem = {
  id: string;
  name: string;
  source: Source;
  storage: string;
  date: string;
  dateLabel: '게시일' | '습득일';
  url: string;
  reference: string;
  lastVerifiedOn?: string;
  category: string;
  phone?: string;
  foundPlace?: string;
};
export type Batch = { items: InstitutionItem[]; limited: boolean };

const byTag = DomUtils.getElementsByTagName;
const plain = DomUtils.textContent;
export const school = '한성대학교 상상관 글로벌원스톱센터';
export const policeSite =
  'https://minwon24.police.go.kr/cvlcpt/cvlcptGdInfo.do?cvlcptId=MW-201';
export const clean = (value: string) =>
  value.replace(/\s+/gu, '').toLowerCase();
function category(text: string) {
  if (
    /전자|휴대폰|핸드폰|이어폰|버즈|에어팟|노트북|태블릿|충전기|헤드폰/u.test(
      text,
    )
  )
    return 'ELECTRONICS';
  if (/지갑|가방|백팩|파우치/u.test(text)) return 'WALLET_BAG';
  return 'OTHER';
}
const schoolBoard = '/bbs/hansung/2175/';
export const schoolList =
  'https://www.hansung.ac.kr' + schoolBoard + 'artclList.do';
export const schoolArticle = (id: string) =>
  'https://www.hansung.ac.kr' + schoolBoard + id + '/artclView.do';
function schoolRecord(
  id: string,
  title: string,
  state: string,
  date: string,
): InstitutionItem | undefined {
  // 학교는 반환한 뒤에도 제목의 ‘보관중’을 남깁니다. 게시물 분류를 우선합니다.
  if (
    state !== '접수' ||
    /반환|폐기|수령\s*완료/u.test(title) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  )
    return;
  const name = title.match(/\((.+)\)\s*보관/u)?.[1] ?? title;
  if (!name) return;
  return {
    id: 'hansung:' + id,
    reference: id,
    source: '한성대',
    name,
    category: category(name),
    date,
    dateLabel: '게시일',
    storage: school,
    url: schoolArticle(id),
    phone: '02-760-8000',
    foundPlace: title.match(/^(.+?)에서\s*습득/u)?.[1],
  };
}
export function schoolDetail(html: string, id: string) {
  const dom = parseDocument(html);
  const header = DomUtils.findOne(
    (el) =>
      el.attribs.class?.split(/\s+/).includes('title') &&
      byTag('span', el.children).some((s) =>
        s.attribs.class?.includes('cate-name'),
      ),
    dom.children,
  );
  if (!header) throw Error('Unknown school article');
  const state = byTag('span', header.children).find((s) =>
    s.attribs.class?.includes('cate-name'),
  );
  const title = byTag('strong', header.children)[0];
  const date = plain(header)
    .match(/작성일\s*:\s*(\d{4}\.\d{2}\.\d{2})/)?.[1]
    .replaceAll('.', '-');
  const item =
    title && state && date
      ? schoolRecord(id, plain(title).trim(), plain(state).trim(), date)
      : undefined;
  const found = schoolFoundDay(html);
  if (item && found)
    return { ...item, date: found, dateLabel: '습득일' as const };
  return item;
}
export function schoolPage(html: string, page = 1, cutoff?: string): Batch {
  const dom = parseDocument(html);
  if (
    !byTag('th', dom.children).some((node) => plain(node).trim() === '작성일')
  )
    throw Error('Unknown board layout');
  const items: InstitutionItem[] = [];
  for (const row of byTag('tr', dom.children)) {
    const link = byTag('a', row.children).find((a) =>
      /^\/bbs\/hansung\/2175\/\d+\/artclView\.do$/.test(a.attribs.href || ''),
    );
    if (!link) continue;
    const state = byTag('span', link.children).find((n) =>
      n.attribs.class?.split(/\s+/).includes('cate-name'),
    );
    const title = byTag('strong', link.children)[0];
    const cell = byTag('td', row.children).find((n) =>
      n.attribs.class?.split(/\s+/).includes('td-date'),
    );
    if (!state || !title || !cell) continue;
    const item = schoolRecord(
      link.attribs.href.split('/')[4],
      plain(title).trim(),
      plain(state).trim(),
      plain(cell).trim().replaceAll('.', '-'),
    );
    if (item) items.push(item);
  }
  const count = plain(dom).match(/총\s*([\d,]+)\s*개의?\s*게시물/u);
  const pageLinks = byTag('a', dom.children).map((a) =>
    Number(a.attribs.href?.match(/page_link\(['"](\d+)['"]\)/)?.[1] || 0),
  );
  const dates = byTag('td', dom.children)
    .filter((x) => x.attribs.class?.split(/\s+/).includes('td-date'))
    .map((x) => plain(x).trim().replaceAll('.', '-'));
  // 학교 목록은 게시일 역순입니다. 학교가 기간 필터를 무시해도 오래된 페이지를 계속 요청하지 않습니다.
  const inRange = dates.some((day) => !cutoff || day >= cutoff);
  return {
    items,
    limited:
      inRange &&
      (pageLinks.some((n) => n > page) ||
        (!!count &&
          Number(count[1].replaceAll(',', '')) >
            (page - 1) * 10 + dates.length)),
  };
}
export function policePage(xml: string) {
  const dom = parseDocument(xml, { xmlMode: true });
  const tag = (name: string) =>
    plain(byTag(name, dom.children)[0] ?? []).trim();
  if (tag('resultCode') !== '00') throw Error('Government data unavailable');
  const records = byTag('item', dom.children).map((node) =>
    Object.fromEntries(
      DomUtils.getChildren(node).flatMap((child) =>
        child.type === 'tag' && 'name' in child
          ? [[child.name, plain(child).trim()]]
          : [],
      ),
    ),
  ) as Record<string, string>[];
  const page = Number(tag('pageNo')) || 1;
  const size = Number(tag('numOfRows')) || records.length;
  const rawTotal = tag('totalCount');
  const total =
    /^\d+$/.test(rawTotal) && Number.isSafeInteger(Number(rawTotal))
      ? Number(rawTotal)
      : null;
  return {
    records,
    total,
    page,
    size,
    limited:
      total !== null &&
      records.length > 0 &&
      (page - 1) * size + records.length < total,
  };
}
// 경찰민원24의 공개 상세에서 보관 상태와 물품 정보만 읽습니다.
export function portalDetail(html: string, atcId: string, fdSn: string) {
  const dom = parseDocument(html);
  const fields = new Map<string, string>();
  for (const row of byTag('tr', dom.children)) {
    const label = byTag('th', row.children)[0];
    const value = byTag('td', row.children)[0];
    if (label && value) fields.set(plain(label).trim(), plain(value).trim());
  }
  if (
    fields.get('관리번호') !== atcId + '-' + fdSn ||
    !fields.get('유실물 상태')
  )
    throw Error('Unknown custody detail');
  const name = byTag('h4', dom.children)
    .filter((el) => el.attribs.class?.split(/\s+/).includes('box-tit1'))
    .map((el) => plain(el).trim())
    .find((title) => title && title !== '상세내용');
  return {
    atcId,
    fdSn,
    fdPrdtNm: name || '',
    fdYmd: fields.get('습득일')?.match(/\d{4}-\d{2}-\d{2}/)?.[0] || '',
    depPlace: fields.get('보관장소') || '',
    csteSteNm: fields.get('유실물 상태')!,
    prdtClNm: fields.get('물품 분류') || '',
    tel: fields.get('보관장소 연락처') || '',
  };
}

export function governmentItem(
  row: Record<string, string>,
  source: '경찰' | '포털기관',
): InstitutionItem | undefined {
  const reference = row.atcId,
    sn = row.fdSn,
    name = row.fdPrdtNm,
    storage = row.depPlace;
  const date = (row.fdYmd || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  if (
    !reference ||
    !sn ||
    !name ||
    !storage ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  )
    return;
  if (clean(row.csteSteNm || '') !== '보관중') return;
  // 지하철과 그 밖의 포털기관 모두 같은 보관 상태 기준을 적용합니다.
  const rail =
    /지하철|도시철도|교통공사|메트로|경전철|호선|역무실|역유실물|전철|철도공사/u.test(
      [row.fndKeepOrgnSeNm, row.orgNm, storage].join(' '),
    );
  return {
    id: 'lost112:' + reference + ':' + sn,
    reference: reference + ' / ' + sn,
    source: source === '포털기관' && rail ? '지하철' : source,
    name,
    date,
    dateLabel: '습득일',
    storage,
    category: category((row.prdtClNm || '') + ' ' + name),
    url: policeSite,
    phone: /^(?:0[0-9 -]{7,15}|1[0-9 -]{7,9})$/.test(row.tel || '')
      ? row.tel.trim()
      : undefined,
  };
}
export function distance(a: Point, b: Point) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((a.lat - b.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) *
      Math.cos(b.lat * rad) *
      Math.sin(((a.lng - b.lng) * rad) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(Math.min(1, h)));
}
// 기관 주소 뒤에 부서 이름이 붙는 자료도 도로명과 건물 번호까지 대조합니다.
export function roadKey(address: string) {
  return address
    .match(
      /([가-힣A-Za-z0-9·.]+(?:로|길|대로))\s+(?:지하\s*)?(\d+(?:-\d+)?)(?=\s|,|\(|$)/u,
    )?.[0]
    .replace(/\s+/g, '');
}

export const koreaDay = (ms = Date.now()) =>
  new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
// 월말을 대상 월의 마지막 날로 맞춥니다. 예: 8월 31일 → 2월 28일(윤년은 29일).
export function sinceFound(days = 'all', ms = Date.now()) {
  const today = new Date(koreaDay(ms) + 'T00:00:00Z');
  if (days === '7' || days === '30') {
    today.setUTCDate(today.getUTCDate() - Number(days) + 1);
    return today.toISOString().slice(0, 10);
  }
  const last = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5, 0),
  );
  last.setUTCDate(Math.min(today.getUTCDate(), last.getUTCDate()));
  return last.toISOString().slice(0, 10);
}
export function schoolFoundDay(html: string) {
  // 작성일이나 각인 숫자를 습득일로 오인하지 않도록 본문에서 명시한 날짜만 읽습니다.
  const dom = parseDocument(html);
  const body = DomUtils.findOne(
    (el) => (el.attribs.class || '').split(/\s+/).includes('txt'),
    dom.children,
  );
  const match =
    body &&
    plain(body).match(
      /(?:습득|발견)\s*(?:일자|일시|일|날짜)\s*[:：]?\s*(20\d{2})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})(?!\d)/u,
    );
  if (!match) return;
  const day = [
    match[1],
    match[2].padStart(2, '0'),
    match[3].padStart(2, '0'),
  ].join('-');
  const date = new Date(day + 'T00:00:00Z');
  if (
    Number.isFinite(date.getTime()) &&
    date.toISOString().startsWith(day + 'T')
  )
    return day;
}
