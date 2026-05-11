// Bulgarian administrative gazetteer — 28 oblasts plus a representative sample of municipalities.
// Canonical IDs follow `geo:bg-oblast-<slug>` and `geo:bg-municipality-<slug>` conventions
// (data-model §1.6). The sample below is sufficient for tests and the most-cited municipalities;
// the file can be extended without code changes.

export interface OblastEntry {
  id: string;
  labelBg: string;
  labelEn: string;
  iso3166_2: string; // e.g. "BG-22" (Sofia-grad)
  aliases: string[];
}

export interface MunicipalityEntry {
  id: string;
  labelBg: string;
  labelEn: string;
  oblastId: string;
  aliases: string[];
}

export const OBLASTS: OblastEntry[] = [
  {
    id: 'geo:bg-oblast-sofia-grad',
    labelBg: 'София (град)',
    labelEn: 'Sofia (city)',
    iso3166_2: 'BG-22',
    aliases: ['София-град'],
  },
  {
    id: 'geo:bg-oblast-sofia',
    labelBg: 'София',
    labelEn: 'Sofia Province',
    iso3166_2: 'BG-23',
    aliases: [],
  },
  {
    id: 'geo:bg-oblast-blagoevgrad',
    labelBg: 'Благоевград',
    labelEn: 'Blagoevgrad',
    iso3166_2: 'BG-01',
    aliases: [],
  },
  {
    id: 'geo:bg-oblast-burgas',
    labelBg: 'Бургас',
    labelEn: 'Burgas',
    iso3166_2: 'BG-02',
    aliases: [],
  },
  {
    id: 'geo:bg-oblast-varna',
    labelBg: 'Варна',
    labelEn: 'Varna',
    iso3166_2: 'BG-03',
    aliases: [],
  },
  {
    id: 'geo:bg-oblast-veliko-tarnovo',
    labelBg: 'Велико Търново',
    labelEn: 'Veliko Tarnovo',
    iso3166_2: 'BG-04',
    aliases: [],
  },
  {
    id: 'geo:bg-oblast-vidin',
    labelBg: 'Видин',
    labelEn: 'Vidin',
    iso3166_2: 'BG-05',
    aliases: [],
  },
  {
    id: 'geo:bg-oblast-vratsa',
    labelBg: 'Враца',
    labelEn: 'Vratsa',
    iso3166_2: 'BG-06',
    aliases: [],
  },
  {
    id: 'geo:bg-oblast-gabrovo',
    labelBg: 'Габрово',
    labelEn: 'Gabrovo',
    iso3166_2: 'BG-07',
    aliases: [],
  },
  {
    id: 'geo:bg-oblast-dobrich',
    labelBg: 'Добрич',
    labelEn: 'Dobrich',
    iso3166_2: 'BG-08',
    aliases: [],
  },
  {
    id: 'geo:bg-oblast-kardzhali',
    labelBg: 'Кърджали',
    labelEn: 'Kardzhali',
    iso3166_2: 'BG-09',
    aliases: [],
  },
  {
    id: 'geo:bg-oblast-kyustendil',
    labelBg: 'Кюстендил',
    labelEn: 'Kyustendil',
    iso3166_2: 'BG-10',
    aliases: [],
  },
  {
    id: 'geo:bg-oblast-lovech',
    labelBg: 'Ловеч',
    labelEn: 'Lovech',
    iso3166_2: 'BG-11',
    aliases: [],
  },
  {
    id: 'geo:bg-oblast-montana',
    labelBg: 'Монтана',
    labelEn: 'Montana',
    iso3166_2: 'BG-12',
    aliases: [],
  },
  {
    id: 'geo:bg-oblast-pazardzhik',
    labelBg: 'Пазарджик',
    labelEn: 'Pazardzhik',
    iso3166_2: 'BG-13',
    aliases: [],
  },
  {
    id: 'geo:bg-oblast-pernik',
    labelBg: 'Перник',
    labelEn: 'Pernik',
    iso3166_2: 'BG-14',
    aliases: [],
  },
  {
    id: 'geo:bg-oblast-pleven',
    labelBg: 'Плевен',
    labelEn: 'Pleven',
    iso3166_2: 'BG-15',
    aliases: [],
  },
  {
    id: 'geo:bg-oblast-plovdiv',
    labelBg: 'Пловдив',
    labelEn: 'Plovdiv',
    iso3166_2: 'BG-16',
    aliases: [],
  },
  {
    id: 'geo:bg-oblast-razgrad',
    labelBg: 'Разград',
    labelEn: 'Razgrad',
    iso3166_2: 'BG-17',
    aliases: [],
  },
  { id: 'geo:bg-oblast-ruse', labelBg: 'Русе', labelEn: 'Ruse', iso3166_2: 'BG-18', aliases: [] },
  {
    id: 'geo:bg-oblast-silistra',
    labelBg: 'Силистра',
    labelEn: 'Silistra',
    iso3166_2: 'BG-19',
    aliases: [],
  },
  {
    id: 'geo:bg-oblast-sliven',
    labelBg: 'Сливен',
    labelEn: 'Sliven',
    iso3166_2: 'BG-20',
    aliases: [],
  },
  {
    id: 'geo:bg-oblast-smolyan',
    labelBg: 'Смолян',
    labelEn: 'Smolyan',
    iso3166_2: 'BG-21',
    aliases: [],
  },
  {
    id: 'geo:bg-oblast-stara-zagora',
    labelBg: 'Стара Загора',
    labelEn: 'Stara Zagora',
    iso3166_2: 'BG-24',
    aliases: [],
  },
  {
    id: 'geo:bg-oblast-targovishte',
    labelBg: 'Търговище',
    labelEn: 'Targovishte',
    iso3166_2: 'BG-25',
    aliases: [],
  },
  {
    id: 'geo:bg-oblast-haskovo',
    labelBg: 'Хасково',
    labelEn: 'Haskovo',
    iso3166_2: 'BG-26',
    aliases: [],
  },
  {
    id: 'geo:bg-oblast-shumen',
    labelBg: 'Шумен',
    labelEn: 'Shumen',
    iso3166_2: 'BG-27',
    aliases: [],
  },
  {
    id: 'geo:bg-oblast-yambol',
    labelBg: 'Ямбол',
    labelEn: 'Yambol',
    iso3166_2: 'BG-28',
    aliases: [],
  },
];

export const MUNICIPALITIES: MunicipalityEntry[] = [
  {
    id: 'geo:bg-municipality-sofia',
    labelBg: 'Столична община',
    labelEn: 'Sofia Municipality',
    oblastId: 'geo:bg-oblast-sofia-grad',
    aliases: ['Община София', 'София'],
  },
  {
    id: 'geo:bg-municipality-plovdiv',
    labelBg: 'Община Пловдив',
    labelEn: 'Plovdiv Municipality',
    oblastId: 'geo:bg-oblast-plovdiv',
    aliases: ['Пловдив'],
  },
  {
    id: 'geo:bg-municipality-varna',
    labelBg: 'Община Варна',
    labelEn: 'Varna Municipality',
    oblastId: 'geo:bg-oblast-varna',
    aliases: ['Варна'],
  },
  {
    id: 'geo:bg-municipality-burgas',
    labelBg: 'Община Бургас',
    labelEn: 'Burgas Municipality',
    oblastId: 'geo:bg-oblast-burgas',
    aliases: ['Бургас'],
  },
  {
    id: 'geo:bg-municipality-ruse',
    labelBg: 'Община Русе',
    labelEn: 'Ruse Municipality',
    oblastId: 'geo:bg-oblast-ruse',
    aliases: ['Русе'],
  },
  {
    id: 'geo:bg-municipality-stara-zagora',
    labelBg: 'Община Стара Загора',
    labelEn: 'Stara Zagora Municipality',
    oblastId: 'geo:bg-oblast-stara-zagora',
    aliases: ['Стара Загора'],
  },
];

export interface GazetteerLookupResult {
  id: string;
  labelBg: string;
  labelEn: string;
  kind: 'oblast' | 'municipality';
  matchType: 'canonical' | 'alias';
  attributes: Record<string, unknown>;
}

const NORMALIZED: Array<{ pattern: string; entry: GazetteerLookupResult }> = (() => {
  const out: Array<{ pattern: string; entry: GazetteerLookupResult }> = [];
  for (const o of OBLASTS) {
    out.push({
      pattern: o.labelBg.toLowerCase(),
      entry: {
        id: o.id,
        labelBg: o.labelBg,
        labelEn: o.labelEn,
        kind: 'oblast',
        matchType: 'canonical',
        attributes: { iso3166_2: o.iso3166_2 },
      },
    });
    for (const alias of o.aliases) {
      out.push({
        pattern: alias.toLowerCase(),
        entry: {
          id: o.id,
          labelBg: o.labelBg,
          labelEn: o.labelEn,
          kind: 'oblast',
          matchType: 'alias',
          attributes: { iso3166_2: o.iso3166_2 },
        },
      });
    }
  }
  for (const m of MUNICIPALITIES) {
    out.push({
      pattern: m.labelBg.toLowerCase(),
      entry: {
        id: m.id,
        labelBg: m.labelBg,
        labelEn: m.labelEn,
        kind: 'municipality',
        matchType: 'canonical',
        attributes: { oblastId: m.oblastId },
      },
    });
    for (const alias of m.aliases) {
      out.push({
        pattern: alias.toLowerCase(),
        entry: {
          id: m.id,
          labelBg: m.labelBg,
          labelEn: m.labelEn,
          kind: 'municipality',
          matchType: 'alias',
          attributes: { oblastId: m.oblastId },
        },
      });
    }
  }
  out.sort((a, b) => b.pattern.length - a.pattern.length);
  return out;
})();

export function findGazetteerMatches(text: string): GazetteerLookupResult[] {
  const lower = text.toLowerCase();
  const seen = new Set<string>();
  const out: GazetteerLookupResult[] = [];
  for (const { pattern, entry } of NORMALIZED) {
    if (lower.includes(pattern) && !seen.has(entry.id)) {
      seen.add(entry.id);
      out.push(entry);
    }
  }
  return out;
}
