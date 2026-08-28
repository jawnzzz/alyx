#!/usr/bin/env python3
"""
Parse a base resume into the structured education and experience that
application forms ask for.

Deliberately prints for review rather than writing. Parsed resume data is wrong
often enough that silently filling a form with it is how a typo reaches an
employer. Nothing here writes to config; a human confirms first.

Usage:
  python3 src/parse-resume.py "<path to .docx>"
  python3 src/parse-resume.py "<path>" --json
"""

import sys, json, re
import docx

SECTIONS = {"summary", "experience", "skills", "education", "certifications", "projects"}

# "Company<tab>Mon YYYY - Mon YYYY" on one line, "Title | Location" on the next.
DATE_RANGE = re.compile(
    r"(?P<start>[A-Z][a-z]{2}\s+\d{4})\s*[-–—]\s*(?P<end>Present|[A-Z][a-z]{2}\s+\d{4})"
)

def sections(doc):
    """Split paragraphs into named sections, keyed by the ALL-CAPS headers."""
    out, current = {}, None
    for p in doc.paragraphs:
        t = p.text.strip()
        if not t:
            continue
        if t.isupper() and t.lower() in SECTIONS:
            current = t.lower()
            out[current] = []
        elif current:
            out[current].append((p.style.name, t))
    return out


def parse_experience(rows):
    jobs, job = [], None
    for style, text in rows:
        if style.startswith("List"):
            if job:
                job["bullets"].append(text)
            continue
        m = DATE_RANGE.search(text)
        if m:
            # A new employer line closes the previous job.
            if job:
                jobs.append(job)
            company = DATE_RANGE.sub("", text).replace("\t", " ").strip(" |–-")
            job = {
                "company": re.sub(r"\s*\([^)]*\)\s*$", "", company).strip(),
                "companyNote": (re.search(r"\(([^)]*)\)\s*$", company) or [None, None])[1],
                "start": m.group("start"),
                "end": m.group("end"),
                "title": None,
                "location": None,
                "bullets": [],
            }
        elif job and job["title"] is None:
            parts = [x.strip() for x in re.split(r"\s*\|\s*", text) if x.strip()]
            job["title"] = parts[0] if parts else None
            job["location"] = parts[1] if len(parts) > 1 else None
    if job:
        jobs.append(job)
    return jobs


def parse_education(rows):
    out = []
    for _, text in rows:
        parts = [x.strip() for x in re.split(r"\s*[–—]\s*", text, maxsplit=1)]
        school = parts[0]
        rest = parts[1] if len(parts) > 1 else ""
        loc = None
        m = re.search(r"\|\s*([^|]+)$", rest)
        if m and re.search(r",\s*[A-Z]{2}$", m.group(1).strip()):
            loc = m.group(1).strip()
            rest = rest[: m.start()].strip()
        degree = re.split(r"\s*\(", rest)[0].strip().rstrip("|").strip()
        field = None
        if "," in degree:
            degree, field = [x.strip() for x in degree.split(",", 1)]
        out.append({"school": school, "degree": degree or None, "field": field, "location": loc, "raw": text})
    return out


def main():
    path = sys.argv[1]
    doc = docx.Document(path)
    sec = sections(doc)

    data = {
        "source": path.split("/")[-1],
        "experience": parse_experience(sec.get("experience", [])),
        "education": parse_education(sec.get("education", [])),
        "skills": [t for _, t in sec.get("skills", [])],
        "summary": " ".join(t for _, t in sec.get("summary", [])),
    }

    if "--json" in sys.argv:
        print(json.dumps(data, indent=2))
        return

    print(f"EXPERIENCE  ({len(data['experience'])})\n")
    for j in data["experience"]:
        note = f"  [{j['companyNote']}]" if j["companyNote"] else ""
        print(f"  {j['company']}{note}")
        print(f"    {j['title'] or '(no title parsed)'}")
        print(f"    {j['start']} to {j['end']}   {j['location'] or ''}")
        print(f"    {len(j['bullets'])} bullets")
        print()

    print(f"EDUCATION  ({len(data['education'])})\n")
    for e in data["education"]:
        print(f"  {e['school']}")
        print(f"    degree: {e['degree'] or '(none parsed)'}")
        print(f"    field:  {e['field'] or '(none parsed)'}")
        print(f"    where:  {e['location'] or '(none parsed)'}")
        print()

if __name__ == "__main__":
    main()
