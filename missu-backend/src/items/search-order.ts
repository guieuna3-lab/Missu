import { Prisma } from '../generated/prisma/client';
import { likeLiteral, type ItemSearch } from './item-search';

export type RankedKey = { id: string; score: number; day: string };
export const compactName = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s()·-]/gu, '');

// 검색에 쓰는 동의어·세부 품목 목록을 그대로 점수에도 사용합니다.
// 전체 일치 > 같은 품목명 > 문구 일치 > 이름의 단어 일치 > 공개 특징 일치.
export function relevanceScore(
  name: string,
  features: string,
  search: ItemSearch,
) {
  const title = compactName(name),
    extra = compactName(features);
  const whole = compactName(search.q);
  if (!whole) return 0;
  if (title === whole) return 1000;
  if (
    search.terms.length === 1 &&
    search.terms[0].some((v) => title === compactName(v))
  )
    return 960;
  if (title.startsWith(whole)) return 920;
  if (title.includes(whole)) return 900;
  const hits = search.terms.filter((g) =>
    g.some((v) => title.includes(compactName(v))),
  ).length;
  const extraHits = search.terms.filter((g) =>
    g.some((v) => extra.includes(compactName(v))),
  ).length;
  return Math.floor(
    (800 * hits + 100 * extraHits) / Math.max(1, search.terms.length),
  );
}
export function compareRank(a: RankedKey, b: RankedKey) {
  return (
    b.score - a.score ||
    b.day.localeCompare(a.day) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}
export const andSql = (parts: Prisma.Sql[]) =>
  parts.length
    ? Prisma.sql`(${Prisma.join(parts, ' AND ')})`
    : Prisma.sql`TRUE`;
const orSql = (parts: Prisma.Sql[]) =>
  parts.length
    ? Prisma.sql`(${Prisma.join(parts, ' OR ')})`
    : Prisma.sql`FALSE`;
const contains = (column: Prisma.Sql, word: string) =>
  Prisma.sql`${column} ILIKE ${'%' + likeLiteral(word) + '%'}`;
export const normalizedSql = (column: Prisma.Sql) =>
  Prisma.sql`regexp_replace(lower(normalize(coalesce(${column}, ''), NFKC)), '[[:space:]()·-]', '', 'g')`;

/** DB 전체 검색 후보를 제한 전에 정렬합니다. 사용자 입력은 모두 매개변수로 전달합니다. */
export function relevanceSql(
  name: Prisma.Sql,
  features: Prisma.Sql,
  search: ItemSearch,
  alreadyNormalized = false,
) {
  const title = alreadyNormalized ? name : normalizedSql(name),
    extra = alreadyNormalized ? features : normalizedSql(features),
    whole = compactName(search.q);
  if (!whole) return Prisma.sql`0`;
  // 이미 소문자로 정규화한 문자열입니다. 수만 건에서 ILIKE의 대소문자
  // 변환을 단어마다 반복하지 않고, JS includes와 같은 부분 문자열 비교를 합니다.
  const includes = (column: Prisma.Sql, word: string) =>
    Prisma.sql`strpos(${column}, ${compactName(word)}) > 0`;
  const nameHits = search.terms.map(
    (g) =>
      Prisma.sql`CASE WHEN ${orSql(g.map((v) => includes(title, v)))} THEN 1 ELSE 0 END`,
  );
  const extraHits = search.terms.map(
    (g) =>
      Prisma.sql`CASE WHEN ${orSql(g.map((v) => includes(extra, v)))} THEN 1 ELSE 0 END`,
  );
  const alias =
    search.terms.length === 1
      ? orSql(
          search.terms[0].map((v) => Prisma.sql`${title} = ${compactName(v)}`),
        )
      : Prisma.sql`FALSE`;
  return Prisma.sql`CASE
    WHEN ${title} = ${whole} THEN 1000
    WHEN ${alias} THEN 960
    WHEN ${title} LIKE ${likeLiteral(whole) + '%'} THEN 920
    WHEN ${includes(title, whole)} THEN 900
    ELSE (800 * (${Prisma.join(nameHits.length ? nameHits : [Prisma.sql`0`], ' + ')})
      + 100 * (${Prisma.join(extraHits.length ? extraHits : [Prisma.sql`0`], ' + ')})) / ${Math.max(1, search.terms.length)}
    END`;
}

/** 기존 공개 검색과 동일한 단어·기종·액세서리 제외 조건. */
export function searchWhereSql(search: ItemSearch, portal: boolean) {
  const name = Prisma.sql`name`;
  const extra = portal ? Prisma.sql`kind_name` : Prisma.sql`public_features`;
  const terms = search.terms.map((group) => {
    if (!portal)
      return orSql(
        group.flatMap((word) => [contains(name, word), contains(extra, word)]),
      );
    const short: string[] = [];
    const options: Prisma.Sql[] = [];
    for (const word of group) {
      const indexed = /^[가-힣a-z0-9 ]+$/u.test(word);
      if (indexed && word.length <= 3) short.push(word);
      else
        options.push(
          andSql([
            ...(indexed
              ? [
                  Prisma.sql`search_fragments @> ARRAY[${word.slice(0, 3)}]::text[]`,
                ]
              : []),
            orSql([contains(name, word), contains(extra, word)]),
          ]),
        );
    }
    if (short.length)
      options.push(
        Prisma.sql`search_fragments && ARRAY[${Prisma.join(short)}]::text[]`,
      );
    return orSql(options);
  });
  if (search.brand)
    terms.push(
      orSql([
        orSql(search.brand.map((word) => contains(name, word))),
        andSql(
          search.otherBrand.map(
            (word) => Prisma.sql`NOT (${contains(name, word)})`,
          ),
        ),
      ]),
    );
  for (const word of search.excludedEndings)
    terms.push(Prisma.sql`name NOT ILIKE ${'%' + likeLiteral(word)}`);
  if (search.place) {
    if (portal)
      terms.push(
        orSql([
          contains(
            Prisma.sql`place_key`,
            search.place.replace(/[\s()]/gu, '').toLowerCase(),
          ),
          contains(Prisma.sql`found_place`, search.place),
        ]),
      );
    else {
      const places = [
        ...new Set([
          search.place,
          search.place.replace(/^(.+역)\s+(.+선)$/u, '$1($2)'),
        ]),
      ];
      terms.push(
        orSql(
          places.flatMap((place) => [
            contains(Prisma.sql`found_label`, place),
            contains(Prisma.sql`storage_place`, place),
          ]),
        ),
      );
    }
  }
  return andSql(terms);
}
export function afterSql(after?: RankedKey) {
  if (!after) return Prisma.sql`TRUE`;
  return Prisma.sql`(score < ${after.score} OR
    (score = ${after.score} AND day < ${after.day}) OR
    (score = ${after.score} AND day = ${after.day} AND id COLLATE "C" > ${after.id}))`;
}
