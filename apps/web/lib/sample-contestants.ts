import { avatarUrl } from '@tally/contracts';

/**
 * Invented contestants for trying the system out (F27). Every name here is made up, and nothing
 * is fetched: CLAUDE.md rules out real people in demo data. Avatars are generated illustrations.
 */
const NAMES = [
  'Wren Castellane',
  'Oriel Maddox',
  'Kestrel Vane',
  'Linnea Brask',
  'Tobiah Quell',
  'Sable Okonkwo-Reyes',
  'Idris Fallowmere',
  'Maren Solberg-Aoki',
  'Cassius Threnody',
  'Nell Ardent',
  'Ottoline Varga',
  'Ruari Penhallow',
  'Isaura Delacroix-Mbeki',
  'Fennick Harrowgate',
  'Talitha Moreau',
  'Emrys Calloway',
  'Zuzana Kettleby',
  'Anselm Rook',
  'Priya Wintermoor',
  'Leander Voskuijlen',
  'Odessa Brightwater',
  'Caspian Hollis-Nakamura',
  'Marisol Everdeane',
  'Thaddeus Lark',
  'Yara Stonebridge',
  'Bastien Ollerenshaw',
  'Ingrid Salcombe',
  'Ravi Tenterden',
  'Ximena Coldharbour',
  'Florian Ashgrove',
  'Delphine Quarrie',
  'Kofi Wetherell',
  'Soraya Blackthorn',
  'Hollis Trevanion',
  'Annika Lindqvist-Obi',
  'Mateo Kingsbarrow',
  'Elowen Ferrars',
  'Juniper Castlemaine',
  'Aurelio Penrose',
  'Saskia Wendover',
];

/** Countries with a flag emoji and a name in every browser (ISO 3166-1 alpha-2). */
const COUNTRIES = [
  'AR',
  'AU',
  'BR',
  'CA',
  'CL',
  'CO',
  'DE',
  'DK',
  'EG',
  'ES',
  'ET',
  'FI',
  'FR',
  'GB',
  'GH',
  'IE',
  'IN',
  'IS',
  'IT',
  'JP',
  'KE',
  'KR',
  'MA',
  'MX',
  'NG',
  'NL',
  'NO',
  'NZ',
  'PH',
  'PL',
  'PT',
  'SE',
  'SN',
  'TR',
  'UA',
  'US',
  'VN',
  'ZA',
];

export type SampleContestant = {
  code: string;
  name: string;
  imageUrl: string;
  accentFrom: string;
  accentTo: string;
  countryCode: string;
};

/** The first letter of the contest's name ("Spring Heats" gets S1, S2, …); C if it has none. */
export function codePrefix(contestName: string) {
  return contestName.toUpperCase().match(/[A-Z]/)?.[0] ?? 'C';
}

/** `#RRGGBB` for a hue (degrees), saturation and lightness (0–1). */
export function hslToHex(h: number, s: number, l: number) {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

function shuffled<T>(items: readonly T[], random: () => number) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/**
 * `count` invented contestants for a contest. Codes follow the contest's initial and skip codes
 * already taken; names skip ones already in the contest. Accent hues are spread evenly around
 * the colour wheel from a random start, so bars and cards stay easy to tell apart, and each
 * gradient runs from a lighter to a deeper, slightly shifted hue, like the seed's.
 */
export function sampleContestants(opts: {
  contestName: string;
  takenCodes?: Iterable<string>;
  takenNames?: Iterable<string>;
  count?: number;
  random?: () => number;
}): SampleContestant[] {
  const { contestName, count = 7, random = Math.random } = opts;
  const takenCodes = new Set(opts.takenCodes);
  const takenNames = new Set([...(opts.takenNames ?? [])].map((n) => n.toLowerCase()));

  const prefix = codePrefix(contestName);
  const codes: string[] = [];
  for (let n = 1; codes.length < count; n++) {
    if (!takenCodes.has(`${prefix}${n}`)) codes.push(`${prefix}${n}`);
  }
  const names = shuffled(
    NAMES.filter((n) => !takenNames.has(n.toLowerCase())),
    random,
  ).slice(0, count);
  const countries = shuffled(COUNTRIES, random);
  const start = random() * 360;

  return names.map((name, i) => {
    const hue = (start + (i * 360) / names.length) % 360;
    return {
      code: codes[i] as string,
      name,
      imageUrl: avatarUrl(name),
      accentFrom: hslToHex(hue, 0.85, 0.6),
      accentTo: hslToHex((hue + 28) % 360, 0.75, 0.42),
      countryCode: countries[i % countries.length] as string,
    };
  });
}
