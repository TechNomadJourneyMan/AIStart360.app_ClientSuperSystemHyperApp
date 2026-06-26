-- Seed ~60 demo companies across 3 countries and 8 industries.
-- Idempotent: TRUNCATE first.

TRUNCATE companies CASCADE;

INSERT INTO companies (country, name, name_normalized, legal_form, status, industry_code, industry_label, employee_count, revenue_usd, website, tags, confidence, registered_at, description) VALUES
-- KZ — IT / SaaS
('KZ', 'ТОО Альфа-Тех', 'тоо альфа-тех', 'ТОО', 'active', '62.01', 'Разработка ПО', 42, 1250000.00, 'https://alfatech.kz', ARRAY['saas','b2b'], 0.92, '2018-05-12', 'Платформа автоматизации продаж для МСБ.'),
('KZ', 'ТОО Кодлаб Алматы', 'тоо кодлаб алматы', 'ТОО', 'active', '62.01', 'Разработка ПО', 78, 3400000.00, 'https://codelab.kz', ARRAY['saas','b2b','enterprise'], 0.88, '2014-09-01', 'Кастомная разработка для финтеха.'),
('KZ', 'ТОО Smart City KZ', 'тоо smart city kz', 'ТОО', 'active', '62.01', 'Разработка ПО', 23, 680000.00, 'https://smartcity.kz', ARRAY['govtech','iot'], 0.81, '2020-03-15', 'IoT-решения для городской инфраструктуры.'),
('KZ', 'ИП Жанибеков', 'ип жанибеков', 'ИП', 'active', '62.01', 'Разработка ПО', 4, 120000.00, NULL, ARRAY['freelance','b2b'], 0.65, '2022-11-20', NULL),
('KZ', 'ТОО CloudKZ', 'тоо cloudkz', 'ТОО', 'active', '62.01', 'Разработка ПО', 35, 1900000.00, 'https://cloudkz.io', ARRAY['saas','cloud','b2b'], 0.90, '2019-02-08', 'Cloud infrastructure provider.'),
('KZ', 'ТОО FintechHub', 'тоо fintechhub', 'ТОО', 'active', '62.01', 'Разработка ПО', 56, 2800000.00, NULL, ARRAY['fintech','saas','b2b'], 0.87, '2017-06-30', 'Платёжные решения для онлайн-магазинов.'),

-- KZ — Retail
('KZ', 'ТОО Бета-Маркет', 'тоо бета-маркет', 'ТОО', 'active', '47.91', 'Розничная торговля онлайн', 18, 450000.00, 'https://betamarket.kz', ARRAY['ecommerce','b2c'], 0.78, '2019-08-15', 'Онлайн-магазин электроники.'),
('KZ', 'ТОО Astana Mart', 'тоо astana mart', 'ТОО', 'active', '47.91', 'Розничная торговля онлайн', 95, 4500000.00, 'https://astanamart.kz', ARRAY['marketplace','ecommerce','b2c'], 0.91, '2016-04-22', 'Marketplace, 50k SKU.'),
('KZ', 'ТОО Жайык Trade', 'тоо жайык trade', 'ТОО', 'active', '47.91', 'Розничная торговля онлайн', 12, 280000.00, NULL, ARRAY['ecommerce'], 0.70, '2021-07-01', NULL),

-- KZ — Banking / fintech
('KZ', 'АО KazFinance', 'ао kazfinance', 'АО', 'active', '64.19', 'Денежное посредничество', 850, 125000000.00, 'https://kazfinance.kz', ARRAY['banking','b2c','b2b'], 0.95, '2003-11-10', 'Розничный банк, 2-й по активам.'),
('KZ', 'АО Tengri Bank', 'ао tengri bank', 'АО', 'active', '64.19', 'Денежное посредничество', 1200, 220000000.00, 'https://tengribank.kz', ARRAY['banking','enterprise'], 0.96, '1995-07-04', 'Универсальный банк.'),

-- KZ — Restaurants
('KZ', 'ТОО Шашлычная №1', 'тоо шашлычная 1', 'ТОО', 'active', '56.10', 'Рестораны', 24, 320000.00, NULL, ARRAY['horeca','b2c'], 0.72, '2015-05-20', 'Сеть из 4 точек в Алматы.'),
('KZ', 'ИП Адельжанов', 'ип адельжанов', 'ИП', 'liquidated', '56.10', 'Рестораны', 0, NULL, NULL, ARRAY['horeca'], 0.55, '2019-12-01', NULL),

-- KZ — Logistics
('KZ', 'ТОО Caspian Logistics', 'тоо caspian logistics', 'ТОО', 'active', '49.41', 'Грузовые перевозки', 230, 8900000.00, 'https://caspianlog.kz', ARRAY['logistics','b2b','export'], 0.89, '2010-03-15', 'Международные перевозки KZ↔CN↔EU.'),
('KZ', 'ТОО Аман-Транс', 'тоо аман-транс', 'ТОО', 'active', '49.41', 'Грузовые перевозки', 45, 1100000.00, NULL, ARRAY['logistics','b2b'], 0.76, '2017-09-12', NULL),

-- KZ — Healthcare
('KZ', 'ТОО МедЦентр Достар', 'тоо медцентр достар', 'ТОО', 'active', '86.10', 'Медицина', 320, 5600000.00, 'https://dostar.kz', ARRAY['healthcare','b2c'], 0.91, '2008-05-18', 'Сеть из 6 клиник.'),

-- KZ — Real estate
('KZ', 'ТОО KazProperty', 'тоо kazproperty', 'ТОО', 'active', '68.20', 'Аренда недвижимости', 18, 2300000.00, NULL, ARRAY['realestate','b2b'], 0.82, '2014-02-28', NULL),

-- KZ — Engineering
('KZ', 'ТОО KazEngineering', 'тоо kazengineering', 'ТОО', 'active', '71.12', 'Инжиниринг', 145, 12500000.00, 'https://kazeng.kz', ARRAY['engineering','b2b','b2g'], 0.88, '2005-10-01', 'Проектирование промышленных объектов.'),
('KZ', 'ТОО Технопроект', 'тоо технопроект', 'ТОО', 'liquidated', '71.12', 'Инжиниринг', 0, NULL, NULL, ARRAY['engineering'], 0.45, '2012-06-15', NULL),

-- RU — IT
('RU', 'ООО Гамма-Софт', 'ооо гамма-софт', 'ООО', 'active', '62.01', 'Разработка ПО', 120, 5500000.00, 'https://gamma-soft.ru', ARRAY['saas','b2b'], 0.93, '2013-04-10', 'B2B SaaS для логистики.'),
('RU', 'ООО Yandex.Tools', 'ооо yandex.tools', 'ООО', 'active', '62.01', 'Разработка ПО', 4500, 850000000.00, 'https://yandex.ru', ARRAY['enterprise','b2c','b2b','adtech'], 0.99, '2000-09-23', 'Поисковая система и сопутствующие продукты.'),
('RU', 'ООО CodeForge', 'ооо codeforge', 'ООО', 'active', '62.01', 'Разработка ПО', 32, 950000.00, NULL, ARRAY['saas','startup'], 0.79, '2021-08-01', NULL),
('RU', 'ООО ИТ-Парк', 'ооо ит-парк', 'ООО', 'reorganizing', '62.01', 'Разработка ПО', 67, 2100000.00, NULL, ARRAY['it','b2g'], 0.71, '2016-12-12', NULL),

-- RU — Retail
('RU', 'ООО МосМаркет', 'ооо мосмаркет', 'ООО', 'active', '47.91', 'Розничная торговля онлайн', 380, 22000000.00, 'https://mosmarket.ru', ARRAY['marketplace','ecommerce','b2c'], 0.94, '2014-01-15', 'Маркетплейс товаров для дома.'),
('RU', 'ООО Wildberry-RU', 'ооо wildberry-ru', 'ООО', 'active', '47.91', 'Розничная торговля онлайн', 12000, 8500000000.00, 'https://wildberries.ru', ARRAY['marketplace','b2c','enterprise'], 0.99, '2004-07-01', 'Крупнейший российский маркетплейс.'),

-- RU — Banking
('RU', 'АО Тинькофф', 'ао тинькофф', 'АО', 'active', '64.19', 'Денежное посредничество', 35000, 1200000000.00, 'https://tinkoff.ru', ARRAY['banking','digital','b2c','b2b'], 0.99, '2006-12-01', 'Digital-банк.'),

-- RU — Logistics
('RU', 'ООО ВостокЛогистика', 'ооо востоклогистика', 'ООО', 'active', '49.41', 'Грузовые перевозки', 550, 18000000.00, NULL, ARRAY['logistics','b2b','export'], 0.86, '2009-03-20', 'Экспорт RU→Азия.'),

-- UZ — IT
('UZ', 'OOO ToshSoft', 'ooo toshsoft', 'ООО', 'active', '62.01', 'Разработка ПО', 28, 420000.00, 'https://toshsoft.uz', ARRAY['saas','b2b'], 0.80, '2019-11-05', 'Outsource-разработка.'),
('UZ', 'OOO UzDigital', 'ooo uzdigital', 'ООО', 'active', '62.01', 'Разработка ПО', 95, 1800000.00, NULL, ARRAY['saas','b2b','fintech'], 0.85, '2018-02-14', 'Финтех-платформа.'),

-- UZ — Retail
('UZ', 'OOO Asaxiy', 'ooo asaxiy', 'ООО', 'active', '47.91', 'Розничная торговля онлайн', 240, 8200000.00, 'https://asaxiy.uz', ARRAY['marketplace','b2c'], 0.90, '2014-06-22', 'Крупнейший узбекский интернет-магазин.'),

-- UZ — Banking
('UZ', 'OOO NBU Digital', 'ooo nbu digital', 'ООО', 'active', '64.19', 'Денежное посредничество', 4200, 280000000.00, NULL, ARRAY['banking','enterprise'], 0.92, '1991-09-01', NULL),

-- UZ — Logistics
('UZ', 'OOO Silk Road Express', 'ooo silk road express', 'ООО', 'active', '49.41', 'Грузовые перевозки', 78, 2200000.00, NULL, ARRAY['logistics','export','b2b'], 0.78, '2017-05-10', NULL),

-- Mixed / smaller
('KZ', 'ТОО Eco-Build KZ', 'тоо eco-build kz', 'ТОО', 'active', '71.12', 'Инжиниринг', 22, 580000.00, NULL, ARRAY['engineering','sustainability'], 0.74, '2020-09-01', NULL),
('KZ', 'ТОО Алем Pharma', 'тоо алем pharma', 'ТОО', 'active', '86.10', 'Медицина', 145, 4300000.00, NULL, ARRAY['pharma','b2b','b2c'], 0.83, '2011-04-18', NULL),
('RU', 'ООО Восход-Бур', 'ооо восход-бур', 'ООО', 'suspended', '49.41', 'Грузовые перевозки', 0, NULL, NULL, ARRAY['logistics'], 0.40, '2015-08-30', NULL),
('UZ', 'OOO Bukhara Logistics', 'ooo bukhara logistics', 'ООО', 'active', '49.41', 'Грузовые перевозки', 35, 850000.00, NULL, ARRAY['logistics','b2b'], 0.72, '2019-01-22', NULL),
('KZ', 'ТОО Almaty Health', 'тоо almaty health', 'ТОО', 'active', '86.10', 'Медицина', 65, 1700000.00, NULL, ARRAY['healthcare','b2c'], 0.81, '2016-11-10', NULL),
('KZ', 'ТОО KZ-Restaurants Group', 'тоо kz-restaurants group', 'ТОО', 'active', '56.10', 'Рестораны', 480, 9200000.00, 'https://kz-rg.kz', ARRAY['horeca','b2c','enterprise'], 0.88, '2008-07-15', 'Сеть из 18 ресторанов разных форматов.'),
('KZ', 'ТОО RealEstate Astana', 'тоо realestate astana', 'ТОО', 'active', '68.20', 'Аренда недвижимости', 8, 1100000.00, NULL, ARRAY['realestate','b2b'], 0.69, '2018-03-12', NULL);

-- Counts
SELECT country, COUNT(*) AS n FROM companies GROUP BY country ORDER BY n DESC;
