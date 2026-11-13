import { DomUtils, parseDocument } from 'htmlparser2';

export type Source = '한성대' | '경찰' | '지하철';
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
  category: string;
};
export type Batch = { items: InstitutionItem[]; limited: boolean };

const byTag = DomUtils.getElementsByTagName;
const plain = DomUtils.textContent;
export const school = '한성대학교 상상관 글로벌원스톱센터';
const policeSite =
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
export function schoolPage(html: string, page = 1): Batch {
  const dom = parseDocument(html);
  if (
    !byTag('th', dom.children).some((node) => plain(node).trim() === '작성일')
  )
    throw Error('Unknown board layout');
  const items: InstitutionItem[] = [];
  for (const row of byTag('tr', dom.children)) {
    const link = byTag('a', row.children).find((node) =>
      /^\/bbs\/onestop\/1718\/\d+\/artclView\.do$/.test(
        node.attribs.href ?? '',
      ),
    );
    if (!link) continue;
    const title = plain(link).trim();
    const cell = byTag('td', row.children).find((node) =>
      node.attribs.class?.split(/\s+/).includes('td-date'),
    );
    const date = cell && plain(cell).trim().replaceAll('.', '-');
    if (
      !date ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !/보관\s*중/u.test(title) ||
      /반환|폐기|수령\s*완료/u.test(title)
    )
      continue;
    const id = link.attribs.href.split('/')[4];
    const name = title.match(/\((.+)\)\s*보관/u)?.[1] || title;
    items.push({
      id: 'hansung:' + id,
      source: '한성대',
      name,
      category: category(name),
      date,
      dateLabel: '게시일',
      storage: school,
      reference: id,
      url: 'https://www.hansung.ac.kr' + link.attribs.href,
    });
  }
  const count = plain(dom).match(/총\s*([\d,]+)\s*개의?\s*게시물/u);
  const pageLinks = byTag('a', dom.children).map((a) =>
    Number(a.attribs.href?.match(/page_link\(['"](\d+)['"]\)/)?.[1] || 0),
  );
  const rows = byTag('td', dom.children).filter(
    (x) => x.attribs.class === 'td-date',
  ).length;
  return {
    items,
    limited:
      pageLinks.some((n) => n > page) ||
      (!!count &&
        rows > 0 &&
        Number(count[1].replaceAll(',', '')) > (page - 1) * 10 + rows),
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
  const total = Number(tag('totalCount'));
  return {
    records,
    limited: records.length > 0 && (page - 1) * size + records.length < total,
  };
}
export function governmentItem(
  row: Record<string, string>,
  source: '경찰' | '지하철',
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
  if (
    source === '지하철' &&
    !/지하철|도시철도|교통공사|메트로|경전철|호선|역무실|역유실물|전철|철도공사/u.test(
      [row.fndKeepOrgnSeNm, row.orgNm, storage].join(' '),
    )
  )
    return;
  return {
    id: 'lost112:' + reference + ':' + sn,
    reference: reference + ' / ' + sn,
    source,
    name,
    date,
    dateLabel: '습득일',
    storage,
    category: category((row.prdtClNm || '') + ' ' + name),
    url: policeSite,
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
