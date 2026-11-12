"""One-off migration: old v2.0 Excel training card -> clean course data (JSON).

The JSON is then written out as the new standard Excel template
(build/make-template.mjs). From then on the template is the source of truth
and this script is no longer needed.

Fixes applied while converting:
  * '#VALUE!', 'n/a', '-' cells become blank
  * MRN/FIN cells that Excel had formatted as dates are turned back into numbers
  * DOB cells that held a bare date number become real dates
  * Login order is kept; the site sorts logins itself

Usage: python3 -I build/convert_v2.py <old.xlsx> <out.json>
"""
import datetime
import json
import string
import sys

import openpyxl

EPOCH = datetime.datetime(1899, 12, 30)
BLANK = {"", "n/a", "N/A", "NA", "na", "-", "#VALUE!", "#N/A", "#REF!", "="}


def col(letter):
    n = 0
    for ch in letter:
        n = n * 26 + string.ascii_uppercase.index(ch) + 1
    return n - 1


def text(v):
    if v is None:
        return ""
    if isinstance(v, datetime.datetime):
        return v.strftime("%d-%b-%Y")
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    v = str(v).replace("\xa0", " ").strip()
    return "" if v in BLANK else v


def number(v):
    """MRN / FIN / URN. Excel sometimes shows these as dates; undo that."""
    if isinstance(v, datetime.datetime):
        return str((v - EPOCH).days)
    return text(v)


def date(v):
    """DOB. Bare numbers are Excel date serials."""
    if isinstance(v, (int, float)) and not isinstance(v, bool) and 1 < v < 80000:
        v = EPOCH + datetime.timedelta(days=int(v))
    return text(v)


def get(row, letter):
    i = col(letter)
    return row[i] if i < len(row) else None


def patient(row, group="", role="", last=None, first=None, dob=None, mrn=None, ward=None, fin=None, ioms=None):
    return {
        "group": group,
        "role": role,
        "last": text(get(row, last)) if last else "",
        "first": text(get(row, first)) if first else "",
        "dob": date(get(row, dob)) if dob else "",
        "mrn": number(get(row, mrn)) if mrn else "",
        "fin": number(get(row, fin)) if fin else "",
        "ward": text(get(row, ward)) if ward else "",
        "ioms": text(get(row, ioms)) if ioms else "",
    }


def present(p):
    return bool(p["last"] or p["first"] or p["mrn"])


def rows(wb, sheet, login_col="B"):
    if sheet not in wb.sheetnames:
        return []
    out = []
    for r in wb[sheet].iter_rows(min_row=2, values_only=True):
        v = text(get(r, login_col))
        if v and " " not in v:      # skips notes typed into the login column
            out.append(r)
    return out


WITNESS = {"username": "Bloggs,Jo", "password": "train"}


def course(tab, name, group, *, barcode=False, blood=None, layout="all", witness=True,
           doctor="", access=True):
    return {
        "tab": tab,
        "name": name,
        "group": group,
        "show": True,
        "barcode": barcode,
        "bloodBag": (group != "admin") if blood is None else blood,
        "layout": layout,
        "witness": dict(WITNESS) if witness else None,
        "doctor": {"username": doctor, "password": "train"} if doctor else None,
        "accessUrl": "",
        "notes": "",
        "logins": [],
    }


def login(login_id, password="train", facility="", doctor="", patients=(), second=None, hbcis=None):
    return {
        "login": login_id,
        "password": password,
        "facility": facility,
        "doctor": doctor,
        "second": second,
        "patients": [p for p in patients if present(p)],
        "hbcis": hbcis if hbcis and any(hbcis.values()) else None,
    }


def course_doctor(sheet_rows, letter, fallback):
    """Old card always showed row 2's doctor; use first real value as the course default."""
    for r in sheet_rows:
        d = text(get(r, letter))
        if d:
            return d
    return fallback


STD1 = dict(last="C", first="D", dob="E", ward="F", mrn="G", fin="H")
STD2 = dict(last="L", first="M", dob="N", ward="O", mrn="P", fin="Q")


def standard(wb, sheet, c, roles=("Instructor led", "Proficiency"), fallback_doctor="", extra1=None, extra2=None):
    rs = rows(wb, sheet)
    default_doc = course_doctor(rs, "T", fallback_doctor)
    if default_doc:
        c["doctor"] = {"username": default_doc, "password": "train"}
    for r in rs:
        doc = text(get(r, "T"))
        c["logins"].append(login(
            text(get(r, "B")),
            doctor=doc if doc and doc != default_doc else "",
            patients=[
                patient(r, role=roles[0], **STD1, **(extra1 or {})),
                patient(r, role=roles[1], **STD2, **(extra2 or {})),
            ]))
    return c


def ao(wb, sheet, c, roles, hbcis_dob_col=None, hbcis_dob_fixed="", hbcis_extra=True):
    for r in rows(wb, sheet):
        pts = [
            patient(r, role=roles[0], last="E", first="F", dob="G", mrn="D"),
            patient(r, role=roles[1], last="I", first="J", dob="K", mrn="H"),
            patient(r, role=roles[2], last="M", first="N", dob="O", mrn="L"),
            patient(r, role=roles[3], last="Q", first="R", dob="S", mrn="P"),
        ]
        hb = {
            "login": text(get(r, "T")), "password": text(get(r, "U")), "urn": number(get(r, "V")),
            "last": text(get(r, "W")), "first": text(get(r, "X")), "alias": "",
            "dob": date(get(r, hbcis_dob_col)) if hbcis_dob_col else "",
            "doctor": "", "unit": "", "ward": "", "transfer": "",
        }
        if hb["login"]:
            if not hb["dob"]:
                hb["dob"] = hbcis_dob_fixed
            if hbcis_extra:
                hb.update(doctor=text(get(r, "AB")), unit=text(get(r, "AC")),
                          ward=text(get(r, "AD")), transfer=text(get(r, "AE")))
        else:
            hb = None
        c["logins"].append(login(text(get(r, "B")), password=text(get(r, "C")) or "train",
                                 facility=text(get(r, "A")), patients=pts, hbcis=hb))
    return c


def main(src, out):
    wb = openpyxl.load_workbook(src, data_only=True)
    C = []

    # ---------------- Nursing ----------------
    C.append(standard(wb, "2026 RN INPATIENT", course("RN Inpatient", "RN Inpatient / Ward", "nursing", barcode=True), fallback_doctor="MED, Molly"))
    C.append(standard(wb, "2026 RN FN", course("RN FirstNet ED", "RN FirstNet ED", "nursing", barcode=True), fallback_doctor="EMERG, Emmy"))
    C.append(standard(wb, "2026 RN FN VECS", course("RN FirstNet VECS", "RN FirstNet VECS", "nursing"), fallback_doctor="EMERG, Emmy"))
    C.append(standard(wb, "2026 RN Periop", course("RN Periop", "RN Periop", "nursing", barcode=True), fallback_doctor="SURG, Sally"))
    C.append(standard(wb, "RN OPD + COH", course("RN OPD + COH", "RN OPD + COH", "nursing", barcode=True), fallback_doctor="MED, Molly"))
    coh = standard(wb, "RN COH", course("RN COH", "RN Community (COH)", "nursing"), fallback_doctor="MED, Molly")
    coh["notes"] = "No barcodes required"
    C.append(coh)
    C.append(standard(wb, "2026 RN MEDICAL IMAGING", course("RN Medical Imaging", "RN Medical Imaging", "nursing", barcode=True), fallback_doctor="RAD, Randy"))
    C.append(course("RN Clinical Support", "RN Clinical Support Services", "nursing", barcode=True, doctor="MED, Molly"))
    C.append(standard(wb, "2026 PHS", course("PEMR", "PEMR", "nursing"), fallback_doctor="MED, Molly",
                      extra1={"ioms": "I"}, extra2={"ioms": "R"}))

    # ---------------- Midwifery ----------------
    C.append(standard(wb, "2026 MIDWIFERY DAY 1 Trg & Prof", course("Midwifery Day 1", "Midwifery Day 1", "midwifery", barcode=True),
                      roles=("Antenatal · Training", "Postnatal · Training"), fallback_doctor="OB, Olly"))
    C.append(standard(wb, "2026 MIDWIFERY DAY 2 Trg & Prof", course("Midwifery Day 2", "Midwifery Day 2 · Birth Suite", "midwifery", barcode=True),
                      roles=("Training", "Proficiency"), fallback_doctor="OB, Olly"))
    C.append(course("Neonate", "Neonate", "midwifery", barcode=True, doctor="OB, Olly"))

    # ---------------- Medical ----------------
    C.append(standard(wb, "2026 MO INPATIENT", course("MO Inpatient", "MO Inpatient / Ward", "medical"), fallback_doctor="MED, Molly"))
    C.append(standard(wb, "2026 MO FN", course("MO FirstNet ED", "MO FirstNet ED", "medical"), fallback_doctor="EMERG, Emmy"))
    C.append(standard(wb, "MO FN VECS", course("MO FirstNet VECS", "MO FirstNet VECS", "medical"), fallback_doctor="EMERG, Emmy"))
    C.append(course("MO Mental Health", "MO Mental Health", "medical", doctor="EMERG, Emmy"))
    C.append(standard(wb, "2026 MO OPD+COH", course("MO OPD + COH", "MO OPD + COH", "medical"), fallback_doctor="MED, Molly"))
    C.append(course("MO Renal OPD", "MO Renal OPD", "medical", doctor="MED, Molly"))

    # Anaesthetist: same login in two old tabs -> two card tabs.
    anaes = course("MO Anaesthetist SAA", "MO Anaesthetist (SAA)", "medical", layout="tabs", doctor="SURG, Sally")
    blank = {text(get(r, "B")): r for r in rows(wb, "2026 MO ANAES SAA Blank Record")}
    for r in rows(wb, "2026 MO ANAES SAA Trg & Prof"):
        lid = text(get(r, "B"))
        b = blank.get(lid)
        pts = [patient(r, "Training & Proficiency", "Instructor led", **STD1),
               patient(r, "Training & Proficiency", "Proficiency", **STD2)]
        if b:
            pts += [patient(b, "Blank Record", "", **STD1), patient(b, "Blank Record", "", **STD2)]
        anaes["logins"].append(login(lid, patients=pts))
    C.append(anaes)

    C.append(standard(wb, "2026 MO SURGEON", course("MO Surgeon", "MO Surgeon", "medical"), fallback_doctor="SURG, Sally"))

    # ObGyn: 3 instructor-led + 3 proficiency patients -> two card tabs.
    obgyn = course("MO ObGyn", "MO Obstetrics & Gynaecology", "medical", layout="tabs", witness=False)
    og = rows(wb, "2026 MO Obgyn Trg & Prof")
    obgyn["doctor"] = {"username": course_doctor(og, "AL", "OB, Olly"), "password": "train"}
    for r in og:
        obgyn["logins"].append(login(text(get(r, "B")), patients=[
            patient(r, "Instructor led", "Obs/Gyn", last="C", first="D", dob="E", mrn="F", ward="G"),
            patient(r, "Instructor led", "Birth Suite", last="I", first="J", dob="K", mrn="L", ward="M"),
            patient(r, "Instructor led", "Postnatal", last="O", first="P", dob="Q", mrn="R", ward="S"),
            patient(r, "Proficiency", "Obs/Gyn", last="U", first="V", dob="W", mrn="X", ward="Y"),
            patient(r, "Proficiency", "Birth Suite", last="AA", first="AB", dob="AC", mrn="AD", ward="AE"),
            patient(r, "Proficiency", "Postnatal", last="AG", first="AH", dob="AI", mrn="AJ", ward="AK"),
        ]))
    C.append(obgyn)
    C.append(course("MO Obst Postnatal Day 2", "MO Obstetrics Postnatal Day 2", "medical", witness=False, doctor="OB, Olly"))
    C.append(standard(wb, "2026 MO RADIOLOGY", course("MO Radiology", "MO Radiology", "medical"), fallback_doctor="RAD, Randy"))

    # ---------------- Pharmacy: Part A (pharmacist) + Part B (doctor) on one card ----------------
    ph = course("Pharmacy", "Pharmacy", "pharmacy", layout="sections", doctor="MED, Molly")
    for r in rows(wb, "2026 PHARMACY PART A"):
        part_b = text(get(r, "W"))
        ph["logins"].append(login(
            text(get(r, "B")),
            second={"label": "Doctor login", "login": part_b, "password": "train", "group": "Part B · Doctor"} if part_b else None,
            patients=[
                patient(r, "Part A · Pharmacist", "Instructor led", **STD1),
                patient(r, "Part A · Pharmacist", "Proficiency", **STD2),
                patient(r, "Part B · Doctor", "Instructor led", last="X", first="Y", dob="Z", mrn="AA", ward="AB"),
                patient(r, "Part B · Doctor", "Proficiency", last="AD", first="AE", dob="AF", mrn="AG", ward="AH"),
            ]))
    C.append(ph)

    # ---------------- Allied Health ----------------
    C.append(standard(wb, "2026 Allied Health Prescriber", course("Allied Health Prescriber", "Allied Health Prescriber", "allied"), fallback_doctor="MED, Molly"))

    # ---------------- Admin ----------------
    C.append(ao(wb, "2026 AO FirstNet ED", course("AO FirstNet ED", "AO FirstNet ED", "admin", witness=False),
                ["Instructor led", "Short Term Treatment Area", "Ward", "Proficiency"], hbcis_dob_fixed="01-Jan-2000"))
    C.append(ao(wb, "2026 AO FN VECS TRIAGE & DEPART", course("AO FirstNet VECS", "AO FirstNet VECS · Triage & Departure", "admin", witness=False),
                ["Triage · Instructor led", "Triage · Proficiency", "Departure · Instructor led", "Departure · Proficiency"]))
    C.append(ao(wb, "2026 AO ESM", course("AO ESM", "AO ESM", "admin", witness=False),
                ["Instructor led", "", "", ""]))
    C.append(ao(wb, "2026 AO Surgical Bookings", course("AO Surgical Bookings", "AO Surgical Bookings", "admin", witness=False),
                ["Instructor led", "Proficiency", "", ""], hbcis_dob_col="Y"))

    # HBCIS only: the login IS the HBCIS login; one HBCIS patient.
    hb_only = course("AO HBCIS", "AO HBCIS", "admin", witness=False)
    for r in rows(wb, "2026 AO HBCIS"):
        full = text(get(r, "E"))
        first, _, last = full.rpartition(" ")
        hb_only["logins"].append(login(
            text(get(r, "B")), password=text(get(r, "C")), facility=text(get(r, "A")),
            hbcis={"login": "", "password": "", "urn": number(get(r, "D")), "last": last or full, "first": first,
                   "alias": text(get(r, "F")), "dob": date(get(r, "G")), "doctor": text(get(r, "K")),
                   "unit": text(get(r, "H")), "ward": text(get(r, "I")), "transfer": ""}))
    C.append(hb_only)
    C.append(course("AO PowerChart", "AO PowerChart", "admin", witness=False))
    C.append(course("AO Transcription", "AO Transcription", "admin", witness=False))

    with open(out, "w") as f:
        json.dump({"courses": C}, f, indent=1, ensure_ascii=False)
    for c in C:
        n_p = sum(len(l["patients"]) for l in c["logins"])
        print(f'{c["tab"]:28} {len(c["logins"]):3} logins {n_p:4} patients')


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
