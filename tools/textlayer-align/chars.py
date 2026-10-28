import sys, json, fitz
doc = fitz.open(sys.argv[1]); out = {}
for pno in [int(x) for x in sys.argv[2].split(",")]:
    page = doc[pno-1]; chars = []
    for b in page.get_text("rawdict")["blocks"]:
        for l in b.get("lines", []):
            if abs(l["dir"][1]) > 0.01: continue
            for s in l["spans"]:
                for c in s["chars"]:
                    x0,y0,x1,y1 = c["bbox"]
                    if c["c"].strip(): chars.append([c["c"], round((x0+x1)/2,2), round((y0+y1)/2,2), round(x1-x0,2)])
    out[pno] = {"w": page.rect.width, "h": page.rect.height, "chars": chars}
print(json.dumps(out))
