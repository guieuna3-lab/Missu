import { Prisma, type LostReport } from '../generated/prisma/client';
import { DatabaseService } from '../database/database.service';
import {
  koreaDay,
  sinceFound,
  type InstitutionItem,
} from '../items/institution-records';

const kindNames: Record<string, string[]> = {
  WALLET: ['지갑', '월렛'],
  BAG: ['가방', '백팩', '핸드백', '에코백'],
  KEY: ['열쇠', '자동차키', '차키', '스마트키'],
  ID: ['신분증', '주민등록증', '면허증', '학생증', '여권'],
};
const families = [
  ['휴대폰', '핸드폰', '스마트폰', '아이폰', '갤럭시폰'],
  ['이어폰', '에어팟', '버즈', '헤드폰'],
  ['노트북', '맥북', '랩탑'],
  ['태블릿', '아이패드', '갤럭시탭'],
  ['충전기', '충전케이블'],
  ...Object.values(kindNames),
];
type SuggestedItem = {
  id: string;
  name: string;
  source: string;
  place: string;
  day: string;
  dateLabel: string;
};

// 신고 정보는 서버 안에서만 비교합니다. 기관에는 신고자의 위치와 물품명을 보내지 않습니다.
export async function reportMatches(
  db: DatabaseService,
  report: LostReport,
  school: InstitutionItem[],
) {
  const lower = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  const name = lower(report.name);
  const family =
    families.find((words) => words.some((word) => name.includes(word))) ??
    kindNames[report.category] ??
    [];
  const words = report.name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(
      (word) =>
        word.length >= 2 &&
        !/^(검정|검은|검은색|검정색|검은색의|블랙|흰색|하얀색|분홍색|갈색|남색|빨간색|파란색|작은|분실|분실물|물건)$/.test(
          word,
        ),
    );
  const terms = [...new Set([...family, ...words])];
  const place = report.placeName || report.lostLabel;
  const station = place.match(/[가-힣A-Za-z0-9·]+역(?=\s|\(|$)/u)?.[0];
  const placeKey = lower(station || place);
  const cutoff = new Date(
    Math.max(
      report.lostStart.getTime(),
      Date.parse(sinceFound() + 'T00:00:00+09:00'),
    ),
  );
  const today = koreaDay(),
    from = koreaDay(cutoff.getTime());
  const schoolRows = school
    .filter((i) => i.date >= from && i.date <= today)
    .map((i) => ({
      id: i.id,
      name: i.name,
      place: i.foundPlace || i.storage,
      storage: i.storage,
      day: i.date,
      category: i.category,
      date_label: i.dateLabel,
    }));
  const specific = family.length > 0;
  const familyValues = specific
    ? Prisma.sql`ARRAY[${Prisma.join(family)}]::text[]`
    : Prisma.sql`ARRAY[]::text[]`;
  const values = terms.length
    ? Prisma.sql`ARRAY[${Prisma.join(terms)}]::text[]`
    : Prisma.sql`ARRAY[]::text[]`;
  return db.$queryRaw<SuggestedItem[]>`
    WITH candidates AS (
      SELECT id::text, name, '회원' AS source, found_label AS place, storage_place AS storage,
        to_char(found_at AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD') AS day, '습득일' AS date_label,
        category::text AS category, app_category, coalesce(public_features,'') AS features,
        6371000 * 2 * asin(sqrt(least(1.0,power(sin(radians(lat::float8-${Number(report.lat)})/2),2) +
          cos(radians(${Number(report.lat)}))*cos(radians(lat::float8))*power(sin(radians(lng::float8-${Number(report.lng)})/2),2)))) AS metres
      FROM found_items WHERE NOT archived AND status='AVAILABLE' AND keeper_id<>${report.userId}::uuid
        AND found_at BETWEEN ${cutoff} AND CURRENT_TIMESTAMP
      UNION ALL
      SELECT id,name,source,storage,storage,day,'습득일',category,NULL,'',NULL
      FROM verified_portal_items WHERE stored AND day BETWEEN ${from} AND ${today}
      UNION ALL
      SELECT id,name,'한성대',place,storage,day,date_label,category,NULL,'',NULL
      FROM jsonb_to_recordset(${JSON.stringify(schoolRows)}::jsonb)
        AS school(id text,name text,place text,storage text,day text,category text,date_label text)
    ), ranked AS (
      SELECT *, replace(lower(name),' ','') AS compact_name,
        (SELECT count(*) FROM unnest(${values}) AS t(word)
         WHERE strpos(replace(lower(name || ' ' || features),' ',''),t.word)>0) AS hits,
        (${placeKey.length >= 2} AND strpos(replace(lower(place || ' ' || storage),' ',''),${placeKey})>0) AS same_place
      FROM candidates
    )
    SELECT id,name,source,place,day,date_label AS "dateLabel" FROM ranked
    WHERE (hits>0 AND (NOT ${specific} OR EXISTS (SELECT 1 FROM unnest(${familyValues}) AS f(word) WHERE strpos(compact_name,f.word)>0))) OR compact_name=${name}
       OR (app_category=${report.category} AND ${['KEY', 'ID', 'WALLET', 'BAG'].includes(report.category)})
       OR (category='ELECTRONICS' AND ${report.category === 'ELECTRONICS' && !specific && !words.length})
    ORDER BY (same_place OR coalesce(metres<=3000,false)) DESC,
      (compact_name=${name}) DESC,hits DESC,day DESC,metres ASC NULLS LAST,id
    LIMIT 10`;
}
