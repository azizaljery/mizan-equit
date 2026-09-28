"""Verify saved archive digest without modifying input. Usage: python verify-saved-archive.py archive.tar.gz"""
import hashlib, io, json, sys, tarfile
EXPECTED = "f3ec527cc3651d039a938c9c43b17f9c33a4d6ad305badd18a33867535832cc4"
buf = io.BytesIO()
before = {}
with tarfile.open(sys.argv[1], "r:gz") as src:
    entries = src.getmembers()
    files = sorted((m for m in entries if m.isfile()), key=lambda m: m.name)
    assert len(files) == len(set(m.name for m in files)), "Duplicate paths"
    with tarfile.open(fileobj=buf, mode="w", format=tarfile.PAX_FORMAT) as out:
        for m in files:
            data = src.extractfile(m).read()
            before[m.name] = hashlib.sha256(data).hexdigest()
            header = tarfile.TarInfo(m.name)
            header.size = len(data)
            out.addfile(header, io.BytesIO(data))
raw = buf.getvalue()
with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as check:
    after = {m.name: hashlib.sha256(check.extractfile(m).read()).hexdigest() for m in check.getmembers() if m.isfile()}
assert before == after, "File content changed"
digest = hashlib.sha256(raw).hexdigest()
assert digest == EXPECTED, "Stored service digest mismatch"
assert len(raw) == 14376960 and len(after) == 329
print(json.dumps({"sha256":digest,"bytes":len(raw),"regularFiles":len(after),"pathsAndContentsPreserved":True,"matchesSavedServiceDigest":True}, indent=2))
