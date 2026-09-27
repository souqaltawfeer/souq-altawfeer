# أتمتة منتجات AliExpress

المتجر يقرأ المنتجات من `products.json`. حالياً المتجر النشط الوحيد هو AliExpress؛ يتم إخفاء أي متجر آخر في الواجهة حتى تتم إضافته وربط رابط الإحالة الخاص به، **لكن لا يتم حذف سجلات المنتجات القديمة**. يبحث النظام دورياً عن عروض جديدة في `products-source.json` بواسطة GitHub Actions عبر `scripts/update-products.js`.

## الإعداد مرة واحدة

من مستودع GitHub افتح:

`Settings → Secrets and variables → Actions → New repository secret`

أضف الأسرار التالية:

- `ALIEXPRESS_APP_KEY`: AppKey من AliExpress App Console.
- `ALIEXPRESS_APP_SECRET`: App Secret من AliExpress App Console.
- `ALIEXPRESS_APP_SIGNATURE`: اختيارية فقط إذا وفرتها لوحة AliExpress؛ لا تحتاج إضافتها في تطبيقك الحالي.
- `ALIEXPRESS_TRACKING_ID`: Tracking ID من AliExpress Portals.

لا تضع هذه القيم في HTML أو JavaScript أو أي ملف يتم رفعه للمستودع. إذا تم كشف App Secret سابقاً، اعمل له Reset قبل إضافته إلى GitHub Secrets.

## كيف تتم الإضافة التلقائية

يبحث النظام كل ست ساعات في الفئات المحددة، ولا يضيف المنتج إلا إذا حقق الشروط التالية:

- خصم لا يقل عن 20%، **أو** شحن مجاني، **أو** مبيعات مرتفعة (1000 طلب أو أكثر).
- تقييم لا يقل عن 4.5.
- رابط Affiliate يتم إنشاؤه بنجاح.
- عدم وجود المنتج مسبقاً.

الحد الأقصى الحالي هو 100 منتج في الكتالوج. GitHub Pages لا يلتقط التخفيض لحظياً؛ أقرب فحص يحدث في التشغيل الدوري التالي. لا يمكن عملياً تحميل كل عروض AliExpress بلا نهاية؛ يتم جلب صفحات متعددة من الفئات مع الالتزام بحدود API.

## إضافة فئة أو كلمة بحث جديدة

1. أضف كائناً جديداً داخل `queries` في `products-source.json`.
2. حدّد `keywords` و`category` و`currency`.
3. شغّل Workflow يدوياً من `Actions → Update AliExpress products → Run workflow`.

## ملاحظات

- المهمة تعمل يومياً الساعة 02:17 UTC، ويمكن تشغيلها يدوياً.
- المفتاح السري لا يصل إلى المتصفح؛ تستخدمه GitHub Actions فقط.
- عند فشل تحديث منتج، يحتفظ السكربت بالبيانات السابقة لذلك المنتج.
- يجب اختبار رابط الأفلييت من AliExpress Link Checker قبل نشره.
- الأسعار والتوفر قابلة للتغير ويجب أن يراجعها العميل داخل AliExpress.
