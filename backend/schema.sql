CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. ADMIN USERS & AUTHENTICATION
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'admin',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ
);

-- ============================================================
-- 2. SERVICE COVERAGE REGIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS service_regions (
    id SERIAL PRIMARY KEY,
    name_ar VARCHAR(150) NOT NULL,
    name_en VARCHAR(150) NOT NULL,
    base_fee DECIMAL(10,2) DEFAULT 0.00,
    is_active BOOLEAN DEFAULT TRUE,
    coverage_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. SERVICES DIRECTORY
-- ============================================================
CREATE TABLE IF NOT EXISTS services (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(100) UNIQUE NOT NULL,
    title_ar VARCHAR(255) NOT NULL,
    title_en VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL DEFAULT 'cleaning',
    description_ar TEXT,
    description_en TEXT,
    image_url TEXT,
    unit_name_ar VARCHAR(80) DEFAULT 'الوحدة',
    unit_name_en VARCHAR(80) DEFAULT 'Unit',
    base_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    min_units INT DEFAULT 1,
    max_units INT DEFAULT 100,
    step_units INT DEFAULT 1,
    estimated_duration_mins INT DEFAULT 60,
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4. PACKAGES (linked to services)
-- ============================================================
CREATE TABLE IF NOT EXISTS packages (
    id SERIAL PRIMARY KEY,
    service_id INT REFERENCES services(id) ON DELETE CASCADE,
    title_ar VARCHAR(255) NOT NULL,
    title_en VARCHAR(255) NOT NULL,
    description_ar TEXT,
    description_en TEXT,
    price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    features_ar TEXT,
    features_en TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 5. ADD-ONS (optional extras per service)
-- ============================================================
CREATE TABLE IF NOT EXISTS add_ons (
    id SERIAL PRIMARY KEY,
    service_id INT REFERENCES services(id) ON DELETE CASCADE,
    title_ar VARCHAR(255) NOT NULL,
    title_en VARCHAR(255) NOT NULL,
    price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 6. CUSTOMERS
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    email VARCHAR(255),
    total_bookings INT DEFAULT 0,
    total_spent DECIMAL(12,2) DEFAULT 0.00,
    notes TEXT,
    is_blocked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

-- ============================================================
-- 7. BOOKINGS MASTER
-- ============================================================
CREATE TABLE IF NOT EXISTS bookings (
    id SERIAL PRIMARY KEY,
    booking_code VARCHAR(30) UNIQUE NOT NULL,
    customer_id INT REFERENCES customers(id),
    customer_name VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(50) NOT NULL,
    customer_email VARCHAR(255),
    region_id INT REFERENCES service_regions(id),
    address_line TEXT NOT NULL,
    latitude DECIMAL(10,8),
    longitude DECIMAL(11,8),
    notes TEXT,
    scheduled_date DATE NOT NULL,
    scheduled_time_slot VARCHAR(80) NOT NULL,
    subtotal DECIMAL(10,2) NOT NULL,
    region_fee DECIMAL(10,2) DEFAULT 0.00,
    discount DECIMAL(10,2) DEFAULT 0.00,
    coupon_code VARCHAR(50),
    vat_amount DECIMAL(10,2) DEFAULT 0.00,
    total_amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'NEW',
    admin_notes TEXT,
    assigned_team VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_bookings_phone ON bookings(customer_phone);

-- ============================================================
-- 8. BOOKING LINE ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS booking_items (
    id SERIAL PRIMARY KEY,
    booking_id INT REFERENCES bookings(id) ON DELETE CASCADE,
    service_id INT REFERENCES services(id),
    package_id INT REFERENCES packages(id),
    service_title_ar VARCHAR(255) NOT NULL,
    service_title_en VARCHAR(255),
    unit_quantity INT DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL
);

-- ============================================================
-- 9. BOOKING STATUS HISTORY (audit log)
-- ============================================================
CREATE TABLE IF NOT EXISTS booking_status_history (
    id SERIAL PRIMARY KEY,
    booking_id INT REFERENCES bookings(id) ON DELETE CASCADE,
    old_status VARCHAR(50),
    new_status VARCHAR(50) NOT NULL,
    changed_by VARCHAR(100) DEFAULT 'SYSTEM',
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 10. WORKING HOURS & DATE EXCEPTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS working_hours (
    id SERIAL PRIMARY KEY,
    day_of_week INT NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    max_slots_per_hour INT DEFAULT 5,
    is_open BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS date_exceptions (
    id SERIAL PRIMARY KEY,
    exception_date DATE NOT NULL UNIQUE,
    is_closed BOOLEAN DEFAULT TRUE,
    custom_notes TEXT
);

-- ============================================================
-- 11. COUPONS & DISCOUNT CODES
-- ============================================================
CREATE TABLE IF NOT EXISTS coupons (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    discount_type VARCHAR(20) NOT NULL DEFAULT 'percentage',
    discount_value DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    min_order DECIMAL(10,2) DEFAULT 0.00,
    max_uses INT DEFAULT 100,
    used_count INT DEFAULT 0,
    valid_from DATE,
    valid_to DATE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 12. NOTIFICATIONS LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    recipient_type VARCHAR(20) NOT NULL DEFAULT 'customer',
    recipient_contact VARCHAR(255) NOT NULL,
    channel VARCHAR(20) NOT NULL DEFAULT 'email',
    subject VARCHAR(255),
    body TEXT,
    booking_id INT REFERENCES bookings(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'pending',
    sent_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_booking ON notifications(booking_id);

-- ============================================================
-- 13. CONTACT FORM MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_messages (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    subject VARCHAR(255),
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    admin_reply TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 14. FAQ ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS faq_items (
    id SERIAL PRIMARY KEY,
    category VARCHAR(50) DEFAULT 'general',
    question_ar TEXT NOT NULL,
    question_en TEXT NOT NULL,
    answer_ar TEXT NOT NULL,
    answer_en TEXT NOT NULL,
    sort_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 15. CMS CONTENT
-- ============================================================
CREATE TABLE IF NOT EXISTS cms_content (
    id SERIAL PRIMARY KEY,
    content_key VARCHAR(100) UNIQUE NOT NULL,
    content_value_ar TEXT,
    content_value_en TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 16. SITE SETTINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS site_settings (
    id SERIAL PRIMARY KEY,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT,
    setting_type VARCHAR(20) DEFAULT 'text',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 17. AUDIT LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INT,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id INT,
    details TEXT,
    ip_address VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SEED DATA
-- ============================================================

-- Safe upgrades for databases created by older EliteClean versions
ALTER TABLE packages ADD COLUMN IF NOT EXISTS features_ar TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS features_en TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;
ALTER TABLE services ADD COLUMN IF NOT EXISTS unit_name_ar VARCHAR(80) DEFAULT 'الوحدة';
ALTER TABLE services ADD COLUMN IF NOT EXISTS unit_name_en VARCHAR(80) DEFAULT 'Unit';
ALTER TABLE services ADD COLUMN IF NOT EXISTS base_price DECIMAL(10,2) DEFAULT 0.00;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_id INT REFERENCES customers(id);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(50);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS assigned_team VARCHAR(255);
ALTER TABLE booking_items ADD COLUMN IF NOT EXISTS service_title_en VARCHAR(255);

-- Remove only exact seed duplicates created by older non-idempotent startup scripts.
DELETE FROM service_regions newer
USING service_regions older
WHERE newer.id > older.id AND newer.name_en = older.name_en;

DELETE FROM packages newer
USING packages older
WHERE newer.id > older.id
  AND newer.service_id = older.service_id
  AND newer.title_en = older.title_en;

DELETE FROM faq_items newer
USING faq_items older
WHERE newer.id > older.id AND newer.question_en = older.question_en;

DELETE FROM working_hours newer
USING working_hours older
WHERE newer.id > older.id AND newer.day_of_week = older.day_of_week;

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_regions_name_en ON service_regions(name_en);
CREATE UNIQUE INDEX IF NOT EXISTS uq_packages_service_title_en ON packages(service_id, title_en);
CREATE UNIQUE INDEX IF NOT EXISTS uq_faq_question_en ON faq_items(question_en);
CREATE UNIQUE INDEX IF NOT EXISTS uq_working_hours_day ON working_hours(day_of_week);

-- Admin User
INSERT INTO admin_users (username, email, password_hash, full_name, role)
VALUES ('admin', 'admin@eliteclean.sa', '$2b$10$WqB8fDq01Fk1d1uD3F0hGeXl5L2S6K9Qe6Q0pL1k0R1S2T3U4V5W6', 'مدير النظام', 'admin')
ON CONFLICT (username) DO NOTHING;

-- Service Regions
INSERT INTO service_regions (name_ar, name_en, base_fee) VALUES
('الرياض والخرج', 'Riyadh & Al-Kharj', 0.00),
('جدة ومكة المكرمة', 'Jeddah & Makkah', 0.00),
('المدينة المنورة', 'Madinah', 25.00),
('الدمام والخبر والجبيل', 'Dammam, Khobar & Jubail', 0.00),
('القصيم وعنيزة', 'Qassim & Onaizah', 30.00),
('أبها والباحة', 'Abha & Al-Baha', 35.00),
('تبوك', 'Tabuk', 40.00),
('حائل', 'Hail', 30.00)
ON CONFLICT DO NOTHING;

-- Services
INSERT INTO services (slug, title_ar, title_en, category, description_ar, description_en, base_price, unit_name_ar, unit_name_en, image_url, estimated_duration_mins) VALUES
('sofa-cleaning', 'تنظيف وتعقيم الأثاث والكنب', 'Sofa & Upholstery Steam Cleaning', 'fabric',
 'غسيل أطقم المجالس والكنب والسجاد بآلات الشفط والتطهير بالبخار الحار لإزالة البقع والميكروبات بالكامل.',
 'Professional steam extraction and deep sanitization for sofas, carpets, and drapes to eliminate stubborn stains and microbes.',
 150.00, 'طقم كنب', 'Sofa Set', 'https://images.unsplash.com/photo-1582735689369-4fe89db7114c?auto=format&fit=crop&q=80&w=800', 90),

('villa-cleaning', 'النظافة التأهيلية للفلل والمباني', 'Post-Construction Deep Villa Cleaning', 'cleaning',
 'تنظيف تأهيلي شامل بعد البناء والتشطيب، جلي الأرضيات والرخام، وتنظيف الواجهات الزجاجية بمعدات متخصصة.',
 'Comprehensive post-construction cleaning including marble polishing, tile scrub, and window glass detailing with industrial equipment.',
 450.00, 'فيلا / شقة', 'Villa / Apartment', 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&q=80&w=800', 180),

('pest-control', 'مكافحة الحشرات والآفات المنزلية', 'Pest Control & Extermination', 'cleaning',
 'رش وقائي وعلاجي لكافة أنواع الآفات بمبيدات آمنة مرخصة صحياً وبيئياً مع ضمان 6 أشهر.',
 'Preventive and curative pest extermination using WHO-approved safe chemicals with 6-month warranty.',
 190.00, 'منزل / شقة', 'Home / Apartment', 'https://images.unsplash.com/photo-1624996379697-f01d168b1a52?auto=format&fit=crop&q=80&w=800', 120),

('ac-maintenance', 'غسيل وصيانة المكيفات', 'AC Deep Washing & Maintenance', 'mep',
 'تنظيف الوحدات الداخلية والخارجية بغطاء عازل، فحص الفريون وزيادة كفاءة التبريد والتوفير في الطاقة.',
 'Internal and external coil washing with protective bags, freon gas checkup, and cooling efficiency optimization.',
 80.00, 'مكيف سبليت', 'Split AC Unit', 'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&q=80&w=800', 45),

('furniture-moving', 'نقل وتغليف الأثاث بين المدن', 'Intercity Furniture Relocation', 'logistics',
 'نقل وتغليف الأثاث بالفقاعات والكرتون، الفك والتركيب عبر نجارين متخصصين بين كافة مدن المملكة.',
 'Bubble wrap packing, cardboard shielding, and carpenter dismantling/re-assembly for intercity moves across Saudi Arabia.',
 500.00, 'غرفة / شحنة', 'Room / Load', 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&q=80&w=800', 240),

('garden-landscaping', 'تنسيق وصيانة الحدائق', 'Landscape & Garden Maintenance', 'logistics',
 'تصميم وتنفيذ حدائق الفلل، قص الأشجار، توريد العشب الطبيعي والصناعي وتمديد شبكات الري الذكية.',
 'Residential garden design, lawn trimming, artificial and natural turf installation, and smart irrigation system setup.',
 300.00, 'حديقة', 'Garden', 'https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?auto=format&fit=crop&q=80&w=800', 180),

('carpet-cleaning', 'غسيل وتنظيف السجاد والموكيت', 'Carpet & Rug Deep Cleaning', 'fabric',
 'غسيل السجاد والموكيت بتقنية الشفط العميق والتجفيف السريع مع إزالة البقع والروائح بالكامل.',
 'Deep extraction carpet and rug cleaning with quick-dry technology, complete stain and odor removal.',
 120.00, 'سجادة / متر', 'Rug / Meter', 'https://images.unsplash.com/photo-1558618666-fcd25c85f82e?auto=format&fit=crop&q=80&w=800', 60),

('plumbing', 'صيانة السباكة والأنابيب', 'Plumbing & Pipe Maintenance', 'mep',
 'كشف تسربات المياه، إصلاح الأنابيب، تركيب وصيانة الأدوات الصحية بكفاءة عالية.',
 'Water leak detection, pipe repair, and sanitary fixture installation and maintenance with expert technicians.',
 200.00, 'زيارة', 'Visit', 'https://images.unsplash.com/photo-1607472586893-edb57bdc0e39?auto=format&fit=crop&q=80&w=800', 90),

('electrical', 'صيانة الكهرباء والإنارة', 'Electrical & Lighting Maintenance', 'mep',
 'تمديدات كهربائية، إصلاح الأعطال، تركيب الإنارة والثريات وصيانة لوحات التحكم الكهربائية.',
 'Electrical wiring, fault repair, lighting and chandelier installation, and control panel maintenance.',
 180.00, 'زيارة', 'Visit', 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?auto=format&fit=crop&q=80&w=800', 90)
ON CONFLICT (slug) DO NOTHING;

-- Packages
INSERT INTO packages (service_id, title_ar, title_en, description_ar, description_en, price, features_ar, features_en, sort_order) VALUES
((SELECT id FROM services WHERE slug='sofa-cleaning'), 'باقة الكنب الأساسية', 'Basic Sofa Package', 'تنظيف طقم كنب واحد حتى 5 مقاعد', 'Single sofa set up to 5 seats', 150.00, 'تنظيف بالبخار|إزالة البقع|تعطير', 'Steam cleaning|Stain removal|Deodorizing', 1),
((SELECT id FROM services WHERE slug='sofa-cleaning'), 'باقة الكنب المتقدمة', 'Premium Sofa Package', 'تنظيف طقمين كنب مع السجاد', 'Two sofa sets with carpet cleaning', 280.00, 'تنظيف بالبخار|إزالة البقع|تعطير|غسيل سجاد|حماية الأقمشة', 'Steam cleaning|Stain removal|Deodorizing|Carpet wash|Fabric protection', 2),
((SELECT id FROM services WHERE slug='villa-cleaning'), 'باقة الشقة', 'Apartment Package', 'تنظيف شقة حتى 3 غرف', 'Apartment up to 3 rooms', 450.00, 'تنظيف شامل|جلي أرضيات|تنظيف حمامات|مطبخ', 'Full cleaning|Floor polishing|Bathroom|Kitchen', 1),
((SELECT id FROM services WHERE slug='villa-cleaning'), 'باقة الفيلا الشاملة', 'Full Villa Package', 'تنظيف فيلا كاملة حتى 6 غرف مع الحديقة', 'Full villa up to 6 rooms including garden', 950.00, 'تنظيف شامل|جلي أرضيات|واجهات|حديقة|مسبح', 'Full cleaning|Floor polishing|Facades|Garden|Pool', 2),
((SELECT id FROM services WHERE slug='pest-control'), 'باقة الرش الأساسية', 'Basic Spray Package', 'رش وقائي للمنزل بالكامل', 'Full home preventive spray', 190.00, 'رش داخلي|رش خارجي|ضمان شهر', 'Indoor spray|Outdoor spray|1-month warranty', 1),
((SELECT id FROM services WHERE slug='pest-control'), 'باقة الحماية السنوية', 'Annual Protection Package', '4 زيارات رش وقائي على مدار السنة', '4 preventive spray visits throughout the year', 650.00, 'رش داخلي|رش خارجي|4 زيارات|ضمان سنة|فحص دوري', 'Indoor spray|Outdoor spray|4 visits|1-year warranty|Regular inspection', 2),
((SELECT id FROM services WHERE slug='ac-maintenance'), 'باقة المكيف الواحد', 'Single AC Package', 'غسيل وصيانة مكيف سبليت واحد', 'Single split AC wash and maintenance', 80.00, 'غسيل داخلي|غسيل خارجي|فحص فريون', 'Internal wash|External wash|Freon check', 1),
((SELECT id FROM services WHERE slug='ac-maintenance'), 'باقة 4 مكيفات', '4-AC Bundle Package', 'غسيل وصيانة 4 مكيفات سبليت بسعر مخفض', 'Wash and maintain 4 split ACs at a discounted rate', 280.00, 'غسيل داخلي|غسيل خارجي|فحص فريون|تعبئة فريون|خصم 12%', 'Internal wash|External wash|Freon check|Freon refill|12% discount', 2)
ON CONFLICT (service_id, title_en) DO NOTHING;

-- Working Hours (Sun=0 to Sat=6)
INSERT INTO working_hours (day_of_week, start_time, end_time, max_slots_per_hour, is_open) VALUES
(0, '08:00', '22:00', 5, TRUE),
(1, '08:00', '22:00', 5, TRUE),
(2, '08:00', '22:00', 5, TRUE),
(3, '08:00', '22:00', 5, TRUE),
(4, '08:00', '22:00', 5, TRUE),
(5, '09:00', '21:00', 3, TRUE),
(6, '09:00', '21:00', 3, TRUE)
ON CONFLICT (day_of_week) DO NOTHING;

-- FAQ Seed Data
INSERT INTO faq_items (category, question_ar, question_en, answer_ar, answer_en, sort_order) VALUES
('booking', 'كيف أحجز خدمة؟', 'How do I book a service?', 'يمكنك الحجز من خلال صفحة الحجز على موقعنا باتباع الخطوات البسيطة: اختر الخدمة، حدد الباقة، أدخل بياناتك واختر الموعد المناسب.', 'You can book through our booking page by following simple steps: select service, choose package, enter your details and pick a convenient time.', 1),
('booking', 'ما المناطق التي تغطونها؟', 'What areas do you cover?', 'نغطي أكثر من 25 مدينة في المملكة العربية السعودية تشمل الرياض، جدة، مكة، المدينة، الدمام، القصيم وغيرها.', 'We cover 25+ cities across Saudi Arabia including Riyadh, Jeddah, Makkah, Madinah, Dammam, Qassim and more.', 2),
('booking', 'هل يمكنني إلغاء الحجز؟', 'Can I cancel my booking?', 'نعم، يمكنك إلغاء الحجز قبل 24 ساعة من الموعد المحدد بدون رسوم. الإلغاء بعد ذلك قد يترتب عليه رسوم.', 'Yes, you can cancel your booking up to 24 hours before the scheduled time at no charge. Late cancellation may incur fees.', 3),
('payment', 'ما وسائل الدفع المتاحة؟', 'What payment methods are available?', 'نقبل الدفع عبر مدى، فيزا، ماستركارد، وأبل باي. كما يمكن الدفع نقداً عند تقديم الخدمة.', 'We accept Mada, Visa, Mastercard, and Apple Pay. Cash payment upon service delivery is also available.', 4),
('services', 'كم تستغرق خدمة التنظيف؟', 'How long does a cleaning service take?', 'يعتمد الوقت على نوع الخدمة وحجم المكان. تنظيف شقة عادية يستغرق 3-4 ساعات، والفيلا 5-8 ساعات.', 'Duration depends on service type and space. A standard apartment takes 3-4 hours, a villa 5-8 hours.', 5),
('services', 'هل توفرون المواد والمعدات؟', 'Do you provide materials and equipment?', 'نعم، فريقنا يأتي مجهزاً بالكامل بجميع المواد والمعدات اللازمة. لا تحتاج لتوفير أي شيء.', 'Yes, our team arrives fully equipped with all necessary materials and equipment. You do not need to provide anything.', 6),
('services', 'هل يوجد ضمان على الخدمة؟', 'Is there a warranty on services?', 'نعم، نقدم ضمان على جميع خدماتنا. مكافحة الحشرات بضمان 6 أشهر، والتنظيف بضمان الرضا الكامل.', 'Yes, we offer warranties on all services. Pest control comes with a 6-month warranty, and cleaning with full satisfaction guarantee.', 7),
('booking', 'كيف أتتبع طلبي؟', 'How do I track my order?', 'بعد الحجز ستحصل على رمز تتبع فريد. يمكنك استخدامه لمتابعة حالة طلبك عبر الموقع أو التواصل مع خدمة العملاء.', 'After booking, you will receive a unique tracking code. Use it to monitor your order status on our website or contact customer support.', 8),
('services', 'هل تقدمون باقات للشركات؟', 'Do you offer corporate packages?', 'نعم، نقدم باقات خاصة للشركات والمؤسسات تشمل عقود صيانة شهرية وسنوية بأسعار تنافسية. تواصل معنا للحصول على عرض مخصص.', 'Yes, we offer special corporate packages including monthly and annual maintenance contracts at competitive rates. Contact us for a custom quote.', 9),
('booking', 'ما سياسة الإلغاء؟', 'What is your cancellation policy?', 'الإلغاء مجاني قبل 24 ساعة. الإلغاء قبل 12 ساعة يترتب عليه 25% من قيمة الخدمة. الإلغاء بعد وصول الفريق يترتب عليه 50%.', 'Free cancellation up to 24 hours prior. Cancellation within 12 hours incurs 25% of service value. Cancellation after team arrival incurs 50%.', 10),
('booking', 'هل يمكن تغيير الموعد؟', 'Can I reschedule my appointment?', 'نعم، يمكنك تغيير الموعد مرة واحدة مجاناً قبل 12 ساعة من الموعد الأصلي. التغييرات الإضافية قد تخضع لرسوم.', 'Yes, you can reschedule once for free up to 12 hours before the original appointment. Additional changes may incur fees.', 11),
('general', 'كيف أتواصل مع الدعم؟', 'How do I contact support?', 'يمكنك التواصل معنا عبر الرقم الموحد 920004107، أو عبر واتساب، أو من خلال نموذج التواصل على الموقع.', 'You can reach us via our unified number 920004107, WhatsApp, or through the contact form on our website.', 12)
ON CONFLICT (question_en) DO NOTHING;

-- Site Settings
INSERT INTO site_settings (setting_key, setting_value, setting_type) VALUES
('site_name_ar', 'إليت كلين', 'text'),
('site_name_en', 'EliteClean', 'text'),
('phone', '920004107', 'text'),
('email', 'support@eliteclean.sa', 'text'),
('whatsapp', '966920004107', 'text'),
('vat_rate', '0.15', 'number'),
('address_ar', 'الرياض، حي المنار', 'text'),
('address_en', 'Riyadh, Al-Manar District', 'text'),
('notification_email_enabled', 'true', 'boolean'),
('notification_sms_enabled', 'false', 'boolean'),
('notification_whatsapp_enabled', 'false', 'boolean')
ON CONFLICT (setting_key) DO NOTHING;

-- Coupons
INSERT INTO coupons (code, discount_type, discount_value, min_order, max_uses, valid_from, valid_to) VALUES
('WELCOME25', 'percentage', 25.00, 200.00, 500, '2026-01-01', '2026-12-31'),
('SUMMER50', 'fixed', 50.00, 300.00, 200, '2026-06-01', '2026-09-30'),
('VIP10', 'percentage', 10.00, 0.00, 1000, '2026-01-01', '2027-12-31')
ON CONFLICT (code) DO NOTHING;
