# أتمتة منتجات AliExpress

المتجر يقرأ المنتجات من `products.json`. يتم تحديث المنتجات المدارة في `products-source.json` بواسطة GitHub Actions عبر `scripts/update-products.js`.

## الإعداد مرة واحدة

من مستودع GitHub افتح:

`Settings → Secrets and variables → Actions → New repository secret`

أضف الأسرار التالية:

- `ALIEXPRESS_APP_KEY`: AppKey من AliExpress App Console.
- `ALIEXPRESS_APP_SECRET`: App Secret من AliExpress App Console.
- `ALIEXPRESS_TRACKING_ID`: Tracking ID من AliExpress Portals.

لا تضع هذه القيم في HTML أو JavaScript أو أي ملف يتم رفعه للمستودع. إذا تم كشف App Secret سابقاً، اعمل له Reset قبل إضافته إلى GitHub Secrets.

## إضافة منتج جديد

1. أضف المنتج الأساسي إلى `products.json`.
2. أضف له `sourceId` فريداً.
3. أضف نفس `sourceId` إلى `products-source.json`.
4. الأفضل استخدام `itemId` الدقيق. إذا لم يتوفر، استخدم `keywords` إن كانت صلاحية API تسمح بالبحث.
5. شغّل Workflow يدوياً من `Actions → Update AliExpress products → Run workflow`.

## ملاحظات

- المهمة تعمل يومياً الساعة 02:17 UTC، ويمكن تشغيلها يدوياً.
- المفتاح السري لا يصل إلى المتصفح؛ تستخدمه GitHub Actions فقط.
- عند فشل تحديث منتج، يحتفظ السكربت بالبيانات السابقة لذلك المنتج.
- يجب اختبار رابط الأفلييت من AliExpress Link Checker قبل نشره.
- الأسعار والتوفر قابلة للتغير ويجب أن يراجعها العميل داخل AliExpress.
