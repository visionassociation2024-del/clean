# رفع EliteClean إلى Vercel

هذه الحزمة جاهزة للرفع، ولا تحتوي على ملف `.env` أو أي كلمات مرور.

## قبل إعادة النشر

تأكد من وجود المتغيرات التالية في:

`Vercel Project → Settings → Environment Variables`

- `DATABASE_URL`
- `ADMIN_USERNAME`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADMIN_TOKEN_SECRET`
- `NODE_ENV` وقيمته `production`
- `AUTO_INIT_DB` وقيمته `false`
- `ALLOWED_ORIGINS` وقيمته `https://cleans-six.vercel.app`

فعّل المتغيرات لبيئة `Production`. بعد ذلك ارفع محتويات الحزمة إلى مستودع المشروع أو انشر المجلد باستخدام Vercel CLI، ثم نفّذ إعادة نشر للإنتاج.

## التحقق بعد النشر

- الصفحة الرئيسية: `https://cleans-six.vercel.app/`
- صحة الخادم: `https://cleans-six.vercel.app/api/v1/health`
- الخدمات: `https://cleans-six.vercel.app/api/v1/public/services`
- الحجز: `https://cleans-six.vercel.app/booking.html`
- لوحة الإدارة: `https://cleans-six.vercel.app/admin_dashboard.html`

يجب أن تعرض نقطة فحص الخادم:

```json
{"success":true,"data":{"status":"ok","database":"connected"}}
```
