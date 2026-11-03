// GSTIN structure: SS PPPPPPPPPP E Z C
//   SS          state code 01-38
//   PPPPPPPPPP  PAN of the holder (AAAAA9999A)
//   E           entity number for the same PAN in the state (1-9, A-Z)
//   Z           default 'Z'
//   C           check character: base-36 "mod 36" weighted checksum over the first 14 chars
const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARSET.indexOf(first14[i]);
    if (v < 0) throw new Error(`Invalid character '${first14[i]}'`);
    const factor = i % 2 === 0 ? 1 : 2; // weights alternate 1,2 from the left
    const product = v * factor;
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET[(36 - (sum % 36)) % 36];
}

export function gstinWithChecksum(first14: string): string {
  return first14 + gstinCheckChar(first14);
}

export interface GstinCheck {
  ok: boolean;
  problems: string[];
  state_code?: string;
  pan?: string;
  expected_check?: string;
}

export function checkGstinFormat(raw: string | null | undefined): GstinCheck {
  const problems: string[] = [];
  if (!raw) return { ok: false, problems: ["GSTIN missing"] };
  const g = raw.trim().toUpperCase();
  if (g.length !== 15) return { ok: false, problems: [`Length is ${g.length}, expected 15`] };
  if (![...g].every((c) => CHARSET.includes(c))) return { ok: false, problems: ["Contains characters other than A-Z and 0-9"] };
  const state = g.slice(0, 2);
  const stateNum = Number(state);
  if (!/^\d\d$/.test(state) || stateNum < 1 || stateNum > 38) problems.push(`State code ${state} is not between 01 and 38`);
  const pan = g.slice(2, 12);
  if (!PAN_RE.test(pan)) problems.push(`Characters 3-12 (${pan}) do not follow the PAN pattern AAAAA9999A`);
  if (!/[1-9A-Z]/.test(g[12])) problems.push("Entity number (char 13) must be 1-9 or A-Z");
  if (g[13] !== "Z") problems.push("Char 14 should be 'Z'");
  let expected: string | undefined;
  try {
    expected = gstinCheckChar(g.slice(0, 14));
    if (expected !== g[14]) problems.push(`Check character is ${g[14]}, expected ${expected}`);
  } catch (e) {
    problems.push(String(e));
  }
  return { ok: problems.length === 0, problems, state_code: state, pan, expected_check: expected };
}

export const STATE_NAMES: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
  "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
  "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya",
  "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "26": "Dadra & Nagar Haveli and Daman & Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa",
  "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman & Nicobar",
  "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
};
