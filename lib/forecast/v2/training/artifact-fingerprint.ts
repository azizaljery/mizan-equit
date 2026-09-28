/**
 * بصمة SHA-256 للـ artifact — كشف تلف صامت أو تحوير في التوزيع.
 *
 * الوضع اليوم في params-loader.ts: أي JSON بالشكل الصحيح يُقبل ويُحقن في
 * ensemble كأنه صحيح، حتى لو غيّرت تعديلاً واحداً على معامل واحد بالخطأ.
 * الفشل الصامت هنا يعني: النظام يستمر في التنبؤ بأرقام "تبدو معقولة"
 * لكن مبنيّة على معاملات لم تُدرَّب عليها. أخطر بكثير من الفشل الصاخب.
 *
 * الحل: نحسب بصمة على الحقول الحرجة (ridge.coefficients, lasso.coefficients,
 * hmm.params) وقت التدريب، ونثبّتها داخل الـ artifact نفسه. عند التحميل
 * نعيد الحساب. أي عدم تطابق → رفض الـ artifact بدلاً من قبوله كملف "صحيح".
 *
 * ليست هذه حماية أمنية (المهاجم القادر على تعديل الـ env يستطيع تعديل
 * البصمة أيضاً) — هي حماية سلامة (integrity): كشف قص/لصق خاطئ، تحويل
 * ترميز، تسرّب من bake غير مكتمل، أو أي تحوير عرضي بين خط التدريب
 * ووصول الـ artifact إلى env.
 *
 * التطبيق يعتمد Web Crypto API (SubtleCrypto.digest) — متوفر في Node ≥ 15
 * و Cloudflare Workers native، بلا تبعيات خارجية.
 */

import type { HMMParams } from '../meta/hmm';
import type { TrainedLinearModel } from '../types';

export type Fingerprint = {
  version: 1;
  algorithm: 'SHA-256';
  hmm: string;
  ridge: string;
  lasso: string;
  /** بصمة على الحقول الثلاث مجتمعة — تكشف حتى تبديل ترتيب الحقول. */
  composite: string;
};

export type FingerprintableArtifact = {
  hmm: { params: HMMParams };
  ridge: TrainedLinearModel;
  lasso: TrainedLinearModel;
};

/**
 * تسلسل قانوني (canonical) — لا نعتمد JSON.stringify مباشرة لأن ترتيب
 * حقول الكائن لا يُضمن جبرياً ولا يُضمن عبر runtimes. نبني تمثيلاً
 * ثابت الترتيب صراحةً، ثم نحسب البصمة عليه.
 *
 * الأرقام: تحدَّد بدقة 17 خانة عشرية (double precision الأدنى الذي يعيد
 * IEEE 754). Number.prototype.toString بلا وسيط ينتج تمثيلاً "أقصر عدد
 * يعود إلى نفس الـ double"، وهو حتمي عبر V8/JavaScriptCore/… لكنه ليس
 * مضموناً قياسياً؛ توحيد الدقة يزيله كمصدر شك.
 */
function canonNumber(n: number): string {
  if (!Number.isFinite(n)) return `nan`;
  // 17 خانة كافية لاستعادة أي double بدقة كاملة.
  return n.toPrecision(17);
}

function canonNumberArray(a: number[]): string {
  return '[' + a.map(canonNumber).join(',') + ']';
}

function canonHMM(p: HMMParams): string {
  return [
    'pi:' + canonNumberArray(p.pi),
    'A:[' + p.A.map(canonNumberArray).join(',') + ']',
    'mean:[' + p.mean.map(canonNumberArray).join(',') + ']',
    'std:[' + p.std.map(canonNumberArray).join(',') + ']',
  ].join('|');
}

function canonLinear(m: TrainedLinearModel): string {
  const names = m.featureNames ?? [];
  return [
    'intercept:' + canonNumber(m.intercept),
    'coefficients:' + canonNumberArray(m.coefficients),
    'featureNames:[' + names.map((s) => JSON.stringify(s)).join(',') + ']',
  ].join('|');
}

async function sha256Hex(input: string): Promise<string> {
  // Web Crypto API — يعمل native في Node ≥15 و Cloudflare Workers.
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

export async function fingerprint(artifact: FingerprintableArtifact): Promise<Fingerprint> {
  const hmmStr = canonHMM(artifact.hmm.params);
  const ridgeStr = canonLinear(artifact.ridge);
  const lassoStr = canonLinear(artifact.lasso);
  const composite = `HMM|${hmmStr}||RIDGE|${ridgeStr}||LASSO|${lassoStr}`;

  const [hmm, ridge, lasso, comp] = await Promise.all([
    sha256Hex(hmmStr),
    sha256Hex(ridgeStr),
    sha256Hex(lassoStr),
    sha256Hex(composite),
  ]);

  return { version: 1, algorithm: 'SHA-256', hmm, ridge, lasso, composite: comp };
}

export type VerificationResult =
  | { ok: true; recomputed: Fingerprint }
  | { ok: false; reason: string; expected?: string; got?: string };

/**
 * يتحقق من مطابقة بصمة موجودة على artifact. عدم التطابق يجب أن يمنع
 * تحميل الـ artifact — لا يجب أن يتحوّل إلى تحذير في السجلّ ثم يمر.
 *
 * تحدد بالضبط أي حقل مكسور (HMM / ridge / lasso / composite) — المصمم
 * يستطيع تشخيص أين انكسرت السلسلة (بين التدريب و bake؟ بين bake و env؟)
 * بدل رسالة "artifact غير صالح" عمياء.
 */
export async function verifyFingerprint(
  artifact: FingerprintableArtifact,
  claimed: Fingerprint,
): Promise<VerificationResult> {
  if (claimed.version !== 1) {
    return { ok: false, reason: `unsupported_fingerprint_version_${claimed.version}` };
  }
  if (claimed.algorithm !== 'SHA-256') {
    return { ok: false, reason: `unsupported_algorithm_${claimed.algorithm}` };
  }
  const recomputed = await fingerprint(artifact);

  if (recomputed.hmm !== claimed.hmm) {
    return { ok: false, reason: 'hmm_mismatch', expected: claimed.hmm, got: recomputed.hmm };
  }
  if (recomputed.ridge !== claimed.ridge) {
    return { ok: false, reason: 'ridge_mismatch', expected: claimed.ridge, got: recomputed.ridge };
  }
  if (recomputed.lasso !== claimed.lasso) {
    return { ok: false, reason: 'lasso_mismatch', expected: claimed.lasso, got: recomputed.lasso };
  }
  if (recomputed.composite !== claimed.composite) {
    // نظرياً غير قابل للحدوث إن مرّت الثلاثة السابقة، لكن نتحقق صراحة
    // ليتضح أي تلف يمس ترتيب الحقول لا محتواها.
    return {
      ok: false,
      reason: 'composite_mismatch',
      expected: claimed.composite,
      got: recomputed.composite,
    };
  }
  return { ok: true, recomputed };
}
