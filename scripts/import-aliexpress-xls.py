#!/usr/bin/env python3
"""Import an AliExpress Portals .xls export into the storefront catalog.

Usage:
  python3 scripts/import-aliexpress-xls.py path/to/export.xls

The importer preserves every existing catalog record, accepts only verified
s.click.aliexpress.com affiliate links, caches product images locally, and
normalizes the result to the same fields used by update-products.js.
"""
from __future__ import annotations
import json, re, sys, urllib.request
from datetime import datetime
from pathlib import Path

try:
    import pandas as pd
except ImportError as exc:
    raise SystemExit("Install dependencies first: python3 -m pip install --user pandas xlrd") from exc

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "products.json"
IMAGE_DIR = ROOT / "assets" / "products"
NOW = datetime.utcnow().isoformat(timespec="seconds") + "Z"

# The labels mirror the AliExpress category names supplied by the owner.
CATEGORIES = [
    "الغذاء", "الأجهزة المنزلية", "كمبيوتر و مكتب", "تحسين المنزل", "المنزل والحديقة",
    "الرياضة والترفيه", "لوازم مكتبية ومدرسية", "الألعاب والهوايات", "الأمن والحماية",
    "السيارات والدراجات النارية", "مجوهرات وكماليات", "الأضواء والإضاءة", "الالكترونيات الاستهلاكية",
    "الجمال والصحة", "حفلات الزفاف والأحداث", "أحذية", "مكونات ومستلزمات إلكترونية",
    "الهواتف والاتصالات", "الأدوات", "الأم والاطفال", "الأثاث", "الساعات", "الأمتعة وحقائب",
    "الملابس الداخلية ، الجوارب ، النوم وصالة ارتداء", "الظاهري المنتجات", "الصناعية والأعمال",
    "أحذية رياضية وملابس وإكسسوارات", "الهواتف وملحقات الاتصالات", "الملابس النسائية",
    "ملابس رجالية", "الملابس الملحقات", "مضافات الشعر والوكريات", "الفئة الخاصة",
    "الكتب والبضائع الثقافية", "الحداثة والاستخدام الخاص", "دراجة نارية معدات وقطع غيار",
]

def text(value):
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return str(value).strip()

def money(value):
    m = re.search(r"[-+]?[0-9]+(?:\.[0-9]+)?", text(value).replace(",", ""))
    return float(m.group()) if m else 0.0

def percent(value):
    return round(money(value))

def category(desc: str) -> str:
    s = desc.lower()
    rules = [
        ("السيارات والدراجات النارية", r"سيار|داش كام|كاميرا سيارة|ثلاجة سيارة|دراجة نارية|تظليل|motorcycle|car "),
        ("الجمال والصحة", r"بشرة|تجميل|وجه|أسنان|خيط مائي|عناية|beauty|skin|face|tooth"),
        ("كمبيوتر و مكتب", r"ssd|كمبيوتر|لابتوب|حاسوب|لوحة كتابة|لوح كتابة|مكتب|office|keyboard|mouse"),
        ("الالكترونيات الاستهلاكية", r"سماعات|بلوتوث|كاميرا|هاتف|شاحن|كابل|إلكترون|earbud|camera|headphone"),
        ("الأجهزة المنزلية", r"قهوة|مطحنة|غلاية|ثلاجة|صانعة|مطبخ|ماكينة|kettle|coffee|fridge"),
        ("الأم والاطفال", r"طفل|أطفال|دمية|baby|kids|toy"),
        ("لوازم مكتبية ومدرسية", r"حافظة|ملف|مستند|مدرسة|قرطاسية|stationery"),
        ("الرياضة والترفيه", r"رياضة|تخييم|gym|fitness|camping|outdoor"),
        ("الأدوات", r"أداة|معدات|tool|hardware|repair"),
    ]
    for name, pattern in rules:
        if re.search(pattern, s): return name
    return "الفئة الخاصة"

def cache_image(product_id: str, url: str) -> str:
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    suffix = ".jpg"
    match = re.search(r"\.(webp|png|jpeg|jpg)(?:\?|$)", url.lower())
    if match: suffix = "." + match.group(1)
    filename = re.sub(r"[^a-zA-Z0-9_-]", "_", str(product_id)) + suffix
    path = IMAGE_DIR / filename
    if not path.exists():
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(request, timeout=25) as response:
            path.write_bytes(response.read())
    return f"assets/products/{filename}"

def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python3 scripts/import-aliexpress-xls.py export.xls")
    source = Path(sys.argv[1]).expanduser().resolve()
    if not source.exists(): raise SystemExit(f"File not found: {source}")
    df = pd.read_excel(source, engine="xlrd").fillna("")
    required = {"ProductId", "Image Url", "Product Desc", "Discount Price", "Origin Price", "Promotion Url"}
    missing = required - set(df.columns)
    if missing: raise SystemExit("Missing required columns: " + ", ".join(sorted(missing)))
    products = json.loads(CATALOG.read_text(encoding="utf-8"))
    ids = {str(p.get("sourceId")) for p in products}
    names = {text(p.get("name")).lower() for p in products}
    added = skipped = 0
    for _, row in df.iterrows():
        pid, link, image, desc = text(row["ProductId"]), text(row["Promotion Url"]), text(row["Image Url"]), text(row["Product Desc"])
        if not pid or not re.fullmatch(r"https://s\.click\.aliexpress\.com/e/[^\s]+", link) or not image or not desc:
            skipped += 1; continue
        source_id = f"xls:{pid}"
        if source_id in ids or desc.lower() in names:
            skipped += 1; continue
        try: local_image = cache_image(pid, image)
        except Exception as exc:
            print(f"warning: image failed for {pid}: {exc}")
            continue
        coupon = {}
        if text(row.get("Code Name")):
            coupon = {"code": text(row["Code Name"]), "value": text(row.get("Code Value")), "quantity": text(row.get("Code Quantity")), "minimumSpend": text(row.get("Code Minimum Spend")), "startsAt": text(row.get("Code Start Time")), "endsAt": text(row.get("Code End Time"))}
        products.append({
            "sourceId": source_id, "name": desc, "url": link, "affiliateVerified": True,
            "store": "علي إكسبريس", "price": money(row["Discount Price"]), "old": money(row["Origin Price"]), "cur": "$",
            "cat": category(desc), "img": local_image, "rating": percent(row.get("Positive Feedback")),
            "sold": text(row.get("Sales180Day")), "discount": percent(row.get("Discount")),
            "directCommissionRate": money(row.get("Direct linking commission rate (%)")),
            "estimatedCommission": money(row.get("Estimated direct linking commission")),
            "coupon": coupon, "freeShipping": bool(re.search(r"شحن\s*مجاني|توصيل\s*مجاني|free\s*shipping", desc, re.I)), "shippingCountry": "SA", "shippingVerified": False, "priceSource": "AliExpress Portals XLS", "priceCountry": "SA", "updatedAt": NOW
        })
        ids.add(source_id); names.add(desc.lower()); added += 1
    CATALOG.write_text(json.dumps(products, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"source": str(source), "added": added, "skipped": skipped, "total": len(products)}, ensure_ascii=False))

if __name__ == "__main__": main()
