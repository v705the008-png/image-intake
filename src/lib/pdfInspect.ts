import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  decodePDFRawStream,
  type PDFDocument,
  type PDFObject,
} from 'pdf-lib';
import type { PdfRaster } from './types';

/**
 * PDF の1ページ目に埋め込まれた画像の解像度を調べる。
 *
 * ページの描画命令（コンテンツストリーム）を読み、画像を描く命令（Do）の時点の変換行列から
 * 「その画像が紙面上で何pt の大きさに描かれているか」を求め、画像の画素数と比べて ppi を出す。
 * フォーム XObject（入れ子の部品）の中も追う。AI で作った画像を PDF にしたもの（全面に1枚）が主な対象。
 */

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** PDF の行列の掛け算（新しい CTM = m × n） */
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];

/** 巨大なベクター PDF で時間をかけすぎないための上限 */
const MAX_CONTENT_BYTES = 64 * 1024 * 1024;
const MAX_DEPTH = 6;
/** 紙面のこの割合以上を占める画像だけを判定に使う（小さなロゴやアイコンで全体を「低解像度」にしない） */
const SIGNIFICANT_AREA = 0.15;

type Drawn = { pxW: number; pxH: number; wPt: number; hPt: number };

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([...'()<>[]{}/%'].map((c) => c.charCodeAt(0)));

function decode(obj: PDFObject | undefined): Uint8Array | null {
  return obj instanceof PDFRawStream ? decodePDFRawStream(obj).decode() : null;
}

function numberOf(doc: PDFDocument, v: PDFObject | undefined): number {
  const o = v ? doc.context.lookup(v) : undefined;
  return o instanceof PDFNumber ? o.asNumber() : 0;
}

function walk(
  doc: PDFDocument,
  bytes: Uint8Array,
  resources: PDFDict | undefined,
  base: Matrix,
  depth: number,
  out: Drawn[],
  budget: { bytes: number },
) {
  budget.bytes += bytes.length;
  if (budget.bytes > MAX_CONTENT_BYTES) throw new Error('コンテンツが大きすぎます');

  const xobjRaw = resources?.get(PDFName.of('XObject'));
  const xobjects = xobjRaw ? doc.context.lookup(xobjRaw) : undefined;
  const s = Buffer.from(bytes).toString('latin1');
  const n = s.length;
  const stack: Matrix[] = [];
  const operands: (number | string)[] = [];
  let ctm = base;
  let i = 0;

  const drawXObject = (name: string) => {
    if (!(xobjects instanceof PDFDict)) return;
    const ref = xobjects.get(PDFName.of(name));
    const x = ref ? doc.context.lookup(ref) : undefined;
    if (!(x instanceof PDFRawStream)) return;
    const subtype = x.dict.get(PDFName.of('Subtype'));
    if (subtype === PDFName.of('Image')) {
      out.push({
        pxW: numberOf(doc, x.dict.get(PDFName.of('Width'))),
        pxH: numberOf(doc, x.dict.get(PDFName.of('Height'))),
        // 画像は 1×1 の正方形に描かれるので、変換行列の各軸の長さがそのまま紙面上の大きさ（pt）
        wPt: Math.hypot(ctm[0], ctm[1]),
        hPt: Math.hypot(ctm[2], ctm[3]),
      });
    } else if (subtype === PDFName.of('Form') && depth < MAX_DEPTH) {
      const mRaw = x.dict.get(PDFName.of('Matrix'));
      const mArr = mRaw ? doc.context.lookup(mRaw) : undefined;
      const fm =
        mArr instanceof PDFArray && mArr.size() === 6
          ? (mArr.asArray().map((v) => numberOf(doc, v)) as Matrix)
          : IDENTITY;
      const resRaw = x.dict.get(PDFName.of('Resources'));
      const res = resRaw ? doc.context.lookup(resRaw) : undefined;
      const inner = decode(x);
      if (inner) walk(doc, inner, res instanceof PDFDict ? res : resources, mul(fm, ctm), depth + 1, out, budget);
    }
  };

  while (i < n) {
    const c = s.charCodeAt(i);
    if (WS.has(c)) {
      i++;
      continue;
    }
    if (c === 37) {
      // % コメント
      while (i < n && s.charCodeAt(i) !== 10 && s.charCodeAt(i) !== 13) i++;
      continue;
    }
    if (c === 40) {
      // ( 文字列 ) — 入れ子とエスケープを考慮して飛ばす
      let d = 1;
      i++;
      while (i < n && d > 0) {
        const ch = s.charCodeAt(i);
        if (ch === 92) i += 2;
        else {
          if (ch === 40) d++;
          else if (ch === 41) d--;
          i++;
        }
      }
      operands.push('(str)');
      continue;
    }
    if (c === 60) {
      if (s.charCodeAt(i + 1) === 60) {
        i += 2;
        operands.push('<<');
      } else {
        const j = s.indexOf('>', i);
        i = j < 0 ? n : j + 1;
        operands.push('<hex>');
      }
      continue;
    }
    if (c === 62) {
      i += s.charCodeAt(i + 1) === 62 ? 2 : 1;
      continue;
    }
    if (c === 91 || c === 93 || c === 123 || c === 125) {
      i++;
      continue;
    }
    if (c === 47) {
      let j = i + 1;
      while (j < n && !WS.has(s.charCodeAt(j)) && !DELIM.has(s.charCodeAt(j))) j++;
      operands.push('/' + s.slice(i + 1, j));
      i = j;
      continue;
    }
    let j = i;
    while (j < n && !WS.has(s.charCodeAt(j)) && !DELIM.has(s.charCodeAt(j))) j++;
    if (j === i) {
      i++;
      continue;
    }
    const tok = s.slice(i, j);
    i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) {
      operands.push(Number(tok));
      continue;
    }
    switch (tok) {
      case 'q':
        stack.push(ctm);
        break;
      case 'Q':
        ctm = stack.pop() ?? base;
        break;
      case 'cm': {
        const m = operands.slice(-6);
        if (m.length === 6 && m.every((v) => typeof v === 'number')) ctm = mul(m as Matrix, ctm);
        break;
      }
      case 'Do': {
        const name = operands[operands.length - 1];
        if (typeof name === 'string' && name.startsWith('/')) drawXObject(name.slice(1));
        break;
      }
      case 'BI': {
        // インライン画像：ID のあとのバイナリを、前後が空白の EI まで飛ばす
        const id = s.indexOf('ID', i);
        let k = id < 0 ? -1 : s.indexOf('EI', id + 3);
        while (k >= 0 && !(WS.has(s.charCodeAt(k - 1)) && (k + 2 >= n || WS.has(s.charCodeAt(k + 2))))) {
          k = s.indexOf('EI', k + 2);
        }
        i = k < 0 ? n : k + 2;
        break;
      }
      default:
        break;
    }
    operands.length = 0;
  }
}

/** 1ページ目の画像の解像度。読めなかったときは undefined（受付は止めない） */
export function inspectPdfRaster(doc: PDFDocument): PdfRaster | undefined {
  try {
    const page = doc.getPage(0);
    const { width: pw, height: ph } = page.getSize();
    const { Resources, Contents } = page.node.normalizedEntries();
    const parts = Contents instanceof PDFArray ? Contents.asArray().map((r) => doc.context.lookup(r)) : [Contents];
    const decoded = parts.map((p) => decode(p ?? undefined)).filter((b): b is Uint8Array => b !== null);
    // ストリームが分割されていても命令がつながるよう、改行をはさんで1本にする
    const total = decoded.reduce((s, b) => s + b.length + 1, 0);
    const joined = new Uint8Array(total);
    let at = 0;
    for (const b of decoded) {
      joined.set(b, at);
      joined[at + b.length] = 10;
      at += b.length + 1;
    }

    const drawn: Drawn[] = [];
    walk(doc, joined, Resources, IDENTITY, 0, drawn, { bytes: 0 });

    const pageArea = pw * ph;
    const significant = drawn.filter(
      (d) => d.pxW > 0 && d.pxH > 0 && d.wPt > 0 && d.hPt > 0 && Math.min(d.wPt * d.hPt, pageArea) >= pageArea * SIGNIFICANT_AREA,
    );
    const ppis = significant.map((d) => Math.min(d.pxW / (d.wPt / 72), d.pxH / (d.hPt / 72)));
    const coverage = Math.min(1, significant.reduce((s, d) => s + d.wPt * d.hPt, 0) / pageArea);
    return {
      imageCount: drawn.length,
      ppi: ppis.length ? Math.round(Math.min(...ppis)) : null,
      coverage: Math.round(coverage * 100) / 100,
    };
  } catch {
    return undefined;
  }
}
