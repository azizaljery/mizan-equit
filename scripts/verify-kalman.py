#!/usr/bin/env python3
"""
scripts/verify-kalman.py
------------------------------------------------------------------
تحقّق عددي مستقل من مرشّح كالمان في lib/forecast/v2/models.ts :: n4Kalman

  node scripts/verify-kalman.mjs > /tmp/kalman-trace.json
  python3 scripts/verify-kalman.py /tmp/kalman-trace.json

رموز الخروج: 0 متطابق، 1 انحراف، 2 خطأ مخطط/قراءة.

الاستقلال المقصود هنا هو إعادة اشتقاق المرشّح من F و Q و H و R و z وحدها،
دون أي سطر من كود TypeScript. يستخدم السكربت numpy إن وُجد، وإلا فمصفوفات
بايثون خالصة — النتيجة واحدة، والمحرّك المستعمل يُطبع في الأعلى.

مخطط الأثر المتوقَّع:
{
  "init":  { "x": [...], "P": [[...]] },
  "steps": [ { "F": [[...]], "Q": [[...]], "H": [[...]], "R": [[...]],
               "z": [...], "x_post": [...], "P_post": [[...]] }, ... ]
}
"""

import json
import math
import sys
from pathlib import Path

TOL = 1e-9

try:
    import numpy as np

    ENGINE = f"numpy {np.__version__}"
except ImportError:  # pragma: no cover
    np = None
    ENGINE = "pure-python"


# ──────────────────────────────────────────────────────────────
# جبر مصفوفات خالص — يُستعمل فقط عند غياب numpy
# ──────────────────────────────────────────────────────────────

def _mat(a):
    return [[float(v) for v in row] for row in a]


def _mm(a, b):
    n, k, m = len(a), len(b), len(b[0])
    return [[sum(a[i][t] * b[t][j] for t in range(k)) for j in range(m)] for i in range(n)]


def _t(a):
    return [list(col) for col in zip(*a)]


def _add(a, b):
    return [[a[i][j] + b[i][j] for j in range(len(a[0]))] for i in range(len(a))]


def _sub(a, b):
    return [[a[i][j] - b[i][j] for j in range(len(a[0]))] for i in range(len(a))]


def _eye(n):
    return [[1.0 if i == j else 0.0 for j in range(n)] for i in range(n)]


def _inv(a):
    """عكس بحذف غاوس-جوردان مع محور جزئي."""
    n = len(a)
    m = [row[:] + e[:] for row, e in zip(_mat(a), _eye(n))]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(m[r][c]))
        if abs(m[p][c]) < 1e-300:
            raise ZeroDivisionError("مصفوفة شاذة عند العكس")
        m[c], m[p] = m[p], m[c]
        pv = m[c][c]
        m[c] = [v / pv for v in m[c]]
        for r in range(n):
            if r == c:
                continue
            f = m[r][c]
            if f:
                m[r] = [vr - f * vc for vr, vc in zip(m[r], m[c])]
    return [row[n:] for row in m]


# ──────────────────────────────────────────────────────────────
# خطوة المرشّح
# ──────────────────────────────────────────────────────────────

def kalman_step(x, P, F, Q, H, R, z):
    """تنبؤ + تحديث بصيغة Joseph. x عمود (n×1)، الباقي مصفوفات."""
    if np is not None:
        x, P, F, Q, H, R, z = (np.asarray(v, dtype=float) for v in (x, P, F, Q, H, R, z))
        x_pred = F @ x
        P_pred = F @ P @ F.T + Q
        y = z - H @ x_pred
        S = H @ P_pred @ H.T + R
        K = P_pred @ H.T @ np.linalg.solve(S, np.eye(S.shape[0]))
        x_post = x_pred + K @ y
        IKH = np.eye(P.shape[0]) - K @ H
        P_post = IKH @ P_pred @ IKH.T + K @ R @ K.T
        # Joseph يضمن التناظر نظرياً؛ هذا يمنع فقط انجراف الفاصلة العائمة
        # عبر خطوات كثيرة من أن يُبلَّغ عنه كـ"عدم تناظر" زائف.
        P_post = 0.5 * (P_post + P_post.T)
        return x_post.tolist(), P_post.tolist()

    x_pred = _mm(F, x)
    P_pred = _add(_mm(_mm(F, P), _t(F)), Q)
    y = _sub(z, _mm(H, x_pred))
    S = _add(_mm(_mm(H, P_pred), _t(H)), R)
    K = _mm(_mm(P_pred, _t(H)), _inv(S))
    x_post = _add(x_pred, _mm(K, y))
    IKH = _sub(_eye(len(P)), _mm(K, H))
    P_post = _add(_mm(_mm(IKH, P_pred), _t(IKH)), _mm(_mm(K, R), _t(K)))
    n2 = len(P_post)
    P_post = [
        [0.5 * (P_post[i][j] + P_post[j][i]) for j in range(n2)] for i in range(n2)
    ]
    return x_post, P_post


# ──────────────────────────────────────────────────────────────

def _flat(a):
    out = []
    for v in a:
        out.extend(_flat(v)) if isinstance(v, (list, tuple)) else out.append(float(v))
    return out


def compare(name, ref, got, verbose, tol=TOL):
    """يرجع (ok, diff). لا يطبع إلا عند الفشل أو عند نقطة تفتيش."""
    a, b = _flat(ref), _flat(got)
    if len(a) != len(b):
        print(f"  ✗ {name}: عدد العناصر {len(a)} مقابل {len(b)}")
        return False, float("inf")
    # NaN أو Inf فشل صريح، لا يُمرَّر بأي تسامح.
    if any(not math.isfinite(v) for v in a + b):
        print(f"  ✗ {name}: قيمة غير منتهية (NaN/Inf)")
        return False, float("nan")
    diff = max(abs(p - q) for p, q in zip(a, b)) if a else 0.0
    scale = max((abs(v) for v in a), default=1.0) or 1.0
    ok = diff <= tol or diff / scale <= tol
    if not ok or verbose:
        print(f"  {'✓' if ok else '✗'} {name:16s} أقصى |Δ| = {diff:.3e}")
    return ok, diff


def _col(v):
    return [[float(e)] for e in v]


def main():
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2

    path = Path(sys.argv[1])
    if not path.exists():
        print(f"خطأ: ملف الأثر غير موجود: {path}", file=sys.stderr)
        return 2
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        print(f"خطأ: JSON غير صالح: {e}", file=sys.stderr)
        return 2
    if "init" not in data or "steps" not in data:
        print("خطأ: المخطط يتطلّب 'init' و 'steps'", file=sys.stderr)
        return 2

    x = _col(data["init"]["x"])
    P = _mat(data["init"]["P"])
    n = len(x)
    steps = data["steps"]

    print(f"[verify-kalman] المحرّك: {ENGINE}")
    print(f"[verify-kalman] المصدر: {data.get('source', '?')}")
    print(f"[verify-kalman] البعد n={n}  الخطوات={len(steps)}  التسامح={TOL:.0e}")

    # نقاط تفتيش مطبوعة فقط، والبقية صامتة ما لم تفشل.
    marks = {0, len(steps) // 4, len(steps) // 2, (3 * len(steps)) // 4, len(steps) - 1}
    worst_x = worst_p = 0.0

    all_ok = True
    for i, s in enumerate(steps):
        for key in ("F", "Q", "H", "R", "z", "x_post", "P_post"):
            if key not in s:
                print(f"خطأ: الخطوة {i} ينقصها '{key}'", file=sys.stderr)
                return 2
        H = _mat(s["H"])
        if len(H[0]) != n:
            print(f"خطأ: الخطوة {i}: H بعرض {len(H[0])} والحالة بعد {n}", file=sys.stderr)
            return 2

        x_post, P_post = kalman_step(x, P, _mat(s["F"]), _mat(s["Q"]), H, _mat(s["R"]), _col(s["z"]))

        ok_x, dx = compare(f"step{i}.x", _col(s["x_post"]), x_post, i in marks)
        ok_P, dp = compare(f"step{i}.P", s["P_post"], P_post, i in marks)
        if math.isfinite(dx):
            worst_x = max(worst_x, dx)
        if math.isfinite(dp):
            worst_p = max(worst_p, dp)

        # التماثل P01 = P10 شرط بنيوي، لا تفصيل تجميلي.
        ok_s = True
        for r in range(n):
            for c in range(r + 1, n):
                if abs(P_post[r][c] - P_post[c][r]) > TOL:
                    print(f"  ✗ step{i}.P غير متماثلة عند ({r},{c})")
                    ok_s = False

        if not (ok_x and ok_P and ok_s):
            all_ok = False
            print(f"  → انحراف عند الخطوة {i}. توقّف.")
            break

        x, P = x_post, P_post

    print(f"[verify-kalman] أسوأ انحراف عبر كل الخطوات: x={worst_x:.3e}  P={worst_p:.3e}")
    print(f"[verify-kalman] {'نجح' if all_ok else 'فشل'}")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
