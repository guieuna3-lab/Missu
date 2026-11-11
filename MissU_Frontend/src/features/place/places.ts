// Example places for the 09 place picker. Figma shows exactly these two pins; the map and
// place-search provider is still undecided with the 10 nearby owner (figma-review D10), so
// there is no API call here yet. Pin positions are in the 390×208 design map.
export type PlaceOption = {
  id: string;
  name: string;
  description: string;
  icon: 'book' | 'bus';
  pin: { x: number; y: number };
};

export const placeOptions: PlaceOption[] = [
  {
    id: 'central-library',
    name: '중앙도서관',
    description: '본관 · 3층 열람실',
    icon: 'book',
    pin: { x: 207, y: 96 },
  },
  {
    id: 'central-station',
    name: '중앙역',
    description: '역사 · 2번 출구',
    icon: 'bus',
    pin: { x: 110, y: 140 },
  },
];

/** Name/description search; an empty query lists the places around the map. */
export function searchPlaces(query: string) {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return placeOptions;
  return placeOptions.filter((p) => `${p.name} ${p.description}`.toLocaleLowerCase().includes(q));
}
