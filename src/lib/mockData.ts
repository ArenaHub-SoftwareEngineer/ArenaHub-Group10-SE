import {
  College,
  Team,
  Tournament,
  Match,
  GameTitle,
  User,
  ContentReport,
  AuditLogItem,
  SchoolSettings,
  ChatMessage
} from './types';

import mlbbBanner from '../assets/images/mlbb_real_banner.webp';
import valorantBanner from '../assets/images/valorant_real_banner.jpg';
import lolBanner from '../assets/images/lol_real_banner.jpg';
import gymStageBg from '../assets/images/wmsu_gym_bg_1791620796788.jpg';

export { mlbbBanner, valorantBanner, lolBanner, gymStageBg };

export const INITIAL_SCHOOL_SETTINGS: SchoolSettings = {
  schoolName: 'Western Mindanao State University',
  schoolCode: 'WMSU',
  domain: 'wmsu.edu.ph',
  brandAccent: '#F27A37',
  adminAccent: '#0075DE',
  palaroYear: 2026,
};

export const INITIAL_COLLEGES: College[] = [
  {
    id: 'col-ccs',
    code: 'CCS',
    name: 'College of Computing Studies',
    dean: 'Dr. Roderick Go',
    color: '#3B82F6',
    teamsCount: 3,
    stats: { wins: 1, losses: 0, gameWins: 2, gameLosses: 0, status: 'Upper SF' },
  },
  {
    id: 'col-coe',
    code: 'COE',
    name: 'College of Engineering',
    dean: 'Engr. Roberto Santos',
    color: '#EF4444',
    teamsCount: 3,
    stats: { wins: 1, losses: 0, gameWins: 2, gameLosses: 1, status: 'Upper SF' },
  },
  {
    id: 'col-cn',
    code: 'CN',
    name: 'College of Nursing',
    dean: 'Prof. Mary Ann Ramos',
    color: '#10B981',
    teamsCount: 2,
    stats: { wins: 1, losses: 0, gameWins: 2, gameLosses: 1, status: 'Upper SF' },
  },
  {
    id: 'col-ccje',
    code: 'CCJE',
    name: 'College of Criminal Justice Education',
    dean: 'Major Leo Alvarez',
    color: '#F59E0B',
    teamsCount: 2,
    stats: { wins: 1, losses: 0, gameWins: 2, gameLosses: 0, status: 'Upper SF' },
  },
  {
    id: 'col-cl',
    code: 'CL',
    name: 'College of Law',
    dean: 'Atty. Cristina Torres',
    color: '#8B5CF6',
    teamsCount: 2,
    stats: { wins: 1, losses: 1, gameWins: 3, gameLosses: 2, status: 'Lower R2' },
  },
  {
    id: 'col-ca',
    code: 'CA',
    name: 'College of Architecture',
    dean: 'Arch. Vincent Lim',
    color: '#EC4899',
    teamsCount: 2,
    stats: { wins: 1, losses: 1, gameWins: 3, gameLosses: 3, status: 'Lower R2' },
  },
  {
    id: 'col-cla',
    code: 'CLA',
    name: 'College of Liberal Arts',
    dean: 'Dr. Maria Elena Perez',
    color: '#6366F1',
    teamsCount: 2,
    stats: { wins: 0, losses: 2, gameWins: 1, gameLosses: 4, status: 'Eliminated' },
  },
  {
    id: 'col-ced',
    code: 'CED',
    name: 'College of Education',
    dean: 'Dr. Manuel Bautista',
    color: '#14B8A6',
    teamsCount: 2,
    stats: { wins: 0, losses: 2, gameWins: 0, gameLosses: 4, status: 'Eliminated' },
  },
];

const SAMPLE_TEAMS: Team[] = [
  {
    "id": "team-ccs-alpha",
    "name": "CCS Alpha",
    "collegeId": "col-ccs",
    "collegeCode": "CCS",
    "gameId": "game-mlbb",
    "seed": 1,
    "winRate": 0.88,
    "record": "9-2",
    "players": [
      {
        "id": "p1",
        "name": "Riley Rust",
        "ign": "Riley",
        "role": "Jungler",
        "collegeId": "col-ccs",
        "studentId": "2023-01824",
        "isVerified": true,
        "rank": "Mythical Immortal 128★",
        "signatureHero": "Ling / Hayabusa",
        "stats": {
          "kda": "8.4",
          "winRate": "88%",
          "matchesPlayed": 11,
          "record": "9W - 2L",
          "totalKills": 82,
          "totalDeaths": 18,
          "totalAssists": 69,
          "palaroAppearances": 3
        }
      },
      {
        "id": "p2",
        "name": "Kurt Alonzo",
        "ign": "Kurt",
        "role": "EXP Lane",
        "collegeId": "col-ccs",
        "studentId": "2023-01991",
        "isVerified": true,
        "rank": "Mythical Glory 74★",
        "signatureHero": "Paquito / Arlott",
        "stats": {
          "kda": "5.2",
          "winRate": "84%",
          "matchesPlayed": 11,
          "record": "9W - 2L",
          "totalKills": 45,
          "totalDeaths": 22,
          "totalAssists": 70,
          "palaroAppearances": 2
        }
      },
      {
        "id": "p3",
        "name": "Rasheed Tan",
        "ign": "Rasheed",
        "role": "Gold Lane",
        "collegeId": "col-ccs",
        "studentId": "2022-00412",
        "isVerified": true,
        "rank": "Mythical Immortal 105★",
        "signatureHero": "Beatrix / Claude",
        "stats": {
          "kda": "7.1",
          "winRate": "86%",
          "matchesPlayed": 11,
          "record": "9W - 2L",
          "totalKills": 71,
          "totalDeaths": 20,
          "totalAssists": 71,
          "palaroAppearances": 3
        }
      },
      {
        "id": "p4",
        "name": "Kerr Uy",
        "ign": "Kerr",
        "role": "Mid Lane",
        "collegeId": "col-ccs",
        "studentId": "2024-00109",
        "isVerified": true,
        "rank": "Mythical Glory 62★",
        "signatureHero": "Yve / Pharsa",
        "stats": {
          "kda": "6.0",
          "winRate": "80%",
          "matchesPlayed": 11,
          "record": "9W - 2L",
          "totalKills": 38,
          "totalDeaths": 19,
          "totalAssists": 76,
          "palaroAppearances": 1
        }
      },
      {
        "id": "p5",
        "name": "Raytheon Delos Reyes",
        "ign": "Raytheon",
        "role": "Roamer",
        "collegeId": "col-ccs",
        "studentId": "2023-03310",
        "isVerified": true,
        "rank": "Mythical Glory 68★",
        "signatureHero": "Chou / Minotaur",
        "stats": {
          "kda": "4.9",
          "winRate": "82%",
          "matchesPlayed": 11,
          "record": "9W - 2L",
          "totalKills": 16,
          "totalDeaths": 24,
          "totalAssists": 102,
          "palaroAppearances": 2
        }
      }
    ]
  },
  {
    "id": "team-coe-titans",
    "name": "COE Titans",
    "collegeId": "col-coe",
    "collegeCode": "COE",
    "gameId": "game-mlbb",
    "seed": 2,
    "winRate": 0.82,
    "record": "8-3",
    "players": [
      {
        "id": "p6",
        "name": "Bolt Alvarez",
        "ign": "Bolt",
        "role": "Jungler",
        "collegeId": "col-coe",
        "studentId": "2022-02194",
        "isVerified": true,
        "rank": "Mythical Immortal 115★",
        "signatureHero": "Fanny / Nolan",
        "stats": {
          "kda": "7.8",
          "winRate": "82%",
          "matchesPlayed": 11,
          "record": "8W - 3L",
          "totalKills": 74,
          "totalDeaths": 21,
          "totalAssists": 65,
          "palaroAppearances": 2
        }
      },
      {
        "id": "p7",
        "name": "Arch Ramos",
        "ign": "Arch",
        "role": "EXP Lane",
        "collegeId": "col-coe",
        "studentId": "2021-01045",
        "isVerified": true,
        "rank": "Mythical Glory 80★",
        "signatureHero": "Terizla / Yu Zhong",
        "stats": {
          "kda": "4.6",
          "winRate": "79%",
          "matchesPlayed": 11,
          "record": "8W - 3L",
          "totalKills": 38,
          "totalDeaths": 25,
          "totalAssists": 68,
          "palaroAppearances": 3
        }
      },
      {
        "id": "p8",
        "name": "Sparky Lim",
        "ign": "Sparky",
        "role": "Gold Lane",
        "collegeId": "col-coe",
        "studentId": "2023-04012",
        "isVerified": true,
        "rank": "Mythical Glory 91★",
        "signatureHero": "Brody / Harith",
        "stats": {
          "kda": "6.5",
          "winRate": "80%",
          "matchesPlayed": 11,
          "record": "8W - 3L",
          "totalKills": 65,
          "totalDeaths": 22,
          "totalAssists": 60,
          "palaroAppearances": 2
        }
      },
      {
        "id": "p9",
        "name": "Gear Santos",
        "ign": "Gear",
        "role": "Mid Lane",
        "collegeId": "col-coe",
        "studentId": "2024-00812",
        "isVerified": true,
        "rank": "Mythic Honor 42★",
        "signatureHero": "Valentina / Faramis",
        "stats": {
          "kda": "5.1",
          "winRate": "75%",
          "matchesPlayed": 11,
          "record": "8W - 3L",
          "totalKills": 30,
          "totalDeaths": 20,
          "totalAssists": 80,
          "palaroAppearances": 1
        }
      },
      {
        "id": "p10",
        "name": "Ironman Cruz",
        "ign": "Ironman",
        "role": "Roamer",
        "collegeId": "col-coe",
        "studentId": "2022-03119",
        "isVerified": true,
        "rank": "Mythical Glory 72★",
        "signatureHero": "Tigreal / Grock",
        "stats": {
          "kda": "3.9",
          "winRate": "78%",
          "matchesPlayed": 11,
          "record": "8W - 3L",
          "totalKills": 12,
          "totalDeaths": 28,
          "totalAssists": 95,
          "palaroAppearances": 2
        }
      }
    ]
  },
  {
    "id": "team-cn-lifeline",
    "name": "CN Lifeline",
    "collegeId": "col-cn",
    "collegeCode": "CN",
    "gameId": "game-mlbb",
    "seed": 3,
    "winRate": 0.73,
    "record": "7-4",
    "players": [
      {
        "id": "p11",
        "name": "Mercy David",
        "ign": "Mercy",
        "role": "Roamer",
        "collegeId": "col-cn",
        "studentId": "2022-01990",
        "isVerified": true,
        "rank": "Mythical Glory 85★",
        "signatureHero": "Angela / Rafaela",
        "stats": {
          "kda": "6.2",
          "winRate": "75%",
          "matchesPlayed": 11,
          "record": "7W - 4L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "p12",
        "name": "Pulse Gomez",
        "ign": "Pulse",
        "role": "Jungler",
        "collegeId": "col-cn",
        "studentId": "2023-01123",
        "isVerified": true,
        "rank": "Mythical Glory 68★",
        "signatureHero": "Lancelot / Hayabusa",
        "stats": {
          "kda": "6.9",
          "winRate": "72%",
          "matchesPlayed": 11,
          "record": "7W - 4L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "p13",
        "name": "Healer Chen",
        "ign": "Healer",
        "role": "Mid Lane",
        "collegeId": "col-cn",
        "studentId": "2024-00344",
        "isVerified": true,
        "rank": "Mythic Honor 38★",
        "signatureHero": "Novaria / Cecilion",
        "stats": {
          "kda": "5.4",
          "winRate": "70%",
          "matchesPlayed": 11,
          "record": "7W - 4L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "p14",
        "name": "Suture Tan",
        "ign": "Suture",
        "role": "EXP Lane",
        "collegeId": "col-cn",
        "studentId": "2021-00812",
        "isVerified": true,
        "rank": "Mythic Honor 45★",
        "signatureHero": "Benedetta / Thamuz",
        "stats": {
          "kda": "4.8",
          "winRate": "71%",
          "matchesPlayed": 11,
          "record": "7W - 4L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "p15",
        "name": "Remedy Ong",
        "ign": "Remedy",
        "role": "Gold Lane",
        "collegeId": "col-cn",
        "studentId": "2023-02190",
        "isVerified": true,
        "rank": "Mythical Glory 55★",
        "signatureHero": "Irithel / Moskov",
        "stats": {
          "kda": "5.8",
          "winRate": "73%",
          "matchesPlayed": 11,
          "record": "7W - 4L",
          "palaroAppearances": 2
        }
      }
    ]
  },
  {
    "id": "team-ccje-wardens",
    "name": "CCJE Wardens",
    "collegeId": "col-ccje",
    "collegeCode": "CCJE",
    "gameId": "game-mlbb",
    "seed": 4,
    "winRate": 0.7,
    "record": "7-4",
    "players": [
      {
        "id": "p16",
        "name": "Baton Torres",
        "ign": "Baton",
        "role": "EXP Lane",
        "collegeId": "col-ccje",
        "studentId": "2022-01441",
        "isVerified": true,
        "rank": "Mythical Glory 77★",
        "signatureHero": "Chou / Dyrroth",
        "stats": {
          "kda": "5.0",
          "winRate": "70%",
          "matchesPlayed": 11,
          "record": "7W - 4L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "p17",
        "name": "Enforce Diaz",
        "ign": "Enforce",
        "role": "Jungler",
        "collegeId": "col-ccje",
        "studentId": "2023-00912",
        "isVerified": true,
        "rank": "Mythical Glory 82★",
        "signatureHero": "Martis / Fredrinn",
        "stats": {
          "kda": "6.4",
          "winRate": "72%",
          "matchesPlayed": 11,
          "record": "7W - 4L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "p18",
        "name": "Shield Morales",
        "ign": "Shield",
        "role": "Roamer",
        "collegeId": "col-ccje",
        "studentId": "2021-01822",
        "isVerified": true,
        "rank": "Mythic Honor 40★",
        "signatureHero": "Khufra / Atlas",
        "stats": {
          "kda": "4.2",
          "winRate": "68%",
          "matchesPlayed": 11,
          "record": "7W - 4L",
          "palaroAppearances": 3
        }
      },
      {
        "id": "p19",
        "name": "Radar Sy",
        "ign": "Radar",
        "role": "Mid Lane",
        "collegeId": "col-ccje",
        "studentId": "2024-00771",
        "isVerified": true,
        "rank": "Mythic Honor 35★",
        "signatureHero": "Xavier / Kadita",
        "stats": {
          "kda": "4.9",
          "winRate": "69%",
          "matchesPlayed": 11,
          "record": "7W - 4L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "p20",
        "name": "Sniper Yap",
        "ign": "Sniper",
        "role": "Gold Lane",
        "collegeId": "col-ccje",
        "studentId": "2023-01999",
        "isVerified": true,
        "rank": "Mythical Glory 65★",
        "signatureHero": "Lesley / Bruno",
        "stats": {
          "kda": "5.7",
          "winRate": "71%",
          "matchesPlayed": 11,
          "record": "7W - 4L",
          "palaroAppearances": 2
        }
      }
    ]
  },
  {
    "id": "team-cl-verdict",
    "name": "CL Verdict",
    "collegeId": "col-cl",
    "collegeCode": "CL",
    "gameId": "game-mlbb",
    "seed": 5,
    "winRate": 0.6,
    "record": "6-5",
    "players": [
      {
        "id": "p21",
        "name": "Gavel Tan",
        "ign": "Gavel",
        "role": "EXP Lane",
        "collegeId": "col-cl",
        "studentId": "2021-00210",
        "isVerified": true,
        "rank": "Mythical Glory 58★",
        "signatureHero": "Uranus / Esmeralda",
        "stats": {
          "kda": "4.5",
          "winRate": "60%",
          "matchesPlayed": 10,
          "record": "6W - 4L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "p22",
        "name": "Brief Lee",
        "ign": "Brief",
        "role": "Jungler",
        "collegeId": "col-cl",
        "studentId": "2022-00891",
        "isVerified": true,
        "rank": "Mythic Honor 44★",
        "signatureHero": "Baxia / Aamon",
        "stats": {
          "kda": "5.2",
          "winRate": "58%",
          "matchesPlayed": 10,
          "record": "6W - 4L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "p23",
        "name": "Justice Sy",
        "ign": "Justice",
        "role": "Mid Lane",
        "collegeId": "col-cl",
        "studentId": "2020-00101",
        "isVerified": true,
        "rank": "Mythical Glory 60★",
        "signatureHero": "Lylia / Lunox",
        "stats": {
          "kda": "5.0",
          "winRate": "62%",
          "matchesPlayed": 10,
          "record": "6W - 4L",
          "palaroAppearances": 3
        }
      },
      {
        "id": "p24",
        "name": "Counsel Go",
        "ign": "Counsel",
        "role": "Gold Lane",
        "collegeId": "col-cl",
        "studentId": "2023-01044",
        "isVerified": true,
        "rank": "Mythic 20★",
        "signatureHero": "Karrie / Wanwan",
        "stats": {
          "kda": "4.8",
          "winRate": "59%",
          "matchesPlayed": 10,
          "record": "6W - 4L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "p25",
        "name": "Bailiff Lim",
        "ign": "Bailiff",
        "role": "Roamer",
        "collegeId": "col-cl",
        "studentId": "2022-01550",
        "isVerified": true,
        "rank": "Mythic Honor 30★",
        "signatureHero": "Lolita / Akai",
        "stats": {
          "kda": "3.8",
          "winRate": "60%",
          "matchesPlayed": 10,
          "record": "6W - 4L",
          "palaroAppearances": 2
        }
      }
    ]
  },
  {
    "id": "team-ca-blueprint",
    "name": "CA Blueprint",
    "collegeId": "col-ca",
    "collegeCode": "CA",
    "gameId": "game-mlbb",
    "seed": 6,
    "winRate": 0.55,
    "record": "5-6",
    "players": [
      {
        "id": "p26",
        "name": "Draft Ortiz",
        "ign": "Draft",
        "role": "EXP Lane",
        "collegeId": "col-ca",
        "studentId": "2022-02100",
        "isVerified": true,
        "rank": "Mythic Honor 38★",
        "signatureHero": "Lapu-Lapu / Arlott",
        "stats": {
          "kda": "4.3",
          "winRate": "55%",
          "matchesPlayed": 10,
          "record": "5W - 5L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "p27",
        "name": "Grid Santos",
        "ign": "Grid",
        "role": "Jungler",
        "collegeId": "col-ca",
        "studentId": "2023-01440",
        "isVerified": true,
        "rank": "Mythic Honor 42★",
        "signatureHero": "Gusion / Helcurt",
        "stats": {
          "kda": "5.0",
          "winRate": "54%",
          "matchesPlayed": 10,
          "record": "5W - 5L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "p28",
        "name": "Pillar Cruz",
        "ign": "Pillar",
        "role": "Mid Lane",
        "collegeId": "col-ca",
        "studentId": "2021-00990",
        "isVerified": true,
        "rank": "Mythic 19★",
        "signatureHero": "Kagura / Pharsa",
        "stats": {
          "kda": "4.6",
          "winRate": "56%",
          "matchesPlayed": 10,
          "record": "5W - 5L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "p29",
        "name": "Architex Reyes",
        "ign": "Architex",
        "role": "Gold Lane",
        "collegeId": "col-ca",
        "studentId": "2024-00311",
        "isVerified": true,
        "rank": "Legend I",
        "signatureHero": "Clint / Brody",
        "stats": {
          "kda": "4.4",
          "winRate": "53%",
          "matchesPlayed": 10,
          "record": "5W - 5L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "p30",
        "name": "Facade Tan",
        "ign": "Facade",
        "role": "Roamer",
        "collegeId": "col-ca",
        "studentId": "2023-03010",
        "isVerified": true,
        "rank": "Mythic 22★",
        "signatureHero": "Franco / Ruby",
        "stats": {
          "kda": "3.6",
          "winRate": "55%",
          "matchesPlayed": 10,
          "record": "5W - 5L",
          "palaroAppearances": 1
        }
      }
    ]
  },
  {
    "id": "team-cla-sentinels-mlbb",
    "name": "CLA Sentinels",
    "collegeId": "col-cla",
    "collegeCode": "CLA",
    "gameId": "game-mlbb",
    "seed": 7,
    "winRate": 0.45,
    "record": "4-7",
    "players": [
      {
        "id": "p31",
        "name": "Poet Garcia",
        "ign": "Poet",
        "role": "EXP Lane",
        "collegeId": "col-cla",
        "studentId": "2022-03100",
        "isVerified": true,
        "rank": "Mythic 15★",
        "signatureHero": "Gloo / Edith",
        "stats": {
          "kda": "3.9",
          "winRate": "45%",
          "matchesPlayed": 9,
          "record": "4W - 5L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "p32",
        "name": "Rhetoric Ramos",
        "ign": "Rhetoric",
        "role": "Jungler",
        "collegeId": "col-cla",
        "studentId": "2023-01770",
        "isVerified": true,
        "rank": "Mythic Honor 28★",
        "signatureHero": "Karina / Alpha",
        "stats": {
          "kda": "4.7",
          "winRate": "48%",
          "matchesPlayed": 9,
          "record": "4W - 5L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "p33",
        "name": "Prose Basa",
        "ign": "Prose",
        "role": "Mid Lane",
        "collegeId": "col-cla",
        "studentId": "2024-00802",
        "isVerified": true,
        "rank": "Legend II",
        "signatureHero": "Vale / Nana",
        "stats": {
          "kda": "4.1",
          "winRate": "42%",
          "matchesPlayed": 9,
          "record": "4W - 5L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "p34",
        "name": "Essay Santos",
        "ign": "Essay",
        "role": "Gold Lane",
        "collegeId": "col-cla",
        "studentId": "2021-00711",
        "isVerified": true,
        "rank": "Mythic 24★",
        "signatureHero": "Layla / Miya",
        "stats": {
          "kda": "4.6",
          "winRate": "47%",
          "matchesPlayed": 9,
          "record": "4W - 5L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "p35",
        "name": "Sonnet Uy",
        "ign": "Sonnet",
        "role": "Roamer",
        "collegeId": "col-cla",
        "studentId": "2023-02400",
        "isVerified": true,
        "rank": "Legend I",
        "signatureHero": "Estes / Floryn",
        "stats": {
          "kda": "3.8",
          "winRate": "44%",
          "matchesPlayed": 9,
          "record": "4W - 5L",
          "palaroAppearances": 1
        }
      }
    ]
  },
  {
    "id": "team-ced-mentors-mlbb",
    "name": "CED Mentors",
    "collegeId": "col-ced",
    "collegeCode": "CED",
    "gameId": "game-mlbb",
    "seed": 8,
    "winRate": 0.35,
    "record": "3-8",
    "players": [
      {
        "id": "p36",
        "name": "Dean Torres",
        "ign": "Dean",
        "role": "EXP Lane",
        "collegeId": "col-ced",
        "studentId": "2022-01900",
        "isVerified": true,
        "rank": "Legend I",
        "signatureHero": "Balmond / Sun",
        "stats": {
          "kda": "3.5",
          "winRate": "35%",
          "matchesPlayed": 9,
          "record": "3W - 6L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "p37",
        "name": "Prof Dalisay",
        "ign": "Prof",
        "role": "Jungler",
        "collegeId": "col-ced",
        "studentId": "2023-02050",
        "isVerified": true,
        "rank": "Mythic 12★",
        "signatureHero": "Saber / Harley",
        "stats": {
          "kda": "4.3",
          "winRate": "38%",
          "matchesPlayed": 9,
          "record": "3W - 6L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "p38",
        "name": "Teach Morales",
        "ign": "Teach",
        "role": "Mid Lane",
        "collegeId": "col-ced",
        "studentId": "2021-00912",
        "isVerified": true,
        "rank": "Legend II",
        "signatureHero": "Gord / Cyclops",
        "stats": {
          "kda": "3.8",
          "winRate": "34%",
          "matchesPlayed": 9,
          "record": "3W - 6L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "p39",
        "name": "Chalk Lim",
        "ign": "Chalk",
        "role": "Gold Lane",
        "collegeId": "col-ced",
        "studentId": "2024-00190",
        "isVerified": true,
        "rank": "Legend III",
        "signatureHero": "Hanabi / Bruno",
        "stats": {
          "kda": "3.9",
          "winRate": "36%",
          "matchesPlayed": 9,
          "record": "3W - 6L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "p40",
        "name": "Ruler Go",
        "ign": "Ruler",
        "role": "Roamer",
        "collegeId": "col-ced",
        "studentId": "2023-03100",
        "isVerified": true,
        "rank": "Mythic 16★",
        "signatureHero": "Hylos / Johnson",
        "stats": {
          "kda": "3.2",
          "winRate": "35%",
          "matchesPlayed": 9,
          "record": "3W - 6L",
          "palaroAppearances": 1
        }
      }
    ]
  },
  {
    "id": "team-ccs-cipher",
    "name": "CCS Cipher",
    "collegeId": "col-ccs",
    "collegeCode": "CCS",
    "gameId": "game-val",
    "seed": 1,
    "winRate": 0.86,
    "record": "6-1",
    "players": [
      {
        "id": "vp1",
        "name": "Adrian Cruz",
        "ign": "AdrianX",
        "role": "Duelist",
        "collegeId": "col-ccs",
        "studentId": "2023-02011",
        "isVerified": true,
        "rank": "Immortal 3 — 382 RR",
        "signatureHero": "Jett / Reyna",
        "stats": {
          "kda": "1.42",
          "winRate": "86%",
          "matchesPlayed": 7,
          "record": "6W - 1L",
          "totalKills": 144,
          "totalDeaths": 72,
          "totalAssists": 38,
          "palaroAppearances": 2
        }
      },
      {
        "id": "vp2",
        "name": "Lena Masangkay",
        "ign": "LenaSage",
        "role": "Sentinel",
        "collegeId": "col-ccs",
        "studentId": "2023-02088",
        "isVerified": true,
        "rank": "Ascendant 3 — 290 RR",
        "signatureHero": "Sage / Killjoy",
        "stats": {
          "kda": "1.05",
          "winRate": "82%",
          "matchesPlayed": 7,
          "record": "6W - 1L",
          "totalKills": 58,
          "totalDeaths": 70,
          "totalAssists": 90,
          "palaroAppearances": 1
        }
      },
      {
        "id": "vp3",
        "name": "Marco Sy",
        "ign": "MarcoBrim",
        "role": "Controller",
        "collegeId": "col-ccs",
        "studentId": "2022-01800",
        "isVerified": true,
        "rank": "Diamond 2 — 198 RR",
        "signatureHero": "Brimstone / Astra",
        "stats": {
          "kda": "0.98",
          "winRate": "79%",
          "matchesPlayed": 7,
          "record": "6W - 1L",
          "totalKills": 49,
          "totalDeaths": 68,
          "totalAssists": 102,
          "palaroAppearances": 1
        }
      },
      {
        "id": "vp4",
        "name": "Gab Reyes",
        "ign": "GabSova",
        "role": "Initiator",
        "collegeId": "col-ccs",
        "studentId": "2024-00201",
        "isVerified": true,
        "rank": "Platinum 1 — 88 RR",
        "signatureHero": "Sova / Fade",
        "stats": {
          "kda": "1.12",
          "winRate": "80%",
          "matchesPlayed": 7,
          "record": "6W - 1L",
          "totalKills": 70,
          "totalDeaths": 68,
          "totalAssists": 85,
          "palaroAppearances": 1
        }
      },
      {
        "id": "vp5",
        "name": "Nico Rebueno",
        "ign": "NicoOmen",
        "role": "Controller",
        "collegeId": "col-ccs",
        "studentId": "2023-03401",
        "isVerified": true,
        "rank": "Ascendant 1 — 144 RR",
        "signatureHero": "Omen / Viper",
        "stats": {
          "kda": "1.18",
          "winRate": "84%",
          "matchesPlayed": 7,
          "record": "6W - 1L",
          "totalKills": 62,
          "totalDeaths": 60,
          "totalAssists": 98,
          "palaroAppearances": 2
        }
      }
    ]
  },
  {
    "id": "team-coe-voltage",
    "name": "COE Voltage",
    "collegeId": "col-coe",
    "collegeCode": "COE",
    "gameId": "game-val",
    "seed": 2,
    "winRate": 0.72,
    "record": "5-2",
    "players": [
      {
        "id": "vp6",
        "name": "Dana Alvarez",
        "ign": "DanaJett",
        "role": "Duelist",
        "collegeId": "col-coe",
        "studentId": "2022-02400",
        "isVerified": true,
        "rank": "Diamond 3 — 265 RR",
        "signatureHero": "Jett / Neon",
        "stats": {
          "kda": "1.31",
          "winRate": "72%",
          "matchesPlayed": 7,
          "record": "5W - 2L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "vp7",
        "name": "Ray Torres",
        "ign": "RayCypher",
        "role": "Sentinel",
        "collegeId": "col-coe",
        "studentId": "2023-01200",
        "isVerified": true,
        "rank": "Platinum 3 — 124 RR",
        "signatureHero": "Cypher / Chamber",
        "stats": {
          "kda": "0.92",
          "winRate": "68%",
          "matchesPlayed": 7,
          "record": "5W - 2L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "vp8",
        "name": "Ben Ocampo",
        "ign": "BenClove",
        "role": "Initiator",
        "collegeId": "col-coe",
        "studentId": "2021-00902",
        "isVerified": true,
        "rank": "Gold 1 — 78 RR",
        "signatureHero": "Clove / Breach",
        "stats": {
          "kda": "1.04",
          "winRate": "70%",
          "matchesPlayed": 7,
          "record": "5W - 2L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "vp9",
        "name": "Kim Solis",
        "ign": "KimIso",
        "role": "Duelist",
        "collegeId": "col-coe",
        "studentId": "2024-00511",
        "isVerified": true,
        "rank": "Diamond 1 — 180 RR",
        "signatureHero": "Iso / Phoenix",
        "stats": {
          "kda": "1.20",
          "winRate": "71%",
          "matchesPlayed": 7,
          "record": "5W - 2L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "vp10",
        "name": "Jethro Ramos",
        "ign": "JethroViper",
        "role": "Controller",
        "collegeId": "col-coe",
        "studentId": "2022-03180",
        "isVerified": true,
        "rank": "Ascendant 2 — 195 RR",
        "signatureHero": "Viper / Harbor",
        "stats": {
          "kda": "1.14",
          "winRate": "74%",
          "matchesPlayed": 7,
          "record": "5W - 2L",
          "palaroAppearances": 2
        }
      }
    ]
  },
  {
    "id": "team-cn-aegis",
    "name": "CN Aegis",
    "collegeId": "col-cn",
    "collegeCode": "CN",
    "gameId": "game-val",
    "seed": 3,
    "winRate": 0.68,
    "record": "4-2",
    "players": [
      {
        "id": "vp11",
        "name": "Faith Santos",
        "ign": "FaithSage",
        "role": "Sentinel",
        "collegeId": "col-cn",
        "studentId": "2022-01901",
        "isVerified": true,
        "rank": "Ascendant 1 — 110 RR",
        "signatureHero": "Sage / Deadlock",
        "stats": {
          "kda": "1.02",
          "winRate": "68%",
          "matchesPlayed": 6,
          "record": "4W - 2L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "vp12",
        "name": "Mercy David",
        "ign": "MercySkye",
        "role": "Initiator",
        "collegeId": "col-cn",
        "studentId": "2022-01990",
        "isVerified": true,
        "rank": "Diamond 2 — 185 RR",
        "signatureHero": "Skye / Gekko",
        "stats": {
          "kda": "1.15",
          "winRate": "70%",
          "matchesPlayed": 6,
          "record": "4W - 2L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "vp13",
        "name": "Lance Uy",
        "ign": "LanceOmen",
        "role": "Controller",
        "collegeId": "col-cn",
        "studentId": "2023-01442",
        "isVerified": true,
        "rank": "Platinum 2 — 95 RR",
        "signatureHero": "Omen / Astra",
        "stats": {
          "kda": "0.98",
          "winRate": "66%",
          "matchesPlayed": 6,
          "record": "4W - 2L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "vp14",
        "name": "Chloe Lim",
        "ign": "ChloeJett",
        "role": "Duelist",
        "collegeId": "col-cn",
        "studentId": "2024-00210",
        "isVerified": true,
        "rank": "Gold 3 — 65 RR",
        "signatureHero": "Jett / Raze",
        "stats": {
          "kda": "1.22",
          "winRate": "69%",
          "matchesPlayed": 6,
          "record": "4W - 2L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "vp15",
        "name": "Paolo Tan",
        "ign": "PaoloChamber",
        "role": "Sentinel",
        "collegeId": "col-cn",
        "studentId": "2021-00889",
        "isVerified": true,
        "rank": "Diamond 3 — 220 RR",
        "signatureHero": "Chamber / Cypher",
        "stats": {
          "kda": "1.25",
          "winRate": "72%",
          "matchesPlayed": 6,
          "record": "4W - 2L",
          "palaroAppearances": 2
        }
      }
    ]
  },
  {
    "id": "team-ccje-enforcers-val",
    "name": "CCJE Enforcers",
    "collegeId": "col-ccje",
    "collegeCode": "CCJE",
    "gameId": "game-val",
    "seed": 4,
    "winRate": 0.65,
    "record": "4-3",
    "players": [
      {
        "id": "vp16",
        "name": "Mark Baton",
        "ign": "BrimForce",
        "role": "Controller",
        "collegeId": "col-ccje",
        "studentId": "2022-01441",
        "isVerified": true,
        "rank": "Diamond 2 — 165 RR",
        "signatureHero": "Brimstone / Omen",
        "stats": {
          "kda": "1.08",
          "winRate": "65%",
          "matchesPlayed": 7,
          "record": "4W - 3L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "vp17",
        "name": "Rex Duty",
        "ign": "BreachLock",
        "role": "Initiator",
        "collegeId": "col-ccje",
        "studentId": "2023-00912",
        "isVerified": true,
        "rank": "Ascendant 2 — 188 RR",
        "signatureHero": "Breach / Fade",
        "stats": {
          "kda": "1.16",
          "winRate": "66%",
          "matchesPlayed": 7,
          "record": "4W - 3L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "vp18",
        "name": "Paul Law",
        "ign": "CypherPatrol",
        "role": "Sentinel",
        "collegeId": "col-ccje",
        "studentId": "2021-01822",
        "isVerified": true,
        "rank": "Platinum 1 — 90 RR",
        "signatureHero": "Cypher / Killjoy",
        "stats": {
          "kda": "0.94",
          "winRate": "62%",
          "matchesPlayed": 7,
          "record": "4W - 3L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "vp19",
        "name": "Ian Radar",
        "ign": "SovaGuard",
        "role": "Initiator",
        "collegeId": "col-ccje",
        "studentId": "2024-00771",
        "isVerified": true,
        "rank": "Diamond 1 — 140 RR",
        "signatureHero": "Sova / Fade",
        "stats": {
          "kda": "1.10",
          "winRate": "64%",
          "matchesPlayed": 7,
          "record": "4W - 3L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "vp20",
        "name": "Gabe Echo",
        "ign": "ReynaEnforce",
        "role": "Duelist",
        "collegeId": "col-ccje",
        "studentId": "2023-01999",
        "isVerified": true,
        "rank": "Immortal 1 — 120 RR",
        "signatureHero": "Reyna / Phoenix",
        "stats": {
          "kda": "1.38",
          "winRate": "68%",
          "matchesPlayed": 7,
          "record": "4W - 3L",
          "palaroAppearances": 2
        }
      }
    ]
  },
  {
    "id": "team-cl-verdict-val",
    "name": "CL Verdict",
    "collegeId": "col-cl",
    "collegeCode": "CL",
    "gameId": "game-val",
    "seed": 5,
    "winRate": 0.58,
    "record": "3-3",
    "players": [
      {
        "id": "vp21",
        "name": "Atty. Kevin Tan",
        "ign": "GavelDuel",
        "role": "Duelist",
        "collegeId": "col-cl",
        "studentId": "2021-00210",
        "isVerified": true,
        "rank": "Ascendant 1 — 125 RR",
        "signatureHero": "Jett / Iso",
        "stats": {
          "kda": "1.24",
          "winRate": "58%",
          "matchesPlayed": 6,
          "record": "3W - 3L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "vp22",
        "name": "Clarisse Lee",
        "ign": "LexViper",
        "role": "Controller",
        "collegeId": "col-cl",
        "studentId": "2022-00891",
        "isVerified": true,
        "rank": "Diamond 1 — 142 RR",
        "signatureHero": "Viper / Omen",
        "stats": {
          "kda": "1.02",
          "winRate": "56%",
          "matchesPlayed": 6,
          "record": "3W - 3L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "vp23",
        "name": "Justin Sy",
        "ign": "JurisSage",
        "role": "Sentinel",
        "collegeId": "col-cl",
        "studentId": "2020-00101",
        "isVerified": true,
        "rank": "Platinum 3 — 112 RR",
        "signatureHero": "Sage / Killjoy",
        "stats": {
          "kda": "0.96",
          "winRate": "57%",
          "matchesPlayed": 6,
          "record": "3W - 3L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "vp24",
        "name": "Mia Go",
        "ign": "SovaBrief",
        "role": "Initiator",
        "collegeId": "col-cl",
        "studentId": "2023-01044",
        "isVerified": true,
        "rank": "Gold 2 — 84 RR",
        "signatureHero": "Sova / Gekko",
        "stats": {
          "kda": "1.06",
          "winRate": "55%",
          "matchesPlayed": 6,
          "record": "3W - 3L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "vp25",
        "name": "David Lim",
        "ign": "CourtOmen",
        "role": "Controller",
        "collegeId": "col-cl",
        "studentId": "2022-01550",
        "isVerified": true,
        "rank": "Diamond 2 — 176 RR",
        "signatureHero": "Omen / Astra",
        "stats": {
          "kda": "1.10",
          "winRate": "60%",
          "matchesPlayed": 6,
          "record": "3W - 3L",
          "palaroAppearances": 1
        }
      }
    ]
  },
  {
    "id": "team-ca-blueprint-val",
    "name": "CA Architects",
    "collegeId": "col-ca",
    "collegeCode": "CA",
    "gameId": "game-val",
    "seed": 6,
    "winRate": 0.5,
    "record": "3-3",
    "players": [
      {
        "id": "vp26",
        "name": "Ar. Neil Ortiz",
        "ign": "NeilGrid",
        "role": "Sentinel",
        "collegeId": "col-ca",
        "studentId": "2022-02100",
        "isVerified": true,
        "rank": "Diamond 1 — 145 RR",
        "signatureHero": "Cypher / Deadlock",
        "stats": {
          "kda": "1.05",
          "winRate": "50%",
          "matchesPlayed": 6,
          "record": "3W - 3L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "vp27",
        "name": "Bea Santos",
        "ign": "DraftBrim",
        "role": "Controller",
        "collegeId": "col-ca",
        "studentId": "2023-01440",
        "isVerified": true,
        "rank": "Platinum 2 — 92 RR",
        "signatureHero": "Brimstone / Viper",
        "stats": {
          "kda": "0.97",
          "winRate": "49%",
          "matchesPlayed": 6,
          "record": "3W - 3L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "vp28",
        "name": "Kyle Cruz",
        "ign": "RazePillar",
        "role": "Duelist",
        "collegeId": "col-ca",
        "studentId": "2021-00990",
        "isVerified": true,
        "rank": "Ascendant 1 — 115 RR",
        "signatureHero": "Raze / Neon",
        "stats": {
          "kda": "1.28",
          "winRate": "52%",
          "matchesPlayed": 6,
          "record": "3W - 3L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "vp29",
        "name": "Renz Reyes",
        "ign": "SkyeMeasure",
        "role": "Initiator",
        "collegeId": "col-ca",
        "studentId": "2024-00311",
        "isVerified": true,
        "rank": "Gold 1 — 72 RR",
        "signatureHero": "Skye / Breach",
        "stats": {
          "kda": "1.00",
          "winRate": "48%",
          "matchesPlayed": 6,
          "record": "3W - 3L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "vp30",
        "name": "Derrick Tan",
        "ign": "OmenFacade",
        "role": "Controller",
        "collegeId": "col-ca",
        "studentId": "2023-03010",
        "isVerified": true,
        "rank": "Platinum 3 — 110 RR",
        "signatureHero": "Omen / Harbor",
        "stats": {
          "kda": "1.08",
          "winRate": "51%",
          "matchesPlayed": 6,
          "record": "3W - 3L",
          "palaroAppearances": 1
        }
      }
    ]
  },
  {
    "id": "team-cla-phantoms-val",
    "name": "CLA Phantoms",
    "collegeId": "col-cla",
    "collegeCode": "CLA",
    "gameId": "game-val",
    "seed": 7,
    "winRate": 0.42,
    "record": "2-4",
    "players": [
      {
        "id": "vp31",
        "name": "Maya Garcia",
        "ign": "FadeGhost",
        "role": "Initiator",
        "collegeId": "col-cla",
        "studentId": "2022-03100",
        "isVerified": true,
        "rank": "Diamond 1 — 150 RR",
        "signatureHero": "Fade / Sova",
        "stats": {
          "kda": "1.10",
          "winRate": "42%",
          "matchesPlayed": 6,
          "record": "2W - 4L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "vp32",
        "name": "Leon Ramos",
        "ign": "ReynaBlade",
        "role": "Duelist",
        "collegeId": "col-cla",
        "studentId": "2023-01770",
        "isVerified": true,
        "rank": "Ascendant 1 — 130 RR",
        "signatureHero": "Reyna / Phoenix",
        "stats": {
          "kda": "1.25",
          "winRate": "45%",
          "matchesPlayed": 6,
          "record": "2W - 4L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "vp33",
        "name": "Sofia Basa",
        "ign": "SkyeFlora",
        "role": "Initiator",
        "collegeId": "col-cla",
        "studentId": "2024-00802",
        "isVerified": true,
        "rank": "Platinum 2 — 85 RR",
        "signatureHero": "Skye / Gekko",
        "stats": {
          "kda": "0.95",
          "winRate": "40%",
          "matchesPlayed": 6,
          "record": "2W - 4L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "vp34",
        "name": "Ethan Santos",
        "ign": "AstraCosmic",
        "role": "Controller",
        "collegeId": "col-cla",
        "studentId": "2021-00711",
        "isVerified": true,
        "rank": "Gold 2 — 70 RR",
        "signatureHero": "Astra / Omen",
        "stats": {
          "kda": "0.90",
          "winRate": "41%",
          "matchesPlayed": 6,
          "record": "2W - 4L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "vp35",
        "name": "Chloe Uy",
        "ign": "KilljoyLogic",
        "role": "Sentinel",
        "collegeId": "col-cla",
        "studentId": "2023-02400",
        "isVerified": true,
        "rank": "Diamond 3 — 240 RR",
        "signatureHero": "Killjoy / Sage",
        "stats": {
          "kda": "1.14",
          "winRate": "44%",
          "matchesPlayed": 6,
          "record": "2W - 4L",
          "palaroAppearances": 2
        }
      }
    ]
  },
  {
    "id": "team-ced-scholars-val",
    "name": "CED Scholars",
    "collegeId": "col-ced",
    "collegeCode": "CED",
    "gameId": "game-val",
    "seed": 8,
    "winRate": 0.33,
    "record": "2-4",
    "players": [
      {
        "id": "vp36",
        "name": "Prof. Mark Torres",
        "ign": "SageSensei",
        "role": "Sentinel",
        "collegeId": "col-ced",
        "studentId": "2022-01900",
        "isVerified": true,
        "rank": "Diamond 2 — 170 RR",
        "signatureHero": "Sage / Cypher",
        "stats": {
          "kda": "1.04",
          "winRate": "35%",
          "matchesPlayed": 6,
          "record": "2W - 4L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "vp37",
        "name": "Jared Dalisay",
        "ign": "SovaTutor",
        "role": "Initiator",
        "collegeId": "col-ced",
        "studentId": "2023-02050",
        "isVerified": true,
        "rank": "Platinum 3 — 115 RR",
        "signatureHero": "Sova / Fade",
        "stats": {
          "kda": "1.02",
          "winRate": "33%",
          "matchesPlayed": 6,
          "record": "2W - 4L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "vp38",
        "name": "Ella Morales",
        "ign": "BrimCoach",
        "role": "Controller",
        "collegeId": "col-ced",
        "studentId": "2021-00912",
        "isVerified": true,
        "rank": "Gold 3 — 80 RR",
        "signatureHero": "Brimstone / Omen",
        "stats": {
          "kda": "0.92",
          "winRate": "32%",
          "matchesPlayed": 6,
          "record": "2W - 4L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "vp39",
        "name": "Christian Lim",
        "ign": "CloveLearn",
        "role": "Controller",
        "collegeId": "col-ced",
        "studentId": "2024-00190",
        "isVerified": true,
        "rank": "Platinum 1 — 95 RR",
        "signatureHero": "Clove / Harbor",
        "stats": {
          "kda": "1.08",
          "winRate": "34%",
          "matchesPlayed": 6,
          "record": "2W - 4L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "vp40",
        "name": "Rachelle Go",
        "ign": "FadeExam",
        "role": "Duelist",
        "collegeId": "col-ced",
        "studentId": "2023-03100",
        "isVerified": true,
        "rank": "Diamond 1 — 135 RR",
        "signatureHero": "Iso / Jett",
        "stats": {
          "kda": "1.18",
          "winRate": "36%",
          "matchesPlayed": 6,
          "record": "2W - 4L",
          "palaroAppearances": 1
        }
      }
    ]
  },
  {
    "id": "team-ccs-nexus",
    "name": "CCS Nexus",
    "collegeId": "col-ccs",
    "collegeCode": "CCS",
    "gameId": "game-lol",
    "seed": 1,
    "winRate": 0.85,
    "record": "8-2",
    "players": [
      {
        "id": "lp1",
        "name": "Dexter Tan",
        "ign": "Dexter",
        "role": "Top Lane",
        "collegeId": "col-ccs",
        "studentId": "2023-01900",
        "isVerified": true,
        "rank": "Diamond I — 88 LP",
        "signatureHero": "Aatrox / Fiora",
        "stats": {
          "kda": "4.8",
          "winRate": "82%",
          "matchesPlayed": 10,
          "record": "8W - 2L",
          "totalKills": 65,
          "totalDeaths": 22,
          "totalAssists": 55,
          "palaroAppearances": 3
        }
      },
      {
        "id": "lp2",
        "name": "Kael Santos",
        "ign": "Kael",
        "role": "Jungle",
        "collegeId": "col-ccs",
        "studentId": "2022-00812",
        "isVerified": true,
        "rank": "Emerald II — 45 LP",
        "signatureHero": "Lee Sin / Viego",
        "stats": {
          "kda": "5.2",
          "winRate": "85%",
          "matchesPlayed": 10,
          "record": "8W - 2L",
          "totalKills": 58,
          "totalDeaths": 19,
          "totalAssists": 80,
          "palaroAppearances": 2
        }
      },
      {
        "id": "lp3",
        "name": "Vince Uy",
        "ign": "Vince",
        "role": "Mid Lane",
        "collegeId": "col-ccs",
        "studentId": "2023-02100",
        "isVerified": true,
        "rank": "Master — 120 LP",
        "signatureHero": "Ahri / Azir",
        "stats": {
          "kda": "6.1",
          "winRate": "86%",
          "matchesPlayed": 10,
          "record": "8W - 2L",
          "totalKills": 80,
          "totalDeaths": 18,
          "totalAssists": 70,
          "palaroAppearances": 2
        }
      },
      {
        "id": "lp4",
        "name": "Mia Cruz",
        "ign": "Mia",
        "role": "Bot Lane",
        "collegeId": "col-ccs",
        "studentId": "2024-00310",
        "isVerified": true,
        "rank": "Gold I — 76 LP",
        "signatureHero": "Jinx / Caitlyn",
        "stats": {
          "kda": "4.2",
          "winRate": "74%",
          "matchesPlayed": 10,
          "record": "8W - 2L",
          "totalKills": 72,
          "totalDeaths": 30,
          "totalAssists": 45,
          "palaroAppearances": 1
        }
      },
      {
        "id": "lp5",
        "name": "Bea Tan",
        "ign": "BeaSupport",
        "role": "Support",
        "collegeId": "col-ccs",
        "studentId": "2023-03500",
        "isVerified": true,
        "rank": "Platinum II — 68 LP",
        "signatureHero": "Lulu / Thresh",
        "stats": {
          "kda": "3.2",
          "winRate": "80%",
          "matchesPlayed": 10,
          "record": "8W - 2L",
          "totalKills": 14,
          "totalDeaths": 26,
          "totalAssists": 120,
          "palaroAppearances": 2
        }
      }
    ]
  },
  {
    "id": "team-coe-iron-forge",
    "name": "COE Iron Forge",
    "collegeId": "col-coe",
    "collegeCode": "COE",
    "gameId": "game-lol",
    "seed": 2,
    "winRate": 0.7,
    "record": "7-3",
    "players": [
      {
        "id": "lp6",
        "name": "Renz Morales",
        "ign": "RenzTop",
        "role": "Top Lane",
        "collegeId": "col-coe",
        "studentId": "2022-02500",
        "isVerified": true,
        "rank": "Emerald III — 30 LP",
        "signatureHero": "Jayce / Camille",
        "stats": {
          "kda": "4.1",
          "winRate": "70%",
          "matchesPlayed": 10,
          "record": "7W - 3L",
          "palaroAppearances": 3
        }
      },
      {
        "id": "lp7",
        "name": "Faye Corpuz",
        "ign": "FayeMid",
        "role": "Mid Lane",
        "collegeId": "col-coe",
        "studentId": "2023-01300",
        "isVerified": true,
        "rank": "Gold II — 44 LP",
        "signatureHero": "Orianna / Syndra",
        "stats": {
          "kda": "4.8",
          "winRate": "72%",
          "matchesPlayed": 10,
          "record": "7W - 3L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "lp8",
        "name": "Troy Basa",
        "ign": "TroyJungle",
        "role": "Jungle",
        "collegeId": "col-coe",
        "studentId": "2021-01000",
        "isVerified": true,
        "rank": "Platinum III — 58 LP",
        "signatureHero": "Graves / Hecarim",
        "stats": {
          "kda": "3.7",
          "winRate": "68%",
          "matchesPlayed": 10,
          "record": "7W - 3L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "lp9",
        "name": "Wren Santos",
        "ign": "WrenBot",
        "role": "Bot Lane",
        "collegeId": "col-coe",
        "studentId": "2024-00400",
        "isVerified": true,
        "rank": "Emerald IV — 15 LP",
        "signatureHero": "Ezreal / Kai'Sa",
        "stats": {
          "kda": "4.5",
          "winRate": "71%",
          "matchesPlayed": 10,
          "record": "7W - 3L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "lp10",
        "name": "Sam Lim",
        "ign": "SamSupp",
        "role": "Support",
        "collegeId": "col-coe",
        "studentId": "2023-03600",
        "isVerified": true,
        "rank": "Diamond IV — 52 LP",
        "signatureHero": "Nautilus / Leona",
        "stats": {
          "kda": "3.5",
          "winRate": "69%",
          "matchesPlayed": 10,
          "record": "7W - 3L",
          "palaroAppearances": 2
        }
      }
    ]
  },
  {
    "id": "team-cn-wardens-lol",
    "name": "CN Wardens",
    "collegeId": "col-cn",
    "collegeCode": "CN",
    "gameId": "game-lol",
    "seed": 3,
    "winRate": 0.65,
    "record": "6-4",
    "players": [
      {
        "id": "lp11",
        "name": "Nurse Akali",
        "ign": "NurseAkali",
        "role": "Top Lane",
        "collegeId": "col-cn",
        "studentId": "2022-01912",
        "isVerified": true,
        "rank": "Platinum I — 78 LP",
        "signatureHero": "Shen / Gwen",
        "stats": {
          "kda": "3.9",
          "winRate": "64%",
          "matchesPlayed": 10,
          "record": "6W - 4L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "lp12",
        "name": "Dr. Heal",
        "ign": "HealBot",
        "role": "Support",
        "collegeId": "col-cn",
        "studentId": "2023-01111",
        "isVerified": true,
        "rank": "Emerald II — 60 LP",
        "signatureHero": "Soraka / Sona",
        "stats": {
          "kda": "4.5",
          "winRate": "66%",
          "matchesPlayed": 10,
          "record": "6W - 4L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "lp13",
        "name": "Ian Lock",
        "ign": "StunLock",
        "role": "Jungle",
        "collegeId": "col-cn",
        "studentId": "2021-00822",
        "isVerified": true,
        "rank": "Gold I — 85 LP",
        "signatureHero": "Sejuani / Jarvan IV",
        "stats": {
          "kda": "3.6",
          "winRate": "62%",
          "matchesPlayed": 10,
          "record": "6W - 4L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "lp14",
        "name": "Cure All",
        "ign": "CureMid",
        "role": "Mid Lane",
        "collegeId": "col-cn",
        "studentId": "2024-00222",
        "isVerified": true,
        "rank": "Diamond III — 45 LP",
        "signatureHero": "Anivia / Karma",
        "stats": {
          "kda": "4.8",
          "winRate": "68%",
          "matchesPlayed": 10,
          "record": "6W - 4L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "lp15",
        "name": "Gary Shield",
        "ign": "GuardianADC",
        "role": "Bot Lane",
        "collegeId": "col-cn",
        "studentId": "2023-02101",
        "isVerified": true,
        "rank": "Platinum IV — 20 LP",
        "signatureHero": "Ashe / Varus",
        "stats": {
          "kda": "4.1",
          "winRate": "65%",
          "matchesPlayed": 10,
          "record": "6W - 4L",
          "palaroAppearances": 2
        }
      }
    ]
  },
  {
    "id": "team-ccje-justiciars-lol",
    "name": "CCJE Justiciars",
    "collegeId": "col-ccje",
    "collegeCode": "CCJE",
    "gameId": "game-lol",
    "seed": 4,
    "winRate": 0.62,
    "record": "6-4",
    "players": [
      {
        "id": "lp16",
        "name": "Officer Darius",
        "ign": "DariusLaw",
        "role": "Top Lane",
        "collegeId": "col-ccje",
        "studentId": "2022-01400",
        "isVerified": true,
        "rank": "Emerald I — 90 LP",
        "signatureHero": "Darius / Garen",
        "stats": {
          "kda": "4.4",
          "winRate": "62%",
          "matchesPlayed": 10,
          "record": "6W - 4L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "lp17",
        "name": "Vi Piltover",
        "ign": "ViJailbreak",
        "role": "Jungle",
        "collegeId": "col-ccje",
        "studentId": "2023-00900",
        "isVerified": true,
        "rank": "Diamond II — 35 LP",
        "signatureHero": "Vi / Warwick",
        "stats": {
          "kda": "4.9",
          "winRate": "65%",
          "matchesPlayed": 10,
          "record": "6W - 4L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "lp18",
        "name": "Sheriff Cait",
        "ign": "CaitSnipe",
        "role": "Bot Lane",
        "collegeId": "col-ccje",
        "studentId": "2021-01800",
        "isVerified": true,
        "rank": "Master — 180 LP",
        "signatureHero": "Caitlyn / Jinx",
        "stats": {
          "kda": "5.6",
          "winRate": "68%",
          "matchesPlayed": 10,
          "record": "6W - 4L",
          "palaroAppearances": 3
        }
      },
      {
        "id": "lp19",
        "name": "Bailiff Naut",
        "ign": "NautHook",
        "role": "Support",
        "collegeId": "col-ccje",
        "studentId": "2024-00700",
        "isVerified": true,
        "rank": "Platinum I — 55 LP",
        "signatureHero": "Nautilus / Blitzcrank",
        "stats": {
          "kda": "3.4",
          "winRate": "60%",
          "matchesPlayed": 10,
          "record": "6W - 4L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "lp20",
        "name": "Judge Morgana",
        "ign": "MorganaChain",
        "role": "Mid Lane",
        "collegeId": "col-ccje",
        "studentId": "2023-01900",
        "isVerified": true,
        "rank": "Emerald III — 40 LP",
        "signatureHero": "Morgana / Lissandra",
        "stats": {
          "kda": "4.2",
          "winRate": "61%",
          "matchesPlayed": 10,
          "record": "6W - 4L",
          "palaroAppearances": 2
        }
      }
    ]
  },
  {
    "id": "team-cl-verdict-lol",
    "name": "CL Verdict",
    "collegeId": "col-cl",
    "collegeCode": "CL",
    "gameId": "game-lol",
    "seed": 5,
    "winRate": 0.55,
    "record": "5-5",
    "players": [
      {
        "id": "lp21",
        "name": "Advocate Jax",
        "ign": "JaxClause",
        "role": "Top Lane",
        "collegeId": "col-cl",
        "studentId": "2021-00201",
        "isVerified": true,
        "rank": "Diamond III — 62 LP",
        "signatureHero": "Jax / Renekton",
        "stats": {
          "kda": "4.3",
          "winRate": "55%",
          "matchesPlayed": 10,
          "record": "5W - 5L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "lp22",
        "name": "Trunda Legal",
        "ign": "TrundleBrief",
        "role": "Jungle",
        "collegeId": "col-cl",
        "studentId": "2022-00810",
        "isVerified": true,
        "rank": "Platinum II — 70 LP",
        "signatureHero": "Trundle / Xin Zhao",
        "stats": {
          "kda": "3.8",
          "winRate": "54%",
          "matchesPlayed": 10,
          "record": "5W - 5L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "lp23",
        "name": "Malzahar Statute",
        "ign": "MalzHar",
        "role": "Mid Lane",
        "collegeId": "col-cl",
        "studentId": "2020-00109",
        "isVerified": true,
        "rank": "Emerald II — 80 LP",
        "signatureHero": "Malzahar / Twisted Fate",
        "stats": {
          "kda": "4.6",
          "winRate": "57%",
          "matchesPlayed": 10,
          "record": "5W - 5L",
          "palaroAppearances": 3
        }
      },
      {
        "id": "lp24",
        "name": "Jhin Verdict",
        "ign": "JhinAppeal",
        "role": "Bot Lane",
        "collegeId": "col-cl",
        "studentId": "2023-01011",
        "isVerified": true,
        "rank": "Diamond I — 92 LP",
        "signatureHero": "Jhin / Miss Fortune",
        "stats": {
          "kda": "5.1",
          "winRate": "58%",
          "matchesPlayed": 10,
          "record": "5W - 5L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "lp25",
        "name": "Braum Defense",
        "ign": "BraumCounsel",
        "role": "Support",
        "collegeId": "col-cl",
        "studentId": "2022-01500",
        "isVerified": true,
        "rank": "Platinum I — 45 LP",
        "signatureHero": "Braum / Alistar",
        "stats": {
          "kda": "3.5",
          "winRate": "55%",
          "matchesPlayed": 10,
          "record": "5W - 5L",
          "palaroAppearances": 2
        }
      }
    ]
  },
  {
    "id": "team-ca-constructors-lol",
    "name": "CA Constructors",
    "collegeId": "col-ca",
    "collegeCode": "CA",
    "gameId": "game-lol",
    "seed": 6,
    "winRate": 0.5,
    "record": "5-5",
    "players": [
      {
        "id": "lp26",
        "name": "Ornn Mason",
        "ign": "OrnnCraft",
        "role": "Top Lane",
        "collegeId": "col-ca",
        "studentId": "2022-02111",
        "isVerified": true,
        "rank": "Emerald II — 55 LP",
        "signatureHero": "Ornn / Sion",
        "stats": {
          "kda": "4.0",
          "winRate": "52%",
          "matchesPlayed": 10,
          "record": "5W - 5L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "lp27",
        "name": "Jayce Pillar",
        "ign": "JayceDesign",
        "role": "Mid Lane",
        "collegeId": "col-ca",
        "studentId": "2023-01401",
        "isVerified": true,
        "rank": "Diamond IV — 40 LP",
        "signatureHero": "Jayce / Viktor",
        "stats": {
          "kda": "4.7",
          "winRate": "50%",
          "matchesPlayed": 10,
          "record": "5W - 5L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "lp28",
        "name": "Jarvan Grid",
        "ign": "JarvanBlueprint",
        "role": "Jungle",
        "collegeId": "col-ca",
        "studentId": "2021-00910",
        "isVerified": true,
        "rank": "Platinum III — 50 LP",
        "signatureHero": "Jarvan IV / Gragas",
        "stats": {
          "kda": "3.9",
          "winRate": "49%",
          "matchesPlayed": 10,
          "record": "5W - 5L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "lp29",
        "name": "Ziggs Demolish",
        "ign": "ZiggsArchi",
        "role": "Bot Lane",
        "collegeId": "col-ca",
        "studentId": "2024-00301",
        "isVerified": true,
        "rank": "Gold II — 62 LP",
        "signatureHero": "Ziggs / Tristana",
        "stats": {
          "kda": "4.2",
          "winRate": "48%",
          "matchesPlayed": 10,
          "record": "5W - 5L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "lp30",
        "name": "Poppy Hammer",
        "ign": "PoppyFoundation",
        "role": "Support",
        "collegeId": "col-ca",
        "studentId": "2023-03001",
        "isVerified": true,
        "rank": "Platinum I — 75 LP",
        "signatureHero": "Poppy / Rell",
        "stats": {
          "kda": "3.6",
          "winRate": "51%",
          "matchesPlayed": 10,
          "record": "5W - 5L",
          "palaroAppearances": 1
        }
      }
    ]
  },
  {
    "id": "team-cla-sentinels",
    "name": "CLA Sentinels",
    "collegeId": "col-cla",
    "collegeCode": "CLA",
    "gameId": "game-lol",
    "seed": 7,
    "winRate": 0.45,
    "record": "4-6",
    "players": [
      {
        "id": "lp31",
        "name": "Karma Peace",
        "ign": "KarmaRhetoric",
        "role": "Mid Lane",
        "collegeId": "col-cla",
        "studentId": "2022-03101",
        "isVerified": true,
        "rank": "Platinum II — 65 LP",
        "signatureHero": "Karma / Lux",
        "stats": {
          "kda": "4.2",
          "winRate": "46%",
          "matchesPlayed": 10,
          "record": "4W - 6L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "lp32",
        "name": "Jhin Prose",
        "ign": "JhinPoetry",
        "role": "Bot Lane",
        "collegeId": "col-cla",
        "studentId": "2023-01701",
        "isVerified": true,
        "rank": "Diamond I — 92 LP",
        "signatureHero": "Jhin / Varus",
        "stats": {
          "kda": "5.2",
          "winRate": "48%",
          "matchesPlayed": 10,
          "record": "4W - 6L",
          "palaroAppearances": 3
        }
      },
      {
        "id": "lp33",
        "name": "Swain Discourse",
        "ign": "SwainRhetoric",
        "role": "Top Lane",
        "collegeId": "col-cla",
        "studentId": "2024-00810",
        "isVerified": true,
        "rank": "Emerald II — 50 LP",
        "signatureHero": "Swain / Gangplank",
        "stats": {
          "kda": "3.8",
          "winRate": "44%",
          "matchesPlayed": 10,
          "record": "4W - 6L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "lp34",
        "name": "Bard Traveler",
        "ign": "BardPhilosophy",
        "role": "Support",
        "collegeId": "col-cla",
        "studentId": "2021-00700",
        "isVerified": true,
        "rank": "Emerald IV — 22 LP",
        "signatureHero": "Bard / Rakan",
        "stats": {
          "kda": "3.4",
          "winRate": "42%",
          "matchesPlayed": 10,
          "record": "4W - 6L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "lp35",
        "name": "Ivern Flora",
        "ign": "IvernEssay",
        "role": "Jungle",
        "collegeId": "col-cla",
        "studentId": "2023-02411",
        "isVerified": true,
        "rank": "Gold I — 80 LP",
        "signatureHero": "Ivern / Fiddlesticks",
        "stats": {
          "kda": "3.6",
          "winRate": "45%",
          "matchesPlayed": 10,
          "record": "4W - 6L",
          "palaroAppearances": 1
        }
      }
    ]
  },
  {
    "id": "team-ced-mentors",
    "name": "CED Mentors",
    "collegeId": "col-ced",
    "collegeCode": "CED",
    "gameId": "game-lol",
    "seed": 8,
    "winRate": 0.4,
    "record": "4-6",
    "players": [
      {
        "id": "lp36",
        "name": "Ryze Pedagogy",
        "ign": "RyzeLesson",
        "role": "Mid Lane",
        "collegeId": "col-ced",
        "studentId": "2022-01911",
        "isVerified": true,
        "rank": "Platinum II — 70 LP",
        "signatureHero": "Ryze / Anivia",
        "stats": {
          "kda": "4.0",
          "winRate": "40%",
          "matchesPlayed": 10,
          "record": "4W - 6L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "lp37",
        "name": "Yuumi Tutor",
        "ign": "YuumiTeach",
        "role": "Support",
        "collegeId": "col-ced",
        "studentId": "2023-02001",
        "isVerified": true,
        "rank": "Gold I — 82 LP",
        "signatureHero": "Yuumi / Sona",
        "stats": {
          "kda": "3.9",
          "winRate": "42%",
          "matchesPlayed": 10,
          "record": "4W - 6L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "lp38",
        "name": "Braum Guide",
        "ign": "BraumMentor",
        "role": "Support",
        "collegeId": "col-ced",
        "studentId": "2021-00900",
        "isVerified": true,
        "rank": "Emerald III — 48 LP",
        "signatureHero": "Braum / Taric",
        "stats": {
          "kda": "3.5",
          "winRate": "39%",
          "matchesPlayed": 10,
          "record": "4W - 6L",
          "palaroAppearances": 2
        }
      },
      {
        "id": "lp39",
        "name": "Ashe Focus",
        "ign": "AsheCurriculum",
        "role": "Bot Lane",
        "collegeId": "col-ced",
        "studentId": "2024-00188",
        "isVerified": true,
        "rank": "Diamond III — 55 LP",
        "signatureHero": "Ashe / Sivir",
        "stats": {
          "kda": "4.6",
          "winRate": "43%",
          "matchesPlayed": 10,
          "record": "4W - 6L",
          "palaroAppearances": 1
        }
      },
      {
        "id": "lp40",
        "name": "Udyr Discipline",
        "ign": "UdyrSyllabus",
        "role": "Jungle",
        "collegeId": "col-ced",
        "studentId": "2023-03112",
        "isVerified": true,
        "rank": "Platinum I — 60 LP",
        "signatureHero": "Udyr / Volibear",
        "stats": {
          "kda": "3.7",
          "winRate": "41%",
          "matchesPlayed": 10,
          "record": "4W - 6L",
          "palaroAppearances": 1
        }
      }
    ]
  }
];

// Explicit fictional profile fixtures, not live game-account data.
const SAMPLE_PROGRAMS: Record<string, [string,string]> = {
  'col-ccs':['Computing Studies','BSIT'], 'col-coe':['Engineering','BSCpE'],
  'col-cn':['Nursing','BSN'], 'col-ca':['Architecture','BS Architecture'],
  'col-ccje':['Criminal Justice Education','BS Criminology'], 'col-cl':['Law','Juris Doctor'],
  'col-cla':['Liberal Arts','BA Communication'], 'col-ced':['Education','BSEd'],
};
export const INITIAL_TEAMS: Team[] = SAMPLE_TEAMS.map(team => ({ ...team, players:team.players.map((player,index) => {
  const [department,program] = SAMPLE_PROGRAMS[team.collegeId] || ['Campus esports',''];
  const mlbb = team.gameId === 'game-mlbb';
  const recorded = player.rank?.match(/^(.*?)\s+(?:(\d|[IVX]+)\s+)?(?:—\s*)?(\d+)\s*(?:★|RR|LP)/i);
  return { ...player, isSampleProfile:true, samplePortrait:[1,0,3,4,5][index%5],
    yearLevel:['3rd Year','2nd Year','3rd Year','3rd Year','4th Year'][index%5],department,program,
    bio:`${player.role} player for ${team.name}. Focused on teamwork and making every objective count.`,
    peakRank:mlbb ? {tier:'Mythical Immortal',value:Math.max(Number(recorded?.[3] || 0),team.collegeId==='col-cn' ? [132,125,118,120,127][index%5] : 110+index*7+team.seed),unit:'stars' as const}
      : recorded ? {tier:recorded[1],division:recorded[2],value:Number(recorded[3]),unit:team.gameId==='game-val' ? 'RR' as const : 'LP' as const} : undefined,
  };
}) }));

export const GAME_RANKS: Record<string, string[]> = {
  'game-mlbb': ['Warrior','Elite','Master','Grandmaster','Epic','Legend','Mythic','Mythical Honor','Mythical Glory','Mythical Immortal'],
  'game-dota2': ['Herald','Guardian','Crusader','Archon','Legend','Ancient','Divine','Immortal'],
  'game-codm-mp': ['Rookie','Veteran','Elite','Pro','Master','Grandmaster','Legendary'],
  'game-codm-br': ['Rookie','Veteran','Elite','Pro','Master','Grandmaster','Legendary'],
};

export const INITIAL_GAMES: GameTitle[] = [
  {id:'game-mlbb',name:'Mobile Legends: Bang Bang',registeredTeams:8,visibility:'Show everywhere',bannerImage:mlbbBanner,category:'MOBA'},
  {id:'game-dota2',name:'Dota 2',registeredTeams:0,visibility:'Show everywhere',bannerImage:'/fairplay-dota2.jpg',category:'MOBA'},
  {id:'game-codm-mp',name:'CODM Multiplayer',registeredTeams:0,visibility:'Show everywhere',bannerImage:'/fairplay-codm.webp',category:'FPS'},
  {id:'game-codm-br',name:'CODM Battle Royale',registeredTeams:0,visibility:'Show everywhere',bannerImage:'/fairplay-codm.webp',category:'Battle Royale'},
];

export const INITIAL_TOURNAMENTS: Tournament[] = [
  {
    id: 'tourn-palaro-mlbb',
    title: 'Palaro 2026',
    subtitle: 'College showdown for the campus crown, streamed live every match day.',
    gameId: 'game-mlbb',
    gameName: 'Mobile Legends',
    format: 'double-elimination',
    matchFormat: 'Bo3',
    status: 'live',
    startDate: 'Jun 12',
    endDate: 'Jun 15',
    collegesCount: 8,
    bannerImage: mlbbBanner,
    isFeatured: true,
    currentStage: 'Quarterfinals',
  },
  {
    id: 'tourn-val-cup',
    title: 'Campus Valorant Cup',
    subtitle: 'Five-stack tactical shooter cup open to every college.',
    gameId: 'game-val',
    gameName: 'Valorant',
    format: 'single-elimination',
    matchFormat: 'Bo3',
    status: 'upcoming',
    startDate: 'Jun 18',
    endDate: 'Jun 20',
    collegesCount: 8,
    bannerImage: valorantBanner,
    isFeatured: false,
    currentStage: 'Registration open',
  },
  {
    id: 'tourn-lol-s4',
    title: 'Campus League Season 4',
    subtitle: 'Season-long league with groups into playoffs.',
    gameId: 'game-lol',
    gameName: 'League of Legends',
    format: 'round-robin',
    matchFormat: 'Bo1',
    status: 'upcoming',
    startDate: 'Jun 24',
    endDate: 'Jul 10',
    collegesCount: 12,
    bannerImage: lolBanner,
    isFeatured: false,
    currentStage: 'Check-in soon',
  },
];

export const INITIAL_MATCHES: Match[] = [
  {
    id: 'PAL-MLBB-48',
    matchNumber: '#PAL-MLBB-48',
    tournamentId: 'tourn-palaro-mlbb',
    gameId: 'game-mlbb',
    round: 2,
    roundName: 'Upper Bracket Semifinal',
    bracketType: 'upper',
    team1: INITIAL_TEAMS[0], // CCS Alpha
    team2: INITIAL_TEAMS[1], // COE Titans
    score: {
      team1Score: 0,
      team2Score: 1,
      gameScores: [{ team1: 0, team2: 1 }, { team1: 0, team2: 0 }],
    },
    status: 'live',
    matchFormat: 'Bo3',
    scheduledTime: '23:15',
    scheduledDate: 'Today',
    organizerName: 'M. Delos Reyes',
    liveTime: 'G2 · 08:42',
    streamTitle: 'MPL Philippines — Mobile Legends: Bang Bang Live Broadcast',
    streamUrl: 'https://www.youtube.com/embed/m4zQpYzzM0g?autoplay=1&rel=0&modestbranding=1',
    timelineEvents: [
      {
        time: '02:15',
        title: 'First Blood',
        type: 'first-blood',
        team: 'CCS',
        text: 'Riley (CCS, Jungler) secures First Blood on Bolt (COE) in river clash',
      },
      {
        time: '04:10',
        title: 'Tower Destroyed',
        type: 'tower',
        team: 'CCS',
        text: 'CCS destroys Bottom Outer Turret to claim First Turret gold',
      },
      {
        time: '05:35',
        title: 'Turtle Slain',
        type: 'objective',
        team: 'COE',
        text: 'COE secures first Turtle following a 3v2 contested river trade',
      },
      {
        time: '08:10',
        title: 'Lord/Baron Slain',
        type: 'lord',
        team: 'COE',
        text: 'COE steals Lord pit objective to breach CCS base and take Game 1',
      },
      {
        time: '11:45',
        title: 'Tower Destroyed',
        type: 'tower',
        team: 'CCS',
        text: 'CCS destroys Middle Tier-2 Turret after winning teamfight in Game 2',
      },
      {
        time: '14:20',
        title: 'Lord/Baron Slain',
        type: 'lord',
        team: 'CCS',
        text: 'Evolved Lord Slain by CCS behind Riley’s Ling smite contest',
      },
    ],
    mvp: {
      playerName: 'Riley Rust',
      ign: 'Riley',
      role: 'Jungler',
      teamCode: 'CCS',
      collegeName: 'College of Computing Studies',
      kda: '9 / 1 / 7',
      heroOrAgent: 'Ling',
      statsHighlight: '82% Kill Participation · 12.4k Gold',
    },
    playerStats: {
      'p1': { playerId: 'p1', ign: 'Riley', playerName: 'Riley Rust', teamCode: 'CCS', role: 'Jungler', kills: 9, deaths: 1, assists: 7, cs: 184, gold: '12.4k', damage: '42.8k' },
      'p2': { playerId: 'p2', ign: 'Kurt', playerName: 'Kurt Alonzo', teamCode: 'CCS', role: 'EXP Lane', kills: 3, deaths: 2, assists: 8, cs: 142, gold: '9.8k', damage: '26.4k' },
      'p3': { playerId: 'p3', ign: 'Rasheed', playerName: 'Rasheed Tan', teamCode: 'CCS', role: 'Gold Lane', kills: 6, deaths: 2, assists: 5, cs: 196, gold: '11.2k', damage: '38.1k' },
      'p4': { playerId: 'p4', ign: 'Kerr', playerName: 'Kerr Uy', teamCode: 'CCS', role: 'Mid Lane', kills: 4, deaths: 3, assists: 9, cs: 158, gold: '10.1k', damage: '31.5k' },
      'p5': { playerId: 'p5', ign: 'Raytheon', playerName: 'Raytheon Delos Reyes', teamCode: 'CCS', role: 'Roamer', kills: 1, deaths: 2, assists: 14, cs: 41, gold: '6.9k', damage: '14.2k' },
      'p6': { playerId: 'p6', ign: 'Bolt', playerName: 'Bolt Alvarez', teamCode: 'COE', role: 'Jungler', kills: 4, deaths: 5, assists: 3, cs: 153, gold: '9.4k', damage: '27.9k' },
      'p7': { playerId: 'p7', ign: 'Gearz', playerName: 'Gearz Mendoza', teamCode: 'COE', role: 'EXP Lane', kills: 2, deaths: 4, assists: 4, cs: 139, gold: '8.6k', damage: '21.0k' },
      'p8': { playerId: 'p8', ign: 'Torque', playerName: 'Torque Dela Cruz', teamCode: 'COE', role: 'Gold Lane', kills: 3, deaths: 4, assists: 2, cs: 170, gold: '9.9k', damage: '25.6k' },
      'p9': { playerId: 'p9', ign: 'Volt', playerName: 'Volt Sanchez', teamCode: 'COE', role: 'Mid Lane', kills: 1, deaths: 5, assists: 5, cs: 142, gold: '8.2k', damage: '22.3k' },
      'p10': { playerId: 'p10', ign: 'Rivet', playerName: 'Rivet Ramos', teamCode: 'COE', role: 'Roamer', kills: 0, deaths: 5, assists: 6, cs: 36, gold: '5.8k', damage: '10.5k' },
    },
  },
  {
    id: 'PAL-MLBB-49',
    matchNumber: '#PAL-MLBB-49',
    tournamentId: 'tourn-palaro-mlbb',
    gameId: 'game-mlbb',
    round: 2,
    roundName: 'Upper Bracket Semifinal',
    bracketType: 'upper',
    team1: INITIAL_TEAMS[2], // CN Lifeline
    team2: INITIAL_TEAMS[5], // CCJE Wardens
    score: { team1Score: 0, team2Score: 0 },
    status: 'upcoming',
    matchFormat: 'Bo3',
    scheduledTime: '11:15 PM',
    scheduledDate: 'Today',
    organizerName: 'M. Delos Reyes',
  },
  {
    id: 'PAL-VAL-52',
    matchNumber: '#PAL-VAL-52',
    tournamentId: 'tourn-val-cup',
    gameId: 'game-val',
    round: 1,
    roundName: 'Quarterfinal 2',
    bracketType: 'upper',
    team1: INITIAL_TEAMS[2], // CN
    team2: INITIAL_TEAMS[3], // CL
    score: { team1Score: 2, team2Score: 1 },
    status: 'completed',
    matchFormat: 'Bo3',
    scheduledTime: 'Final 2:1',
    scheduledDate: 'Completed',
    organizerName: 'J. Ortega',
    mvp: {
      playerName: 'Clara Santos',
      ign: 'Pulse',
      role: 'Duelist',
      teamCode: 'CN',
      collegeName: 'College of Nursing',
      kda: '24 / 11 / 4',
      heroOrAgent: 'Jett',
      statsHighlight: '348 ACS · 1v3 Match-Winning Clutch',
    },
    playerStats: {
      'p11': { playerId: 'p11', ign: 'Ysa', playerName: 'Ysa Lim', teamCode: 'CN', role: 'Jungler', kills: 18, deaths: 14, assists: 9, cs: 195, damage: '36.4k' },
      'p12': { playerId: 'p12', ign: 'Pulse', playerName: 'Clara Santos', teamCode: 'CN', role: 'EXP Lane', kills: 24, deaths: 11, assists: 4, cs: 210, damage: '44.8k' },
      'p13': { playerId: 'p13', ign: 'Syringe', playerName: 'Beatrice Go', teamCode: 'CN', role: 'Gold Lane', kills: 15, deaths: 12, assists: 11, cs: 205, damage: '32.1k' },
      'p14': { playerId: 'p14', ign: 'Ether', playerName: 'Denise Tan', teamCode: 'CN', role: 'Mid Lane', kills: 12, deaths: 13, assists: 14, cs: 178, damage: '29.7k' },
      'p15': { playerId: 'p15', ign: 'Saline', playerName: 'Florence Ramos', teamCode: 'CN', role: 'Roamer', kills: 3, deaths: 10, assists: 22, cs: 44, damage: '14.2k' },
      'p16': { playerId: 'p16', ign: 'Judge', playerName: 'Jonas Ferrer', teamCode: 'CL', role: 'Jungler', kills: 16, deaths: 15, assists: 8, cs: 188, damage: '33.2k' },
      'p17': { playerId: 'p17', ign: 'Juror', playerName: 'Lex Luthor', teamCode: 'CL', role: 'EXP Lane', kills: 13, deaths: 15, assists: 10, cs: 175, damage: '28.9k' },
      'p18': { playerId: 'p18', ign: 'Gavel', playerName: 'Gavel King', teamCode: 'CL', role: 'Gold Lane', kills: 17, deaths: 14, assists: 7, cs: 202, damage: '35.4k' },
      'p19': { playerId: 'p19', ign: 'Statute', playerName: 'Court Queen', teamCode: 'CL', role: 'Mid Lane', kills: 11, deaths: 16, assists: 12, cs: 169, damage: '27.1k' },
      'p20': { playerId: 'p20', ign: 'Bailiff', playerName: 'Plea Bargain', teamCode: 'CL', role: 'Roamer', kills: 3, deaths: 12, assists: 19, cs: 40, damage: '12.8k' },
    },
  },
  {
    id: 'PAL-MLBB-58',
    matchNumber: '#PAL-MLBB-58',
    tournamentId: 'tourn-palaro-mlbb',
    gameId: 'game-mlbb',
    round: 3,
    roundName: 'Upper Bracket Final',
    bracketType: 'upper',
    team1: INITIAL_TEAMS[1], // COE
    team2: INITIAL_TEAMS[3], // CL
    score: { team1Score: 0, team2Score: 0 },
    status: 'pre-match',
    matchFormat: 'Bo3',
    scheduledTime: 'Oct 9 · 4:00 PM',
    scheduledDate: 'Oct 9',
    organizerName: 'R. Rust',
  },
  {
    id: 'PAL-LOL-49',
    matchNumber: '#PAL-LOL-49',
    tournamentId: 'tourn-lol-s4',
    gameId: 'game-lol',
    round: 1,
    roundName: 'Group Stage Match',
    bracketType: 'upper',
    team1: { ...INITIAL_TEAMS[0], collegeCode: 'CLA', name: 'CLA Sentinels' },
    team2: { ...INITIAL_TEAMS[1], collegeCode: 'CED', name: 'CED Mentors' },
    score: { team1Score: 0, team2Score: 0 },
    status: 'alert',
    matchFormat: 'Bo1',
    scheduledTime: 'Oct 9 · 6:30 PM',
    scheduledDate: 'Oct 9',
    organizerName: 'A. Hassan',
  },
  {
    id: 'PAL-VAL-58',
    matchNumber: '#PAL-VAL-58',
    tournamentId: 'tourn-val-cup',
    gameId: 'game-val',
    round: 2,
    roundName: 'Lower Bracket Round 1',
    bracketType: 'lower',
    team1: INITIAL_TEAMS[5], // CCJE
    team2: INITIAL_TEAMS[7], // CA
    score: { team1Score: 0, team2Score: 0 },
    status: 'alert',
    matchFormat: 'Bo3',
    scheduledTime: 'Oct 10 · 2:00 PM',
    scheduledDate: 'Oct 10',
    organizerName: 'M. Delos Reyes',
  },
];

export const INITIAL_USERS: User[] = [
  {
    id: 'u1',
    name: 'Riley Rust',
    email: 'riley.rust@wmsu.edu.ph',
    role: 'organizer',
    status: 'active',
    collegeId: 'col-ccs',
    collegeName: 'College of Computing Studies',
    avatarInitials: 'RR',
    joinedDate: 'Aug 12',
  },
  {
    id: 'u2',
    name: 'Kurt Alonzo',
    email: 'kurt.alonzo@wmsu.edu.ph',
    role: 'player',
    status: 'active',
    collegeId: 'col-ccs',
    collegeName: 'College of Computing Studies',
    avatarInitials: 'KA',
    joinedDate: 'Aug 14',
  },
  {
    id: 'u3',
    name: 'Rasheed Tan',
    email: 'rasheed.tan@wmsu.edu.ph',
    role: 'player',
    status: 'active',
    collegeId: 'col-ccs',
    collegeName: 'College of Computing Studies',
    avatarInitials: 'RT',
    joinedDate: 'Aug 14',
  },
  {
    id: 'u4',
    name: 'Mika Delos Reyes',
    email: 'mika.dr@wmsu.edu.ph',
    role: 'moderator',
    status: 'active',
    collegeId: 'col-coe',
    collegeName: 'College of Engineering',
    avatarInitials: 'MD',
    joinedDate: 'Aug 20',
  },
  {
    id: 'u5',
    name: 'Jonas Ferrer',
    email: 'jonas.f@wmsu.edu.ph',
    role: 'spectator',
    status: 'suspended',
    collegeId: 'col-cl',
    collegeName: 'College of Law',
    avatarInitials: 'JF',
    joinedDate: 'Sep 02',
    suspendedUntil: 'Until Oct 12',
  },
  {
    id: 'u6',
    name: 'Ysa Lim',
    email: 'ysa.lim@wmsu.edu.ph',
    role: 'player',
    status: 'active',
    collegeId: 'col-cn',
    collegeName: 'College of Nursing',
    avatarInitials: 'YL',
    joinedDate: 'Sep 04',
  },
  {
    id: 'u7',
    name: 'toxic.tito',
    email: 'tito.r@wmsu.edu.ph',
    role: 'spectator',
    status: 'banned',
    collegeId: 'col-ccje',
    collegeName: 'College of Criminal Justice Education',
    avatarInitials: 'TT',
    joinedDate: 'Sep 19',
  },
  {
    id: 'u8',
    name: 'Mara Santos',
    email: 'mara.s@wmsu.edu.ph',
    role: 'player',
    status: 'active',
    collegeId: 'col-cla',
    collegeName: 'College of Liberal Arts',
    avatarInitials: 'MS',
    joinedDate: 'Sep 21',
  },
  {
    id: 'u9',
    name: 'Dean Abubakar',
    email: 'dean.a@wmsu.edu.ph',
    role: 'school-admin',
    status: 'active',
    collegeId: 'col-ca',
    collegeName: 'College of Architecture',
    avatarInitials: 'DA',
    joinedDate: 'Jul 30',
  },
];

export const INITIAL_REPORTS: ContentReport[] = [
  {
    id: 'R-221',
    type: 'HARASSMENT',
    contentType: 'Chat message',
    contentSnippet: 'uninstall the game you\'re trash lmao',
    postedBy: 'toxic.tito',
    reportedBy: 'Ysa Lim',
    timeAgo: '2m ago',
    flagCount: 4,
    status: 'open',
  },
  {
    id: 'R-220',
    type: 'SPAM / SCAM',
    contentType: 'Post',
    contentSnippet: 'Selling Palaro finals tickets cheap, DM me',
    postedBy: 'Jonas Ferrer',
    reportedBy: 'Mika Delos Reyes',
    timeAgo: '18m ago',
    flagCount: 2,
    status: 'open',
  },
  {
    id: 'R-219',
    type: 'STOLEN CONTENT',
    contentType: 'Highlight',
    contentSnippet: '[Clip] CCS vs COE — G2 Lord steal (re-upload, no credit)',
    postedBy: 'clipz.ph',
    reportedBy: 'Riley Rust',
    timeAgo: '1h ago',
    flagCount: 1,
    status: 'open',
  },
  {
    id: 'R-218',
    type: 'MISINFORMATION',
    contentType: 'Comment',
    contentSnippet: 'ref is bought lol',
    postedBy: 'Kerr Uy',
    reportedBy: 'Mara Santos',
    timeAgo: '3h ago',
    flagCount: 1,
    status: 'open',
  },
];

export const INITIAL_AUDIT_LOGS: AuditLogItem[] = [
  {
    id: 'a1',
    actor: 'Riley Rust',
    action: 'published bracket "Valorant - Single elimination"',
    timestamp: '10m ago',
  },
  {
    id: 'a2',
    actor: 'Mika Delos Reyes',
    action: 'muted toxic.tito for 24h',
    timestamp: '25m ago',
  },
  {
    id: 'a3',
    actor: 'Dean Abubakar',
    action: 'changed school theme to WMSU Crimson & Gold',
    timestamp: '1h ago',
  },
  {
    id: 'a4',
    actor: 'Riley Rust',
    action: 'featured "Palaro 2026 — Mobile Legends"',
    timestamp: '3h ago',
  },
];

export const INITIAL_CHAT_MESSAGES: ChatMessage[] = [
  {
    id: 'c1',
    matchId: 'PAL-MLBB-48',
    userId: 'u4',
    userName: 'Mika J.',
    userInitials: 'MJ',
    userRole: 'moderator',
    text: 'What a comeback from Engineering!',
    timestamp: '23:10',
  },
  {
    id: 'c2',
    matchId: 'PAL-MLBB-48',
    userId: 'u2',
    userName: 'Ken L.',
    userInitials: 'KL',
    userRole: 'player',
    text: 'That final clash was perfectly timed.',
    timestamp: '23:11',
  },
  {
    id: 'c3',
    matchId: 'PAL-MLBB-48',
    userId: 'u6',
    userName: 'Ana P.',
    userInitials: 'AP',
    userRole: 'spectator',
    text: 'Game 3 please!',
    timestamp: '23:13',
  },
];
