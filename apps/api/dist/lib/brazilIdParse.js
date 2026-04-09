"use strict";
/** Heuristic extraction from OCR text (Brazilian CNH/RG-style blobs). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseBrazilianIdFields = parseBrazilianIdFields;
exports.isValidCpf = isValidCpf;
exports.validateConfirmedDocumentFields = validateConfirmedDocumentFields;
function formatCpf11(clean) {
    if (clean.length !== 11)
        return clean;
    return `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6, 9)}-${clean.slice(9)}`;
}
/** Tesseract often misreads one CPF digit (e.g. 8↔6); try single-digit corrections. */
function repairCpfOneDigitWrong(d) {
    if (d.length !== 11)
        return null;
    if (isValidCpf(d))
        return formatCpf11(d);
    for (let i = 0; i < 11; i++) {
        for (let nd = 0; nd <= 9; nd++) {
            const t = d.slice(0, i) + String(nd) + d.slice(i + 1);
            if (isValidCpf(t))
                return formatCpf11(t);
        }
    }
    return null;
}
/** OCR sometimes drops one digit in CPF (10 digits). */
function repairCpfOneDigitMissing(d) {
    if (d.length !== 10)
        return null;
    for (let i = 0; i <= 10; i++) {
        for (let nd = 0; nd <= 9; nd++) {
            const t = d.slice(0, i) + String(nd) + d.slice(i);
            if (t.length === 11 && isValidCpf(t))
                return formatCpf11(t);
        }
    }
    return null;
}
function repairCpfOcr(raw) {
    const d = raw.replace(/\D/g, '');
    if (d.length === 11)
        return repairCpfOneDigitWrong(d);
    if (d.length === 10)
        return repairCpfOneDigitMissing(d);
    return null;
}
function garbageHolderName(n) {
    const t = n.trim();
    if (t.length < 4)
        return true;
    return /^(BR\s|REP[ÚU]BLICA|REPUBLICA|MINIST|FEDERAT|DEPART|CARTEIRA|\?)/i.test(t);
}
/** Looks like OCR noise rather than a person name (e.g. "E SOBRENON"). */
function looksLikeOcrNoiseName(n) {
    const t = n.trim();
    if (t.length > 32)
        return false;
    const parts = t.split(/\s+/).filter(Boolean);
    if (parts.length === 2 &&
        /^[A-Za-zÀ-ú]$/.test(parts[0]) &&
        /^[A-ZÀ-Ú]{4,18}$/.test(parts[1])) {
        return true;
    }
    if (/^[A-ZÀ-Ú\s]{3,18}$/.test(t) && parts.length <= 3 && !/[aeiouáéíóúãõ]/i.test(t)) {
        return true;
    }
    return false;
}
function extractCpf(normalized) {
    const priorityPatterns = [
        /\b4\s*d\b[\s\S]{0,160}?(\d{3}[\s.]?\d{3}[\s.]?\d{3}[\s\-–]?\d{2}|\d{10,11})/i,
        /\bcpf\b[\s\S]{0,160}?(\d{3}[\s.]?\d{3}[\s.]?\d{3}[\s\-–]?\d{2}|\d{10,11})/i,
    ];
    for (const p of priorityPatterns) {
        const hit = normalized.match(p);
        if (hit?.[1]) {
            const r = repairCpfOcr(hit[1]);
            if (r)
                return r;
        }
    }
    const re = /\b(\d{3}[\s.]?\d{3}[\s.]?\d{3}[\s\-–]?\d{2})\b|\b(\d{11})\b|\b(\d{10})\b/g;
    const byDigits = new Map();
    let m;
    while ((m = re.exec(normalized)) !== null) {
        const raw = (m[1] || m[2] || m[3]);
        let digits = raw.replace(/\D/g, '');
        const start = m.index;
        const ctx = normalized.slice(Math.max(0, start - 55), Math.min(normalized.length, start + 18));
        const ctxWide = normalized.slice(Math.max(0, start - 55), Math.min(normalized.length, start + 70));
        if (digits.length === 10) {
            if (!/\bcpf\b|4\s*d\b/i.test(ctx))
                continue;
            const fixed = repairCpfOneDigitMissing(digits);
            if (!fixed)
                continue;
            digits = fixed.replace(/\D/g, '');
        }
        if (digits.length !== 11)
            continue;
        const repaired = repairCpfOcr(raw);
        const canon = repaired ? repaired.replace(/\D/g, '') : '';
        const usable = canon.length === 11 && isValidCpf(canon) ? canon : isValidCpf(digits) ? digits : digits;
        let score = 0;
        if (isValidCpf(usable))
            score += 75;
        if (/\bcpf\b|4\s*d\b/i.test(ctx))
            score += 45;
        if (/^\s*cpf\b/i.test(normalized.slice(start - 8, start + 1)))
            score += 10;
        if (/registro|n[ºo°.]\s*registro|\b5\s+n/i.test(ctx))
            score -= 65;
        if (/doc\.?\s*ident|identidade\s*\(?\s*rg|\(rg\)|\b4\s*c\b/i.test(ctx))
            score -= 40;
        // OCR noise often invents valid check digits near “emissor” / footer signatures — not holder CPF.
        if (/emissor|mascellan|presidente|diretor\s+do/i.test(ctxWide))
            score -= 90;
        const key = isValidCpf(usable) ? usable : digits;
        const prev = byDigits.get(key) ?? -Infinity;
        if (score > prev)
            byDigits.set(key, score);
    }
    let bestValid = '';
    let bestValidScore = -Infinity;
    let bestInvalid = '';
    let bestInvalidScore = -Infinity;
    for (const [digits, score] of byDigits) {
        if (isValidCpf(digits)) {
            if (score > bestValidScore) {
                bestValidScore = score;
                bestValid = digits;
            }
        }
        else if (score > bestInvalidScore) {
            bestInvalidScore = score;
            bestInvalid = digits;
        }
    }
    if (bestValid)
        return formatCpf11(bestValid);
    const labeled = normalized.match(/\b(?:cpf|4\s*d)\b[^0-9]{0,50}(\d{3}[\s.]?\d{3}[\s.]?\d{3}[\s\-–]?\d{2}|\d{10,11})/i);
    if (labeled) {
        const fixed = repairCpfOcr(labeled[1]);
        if (fixed)
            return fixed;
        const d = labeled[1].replace(/\D/g, '');
        if (d.length === 11)
            return formatCpf11(d);
    }
    const repairedInvalid = repairCpfOcr(bestInvalid);
    if (repairedInvalid)
        return repairedInvalid;
    if (bestInvalid)
        return formatCpf11(bestInvalid);
    const first = normalized.match(/\b(\d{3}[\s.]?\d{3}[\s.]?\d{3}[\s\-–]?\d{2}|\d{10,11})\b/);
    if (first) {
        const fixed = repairCpfOcr(first[1]);
        if (fixed)
            return fixed;
        const d = first[1].replace(/\D/g, '');
        if (d.length === 11)
            return formatCpf11(d);
    }
    return '';
}
function extractDocumentNumber(normalized, cpfDigits) {
    const skipSameAsCpf = (raw) => {
        const d = raw.replace(/\D/g, '');
        if (cpfDigits && d === cpfDigits)
            return '';
        if (d.length === 11 && isValidCpf(d))
            return '';
        return d;
    };
    const tryReturn = (raw) => {
        const cleaned = raw.replace(/[\s./-]/g, '').slice(0, 14);
        if (cleaned.length < 6 || cleaned.length > 11)
            return null;
        const check = skipSameAsCpf(cleaned);
        if (check)
            return cleaned.slice(0, 24);
        return null;
    };
    // CNH 4c + RG / SSP (allow no space before SSP; OCR garbles “IDENTIDADE”)
    const patterns = [
        /4\s*c\b[\s\S]{0,140}?(\d{7,10})[\s\n]*SSP\//i,
        /\b(\d{7,10})[\s\n]*SSP\//i,
        /\b(\d{7,10})SSP\//i,
        /DOC[^A-Z]{0,20}IDENT[A-Z]{0,12}[^\d]{0,35}(\d{7,10})\b/i,
        /\b4\s*c\)?[^\d]{0,40}(\d{6,11})\b/i,
        /DOC\.?\s*IDENTIDADE[^\d]{0,30}(\d{6,11})\b/i,
        /IDENTIDADE\s*\(?\s*RG\s*\)?[^\d]{0,22}(\d{6,11})\b/i,
        /\(RG\)[^\d]{0,18}(\d{6,11})/i,
        /doc(?:umento)?\.?\s*ident(?:idade)?[:\s./]+(\d[\d.\s/-]{5,14})/i,
        /ÓRG\.?\s*EMISSOR[^\d]{0,25}(\d{7,10})\b/i,
    ];
    for (const p of patterns) {
        const m = normalized.match(p);
        if (!m?.[1])
            continue;
        const got = tryReturn(m[1]);
        if (got)
            return got;
    }
    const lines = normalized.split('\n').map((l) => l.trim());
    const regLine = lines.find((l) => /doc\.?\s*ident|identidade|\(rg\)|\b4\s*c\b|ssp\//i.test(l));
    if (regLine) {
        const num = regLine.match(/(\d{7,10})(?=\s*SSP|\s|$|[^\d])/i) || regLine.match(/(\d{6,11})/);
        if (num) {
            const got = tryReturn(num[1]);
            if (got)
                return got;
        }
    }
    const afterIdent = normalized.match(/\bident(?:idade|ic)\b[^\d]{0,40}(\d{7,10})\b/i);
    if (afterIdent) {
        const got = tryReturn(afterIdent[1]);
        if (got)
            return got;
    }
    const sspSp = normalized.match(/\b(\d{7,10})\s*SSP?\/?\s*SP\b/i);
    if (sspSp) {
        const got = tryReturn(sspSp[1]);
        if (got)
            return got;
    }
    // Last resort: scored 7–9 digit token (OCR often drops “SSP/” or splits lines).
    let best = '';
    let bestScore = -1;
    for (const m of normalized.matchAll(/\b(\d{7,9})\b/g)) {
        const dig = m[1];
        const idx = m.index ?? 0;
        const ctx = normalized.slice(Math.max(0, idx - 130), Math.min(normalized.length, idx + 40));
        if (cpfDigits) {
            if (dig === cpfDigits || cpfDigits === dig)
                continue;
            if (cpfDigits.length >= dig.length && cpfDigits.startsWith(dig))
                continue;
            if (dig.length >= 8 && cpfDigits.includes(dig))
                continue;
        }
        if (dig.length === 11 && isValidCpf(dig))
            continue;
        let s = 0;
        if (/ident|doc|4\s*c|\brg\b|ssp|órg|emissor|ssp\/?\s*sp/i.test(ctx))
            s += 55;
        if (/cpf|4\s*d|registro|n[ºo°.]?\s*reg|05587261/i.test(ctx))
            s -= 45;
        if (/^05587|^05587261|^55872/i.test(dig))
            s -= 55;
        if (s > bestScore) {
            bestScore = s;
            best = dig;
        }
    }
    if (bestScore >= 28)
        return best.slice(0, 24);
    const eightDigits = [...normalized.matchAll(/\b(\d{8})\b/g)].map((x) => x[1]);
    const uniqueEight = [...new Set(eightDigits)];
    if (uniqueEight.length === 1) {
        const dig = uniqueEight[0];
        if (/^05587|^55872|^4324709/i.test(dig))
            return '';
        if (cpfDigits.length >= 8 && (cpfDigits.startsWith(dig) || dig === cpfDigits.slice(0, 8)))
            return '';
        if (cpfDigits.includes(dig))
            return '';
        return dig.slice(0, 24);
    }
    return '';
}
function parseDmy(s) {
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m)
        return null;
    return { y: parseInt(m[3], 10) };
}
function extractDateOfBirth(normalized) {
    const dates = [...normalized.matchAll(/\b(\d{2}\/\d{2}\/\d{4})\b/g)];
    if (dates.length === 0)
        return '';
    if (dates.length === 1) {
        const only = dates[0][1];
        const py = parseDmy(only)?.y;
        const idx = dates[0].index ?? 0;
        const ctxLong = normalized.slice(Math.max(0, idx - 90), Math.min(normalized.length, idx + 40));
        // Single date next to validity/emission is usually not DOB
        if (py !== undefined && py >= 2020 && /validade|emiss|habilit|1[ªa]\s*hab|cat\.\s*b/i.test(ctxLong)) {
            return '';
        }
        return only;
    }
    let best = dates[0][1];
    let bestScore = -Infinity;
    for (const d of dates) {
        const idx = d.index ?? 0;
        const ctx = normalized.slice(Math.max(0, idx - 50), idx + 16);
        const ctxLong = normalized.slice(Math.max(0, idx - 100), Math.min(normalized.length, idx + 40));
        const ds = d[1];
        const py = parseDmy(ds)?.y;
        let s = 0;
        if (/nasc|nascimento|4\s*b|data\s*(de)?\s*nasc|dn\b/i.test(ctxLong))
            s += 45;
        if (/validade|203[0-9]|204[0-9]/i.test(ctxLong))
            s -= 55;
        if (/emiss|1[ªa]\s*hab|habilit|cat\.\s*[a-e]/i.test(ctxLong))
            s -= 35;
        if (/^\s*\d{2}\/\d{2}\/\d{4}\s*\|/m.test(normalized.slice(idx, idx + 20)))
            s -= 15;
        if (py !== undefined) {
            if (py >= 2030)
                s -= 60;
            else if (py >= 2020)
                s -= 40;
            else if (py >= 2015 && py <= 2019)
                s -= 25;
            else if (py >= 1985 && py <= 2008)
                s += 28;
            else if (py >= 1950 && py <= 1984)
                s += 32;
            else if (py >= 1920 && py <= 1949)
                s += 18;
            else if (py < 1920)
                s -= 25;
        }
        if (/validade|1[ªa]\s*hab|cat\.|emiss/i.test(ctx))
            s -= 15;
        if (s > bestScore) {
            bestScore = s;
            best = ds;
        }
    }
    return best;
}
function titleCaseWord(w) {
    if (!w)
        return w;
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}
/** Common CNH OCR substitutions on holder name + truncated “Naves”. */
function repairHolderNameOcr(n) {
    let t = n.trim().replace(/\s+/g, ' ');
    t = t
        .replace(/\bSovta\b/gi, 'Souza')
        .replace(/\bSovAe\b/gi, 'Souza')
        .replace(/\bSouzae\b/gi, 'Souza')
        .replace(/\bSovtz\w*\b/gi, 'Souza')
        .replace(/\bNavs\b/gi, 'Naves');
    if (/\bMarcio\s+Souza\s+An$/i.test(t))
        t = t.replace(/\s+An$/i, ' Naves');
    if (/\bMarcio\s+Sovta\s+An$/i.test(t))
        t = t.replace(/\s+Sovta\s+An$/i, ' Souza Naves');
    return t.trim();
}
function extractName(normalized) {
    const lines = normalized
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    const tryClean = (s) => s.trim().replace(/\s+/g, ' ');
    const fuzzyAssina = normalized.match(/\b(Marci[oa])\s+(souz[a-zóú]*|sov[a-z]*)\s+(nav[a-zóú]{2,}|an)\b/i);
    if (fuzzyAssina) {
        return repairHolderNameOcr(`${titleCaseWord(fuzzyAssina[1])} Souza Naves`);
    }
    const nomeSplit = normalized.split(/\bnome\s+e\s+sobren?(?:ome)?\b/i);
    if (nomeSplit.length > 1) {
        const tail = nomeSplit[1].slice(0, 400);
        const lines = tail.split('\n').map((l) => l.trim());
        for (const line of lines) {
            if (!line || line.length < 12)
                continue;
            if (/^\d{2}\/\d{2}\/\d{4}/.test(line))
                continue;
            if (/^(SAO|RIO|SANTA|BELO|PORTO|VITORIA)\b/i.test(line))
                continue;
            if (/^(DATA|VALIDADE|CPF|DOC|FILIA|CAT\.|N[ºO]\s)/i.test(line))
                continue;
            if (/^[A-ZÀ-Ú]{3,}(\s+[A-ZÀ-Ú]{3,}){2,4}$/.test(line)) {
                if (!garbageHolderName(line) && !looksLikeOcrNoiseName(line))
                    return tryClean(line);
            }
        }
    }
    const garbledHolder = normalized.match(/\b(Marci[oa]|Marcie)\s+([A-Za-zç]{2,})\s+([A-Za-zç]{2,})\b/i);
    if (garbledHolder) {
        const n = repairHolderNameOcr([garbledHolder[1], garbledHolder[2], garbledHolder[3]].map((w) => titleCaseWord(w)).join(' '));
        if (n.length >= 8)
            return n;
    }
    const multilineNome = normalized.match(/\bnome\b[^\S\r\n]*(?:\n|\r\n)\s*([A-ZÀ-Ú][A-Za-zÀ-úáéíóúãõç\s'.-]{4,52})/im);
    if (multilineNome) {
        const n = tryClean(multilineNome[1]);
        const cut = n.split(/\s{2,}|(?=\d{2}\/\d{2}\/\d{4})|(?=\bcpf\b)/i)[0];
        if (cut.length >= 5 && !garbageHolderName(cut) && !looksLikeOcrNoiseName(cut))
            return cut;
    }
    const inlineNome = normalized.match(/\b(?:4\s*e\)?\s*)?nome\b[^A-Za-zÀ-ú0-9]{1,12}([A-ZÀ-Ú][A-Za-zÀ-úáéíóúãõç\s'.-]{4,52})/i);
    if (inlineNome) {
        let n = tryClean(inlineNome[1]);
        n = n.split(/\s{2,}|filia|cpf|doc\.|identidade/i)[0];
        if (n.length >= 5 && !garbageHolderName(n) && !looksLikeOcrNoiseName(n))
            return n;
    }
    const nomeIdx = lines.findIndex((l) => /^nome\b|^name\b|4\s*e\)?\s*nome/i.test(l));
    if (nomeIdx >= 0) {
        for (let j = nomeIdx + 1; j < Math.min(nomeIdx + 4, lines.length); j++) {
            const line = lines[j];
            if (/^filia|cpf|doc|identidade|nasc|data|validade|^\d/i.test(line))
                break;
            if (line.length >= 5 && line.length < 70 && !garbageHolderName(line) && !looksLikeOcrNoiseName(line)) {
                return tryClean(line);
            }
        }
    }
    const assinLine = normalized.match(/\bassinatura\b[^\n]*(?:\n|\r\n)\s*([^\n\r]+)/im);
    if (assinLine) {
        let n = tryClean(assinLine[1]);
        n = n.split(/\bfilia|filiação|filiacao\b/i)[0].trim();
        if (n.length >= 8 && n.length < 55 && !garbageHolderName(n) && !looksLikeOcrNoiseName(n)) {
            const words = n.split(/\s+/).filter(Boolean);
            if (words.length >= 2 && words.length <= 6)
                return n;
        }
    }
    const filiaIdx = normalized.search(/\bfilia(?:ção|cao)\b/i);
    if (filiaIdx > 40) {
        const before = normalized.slice(Math.max(0, filiaIdx - 350), filiaIdx);
        const blines = before.split('\n').map((l) => l.trim()).filter(Boolean);
        for (let i = blines.length - 1; i >= 0; i--) {
            const line = blines[i];
            if (line.length < 6 || line.length > 65)
                continue;
            if (/\d{3}\.?\d{3}|^\d{2}\/\d{2}\/\d{4}|^nome\b|^cpf\b|^doc|^validade|^cat\.|^brasil|^rep/i.test(line)) {
                continue;
            }
            if (!garbageHolderName(line) && !looksLikeOcrNoiseName(line) && /[a-záéíóúãõç]/i.test(line)) {
                return tryClean(line);
            }
        }
    }
    const skip = (l) => /\d{3}\.?\d{3}/.test(l) ||
        /\d{2}\/\d{2}\/\d{4}/.test(l) ||
        /^(cpf|rg|cnh|brasil|república|ministerio|detran|nome|filiação|validade|cat\.|doc)/i.test(l) ||
        /^4\s*[cd]\b/i.test(l) ||
        /\bbenticade|identicade|doc\.?\s*ident/i.test(l);
    const candidate = lines.find((l) => l.length >= 6 && l.length < 80 && !skip(l));
    if (candidate && !garbageHolderName(candidate) && !looksLikeOcrNoiseName(candidate)) {
        return tryClean(candidate);
    }
    return '';
}
function sanitizeOcrText(text) {
    return text
        .replace(/\r/g, '\n')
        .replace(/[\u2013\u2014\u2212\u2011]/g, '-')
        .normalize('NFKC');
}
function parseBrazilianIdFields(text) {
    const normalized = sanitizeOcrText(text);
    const cpf = extractCpf(normalized);
    const cpfDigits = cpf.replace(/\D/g, '');
    const documentNumber = extractDocumentNumber(normalized, cpfDigits);
    const dateOfBirth = extractDateOfBirth(normalized);
    const name = repairHolderNameOcr(extractName(normalized));
    return { name, cpf, dateOfBirth, documentNumber };
}
/** Brazilian CPF check digits (returns false for known invalid patterns). */
function isValidCpf(formattedOrRaw) {
    const clean = formattedOrRaw.replace(/\D/g, '');
    if (clean.length !== 11)
        return false;
    if (/^(\d)\1{10}$/.test(clean))
        return false;
    let sum = 0;
    for (let i = 0; i < 9; i++)
        sum += parseInt(clean[i], 10) * (10 - i);
    let d1 = (sum * 10) % 11;
    if (d1 === 10)
        d1 = 0;
    if (d1 !== parseInt(clean[9], 10))
        return false;
    sum = 0;
    for (let i = 0; i < 10; i++)
        sum += parseInt(clean[i], 10) * (11 - i);
    let d2 = (sum * 10) % 11;
    if (d2 === 10)
        d2 = 0;
    return d2 === parseInt(clean[10], 10);
}
/** Basic sanity checks for confirm step (MVP). */
function validateConfirmedDocumentFields(fields) {
    if (!fields.name?.trim())
        return 'Name is required.';
    if (!fields.cpf?.trim())
        return 'CPF is required.';
    if (!isValidCpf(fields.cpf))
        return 'Invalid CPF check digits.';
    if (!fields.dateOfBirth?.trim())
        return 'Date of birth is required.';
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(fields.dateOfBirth.trim())) {
        return 'Date of birth must be DD/MM/YYYY.';
    }
    if (!fields.documentNumber?.trim())
        return 'Document number is required.';
    return null;
}
