"""Preview-only extractor.

Reads the CURRENT (v2.0) Excel training card and pulls out a few courses
into the clean format the site uses. The full build will read the new
standard template instead.

Usage: python3 -I build/extract_preview.py <workbook.xlsx> <out.json>
"""
import datetime
import json
import string
import sys

import openpyxl


def col(letter):
    """Excel column letter(s) -> zero-based index."""
    n = 0
    for ch in letter:
        n = n * 26 + string.ascii_uppercase.index(ch) + 1
    return n - 1


BLANK = {None, "", "n/a", "N/A", "NA", "-", "#VALUE!"}


def clean(v):
    if isinstance(v, str):
        v = v.strip()
    if v in BLANK:
        return ""
    if isinstance(v, datetime.datetime):
        return v.strftime("%d-%b-%Y")
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v)


def patient(row, role, last, first, dob, mrn, ward=None, fin=None, dob_override=None):
    p = {
        "role": role,
        "last": clean(row[col(last)]),
        "first": clean(row[col(first)]),
        "dob": dob_override or clean(row[col(dob)]),
        "mrn": clean(row[col(mrn)]),
        "ward": clean(row[col(ward)]) if ward else "",
        "fin": clean(row[col(fin)]) if fin else "",
    }
    # A patient with no name and no MRN is treated as absent (card hidden).
    if not (p["last"] or p["first"] or p["mrn"]):
        return None
    return p


def rows(wb, sheet):
    for r in wb[sheet].iter_rows(min_row=2, values_only=True):
        if clean(r[1]):
            yield r


WITNESS = {"label": "Witness", "note": "Second nurse check", "username": "Bloggs,Jo", "password": "train"}


def doctor(name):
    return {"label": "Doctor", "note": "Doctor login", "username": name, "password": "train"}


def two_patient_course(wb, sheet, meta, roles, default_doctor):
    logins = []
    for r in rows(wb, sheet):
        pts = [
            patient(r, roles[0], "C", "D", "E", "G", ward="F", fin="H"),
            patient(r, roles[1], "L", "M", "N", "P", ward="O", fin="Q"),
        ]
        doc = clean(r[col("T")]) or default_doctor
        logins.append({
            "login": clean(r[col("B")]),
            "password": "train",
            "facility": "",
            "patients": [p for p in pts if p],
            "others": [doctor(doc), WITNESS],
        })
    return {**meta, "logins": logins}


def ao_course(wb, sheet, meta, roles, hbcis_dob=""):
    logins = []
    for r in rows(wb, sheet):
        pts = [
            patient(r, roles[0], "E", "F", "G", "D"),
            patient(r, roles[1], "I", "J", "K", "H"),
            patient(r, roles[2], "M", "N", "O", "L"),
            patient(r, roles[3], "Q", "R", "S", "P"),
        ]
        hb = None
        if clean(r[col("T")]):
            hb = {
                "login": clean(r[col("T")]),
                "password": clean(r[col("U")]),
                "urn": clean(r[col("V")]),
                "last": clean(r[col("W")]),
                "first": clean(r[col("X")]),
                "dob": hbcis_dob,
                "doctor": clean(r[col("AB")]),
                "unit": clean(r[col("AC")]),
                "ward": clean(r[col("AD")]),
                "transfer": clean(r[col("AE")]),
            }
        logins.append({
            "login": clean(r[col("B")]),
            "password": clean(r[col("C")]) or "train",
            "facility": clean(r[col("A")]),
            "patients": [p for p in pts if p],
            "hbcis": hb,
            "others": [],
        })
    return {**meta, "logins": logins}


def main(src, out):
    wb = openpyxl.load_workbook(src, data_only=True)
    courses = [
        two_patient_course(
            wb, "2026 RN INPATIENT",
            {"id": "rn-inpatient", "name": "RN Inpatient / Ward", "group": "nursing", "barcode": True, "bloodBag": True},
            ["Instructor led", "Proficiency"], "MED, Molly"),
        two_patient_course(
            wb, "2026 MIDWIFERY DAY 1 Trg & Prof",
            {"id": "midwifery-day-1", "name": "Midwifery Day 1", "group": "midwifery", "barcode": True, "bloodBag": True},
            ["Antenatal · Training", "Postnatal · Training"], "OBS, Olly"),
        ao_course(
            wb, "2026 AO ESM",
            {"id": "ao-esm", "name": "AO ESM", "group": "admin", "barcode": False},
            ["Instructor led", "Patient 2", "Patient 3", "Patient 4"]),
        ao_course(
            wb, "2026 AO FirstNet ED",
            {"id": "ao-firstnet-ed", "name": "AO FirstNet ED", "group": "admin", "barcode": False},
            ["Instructor led", "Short Term Treatment Area", "Ward", "Proficiency"],
            hbcis_dob="01-Jan-2000"),
    ]
    with open(out, "w") as f:
        json.dump({"courses": courses}, f, indent=1)
    for c in courses:
        print(f'{c["name"]}: {len(c["logins"])} logins')


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
