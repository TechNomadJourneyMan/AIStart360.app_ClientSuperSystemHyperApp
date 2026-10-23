# План: убрать файлы клиентов из бакета `documents` (2026-10-23)

> **Статус: ПЛАН. Не запускать без явного одобрения PO.** Локальный `.env` указывает на
> ПРОДОВУЮ базу: всё, что ниже помечено «запись», — изменение прода.

## 1. Что уже сделано в коде (без изменений данных)

| Что | Где | Статус |
|---|---|---|
| Шаг 6 «Скрипты» (`s6n_script_*`) грузит через пайплайн документов (приватный `client-documents`, строка `documents`, `question_key`), ответ = `<bucket>/<path>`, не URL | `components/onboarding/shared/FileUploadField.tsx`, `lib/documents/survey-files.ts` | в main (`0fc27658`) |
| Все ссылки на файлы идут через `GET /api/v1/files/documents?bucket=…&path=…` (проверка доступа → 302 на подписанную ссылку на 10 мин); старые публичные URL разбираются в путь | `lib/documents/file-route.ts`, `lib/documents/file-access.ts` | в main |
| Выгрузка в Google Sheets, GIGA User 360, plain-представления, промпт Точки А не отдают URL Storage | `lib/survey/export.ts`, `components/giga-panel/user360/SurveyTab.tsx`, … | в main |
| Миграция 133: бакет `documents` приватный, политики только «свой `<uid>/…`», anon убран, самопроверка | `supabase/migrations/133_documents_bucket_private.sql` | **написана, НЕ применена** |
| Шаг 1 «Загрузка данных за 3 года» (`s1_uploaded_files`) — через пайплайн, строка `documents`, `question_key = s1_uploaded_files`, «Открыть» через маршрут | `components/onboarding/steps/Step1CompanyForm.tsx`, `lib/survey/uploaded-files.ts` | эта ветка |
| Анкета клиники (`/api/v1/onboarding/medical`) пишет в `client-documents` с `storage_bucket/storage_path` | `app/api/v1/onboarding/medical/route.ts` | эта ветка |

После выкладки этой ветки **ни один путь кода больше не пишет в бакет `documents`**.
Читают его (только через service role или маршрут с проверкой доступа):
`lib/documents/storage.ts` `locationForDocument` (старые строки с голым путём / публичным URL),
`/api/medical/{intake/validate,audit/run}`, обработка документов, `documentDownloadUrl`.

## 2. Порядок выкладки

1. Задеплоить код (эта ветка). Проверить на проде: шаг 6 и шаг 1 — загрузка, «Открыть»,
   файл виден в «Моих документах»; анкета клиники — загрузка базы пациентов.
2. **[одобрение PO]** Применить миграцию 133 (`node scripts/apply-migration.js supabase/migrations/133_documents_bucket_private.sql`).
   С этого момента публичные URL перестают открываться, а маршрут продолжает работать
   (он подписывает ссылки service-role'ом). Это закрывает утечку сразу, ДО переноса объектов.
3. **[одобрение PO]** Перенос объектов и переписывание ответов (раздел 4) — можно позже,
   это уборка, а не закрытие дыры.

Откат шага 2: `UPDATE storage.buckets SET public = true WHERE id = 'documents'` (не рекомендуется,
возвращает утечку); политики 133 не мешают коду, их откатывать не нужно.

## 3. Сверка перед переносом (только чтение)

Выполнять в транзакции `BEGIN READ ONLY; … ROLLBACK;`. 2026-10-23 сверить не удалось: прод
отвечал `too_many_connections` (Storage API 429, PostgREST 504, пулер 5432/6543 не выдавал соединение).

```sql
-- 3.1 бакеты
select id, public from storage.buckets order by id;

-- 3.2 все объекты бакета documents, по папкам (ожидаем 18: 2 под */s6n_script_*)
select name, (metadata->>'size')::bigint as bytes, created_at
from storage.objects where bucket_id = 'documents' order by created_at;

-- 3.3 строки documents, которые указывают в бакет documents
select id, user_id, doc_type, storage_bucket, storage_path, file_url
from public.documents
where storage_bucket = 'documents'
   or file_url like '%/object/public/documents/%'
   or (storage_bucket is null and file_url is not null and file_url !~ '^https?://');

-- 3.4 ответы анкеты со ссылкой на бакет documents (ожидаем 2 строки s6n_script_*)
select user_id, key, value from public.survey_answers
where value::text like '%/storage/v1/object/%/documents/%';

-- 3.5 шаг 1: файлы без строки documents (ответ s1_uploaded_files)
select sa.user_id, f->>'path' as path, f->>'name' as name, f->>'kind' as kind
from public.survey_answers sa,
     jsonb_array_elements(case when jsonb_typeof(sa.value) = 'array' then sa.value
                               else coalesce(sa.value->'value', '[]'::jsonb) end) f
where sa.key = 's1_uploaded_files'
  and not exists (select 1 from public.documents d
                  where d.storage_bucket = 'client-documents' and d.storage_path = f->>'path');
```

Каждый объект из 3.2 классифицировать:

| Класс | Признак | Действие |
|---|---|---|
| A. Скрипт шага 6 | `<uid>/s6n_script_*/…`, есть ответ в 3.4 | перенос + строка `documents` + ответ `client-documents/<path>` |
| B. База пациентов | `<uid>/medical/…`, есть строка в 3.3 | перенос + обновить `storage_bucket/storage_path/file_url` строки |
| C. Прочее в папке пользователя | `<uid>/…`, без ссылок | перенос + строка `documents` (`doc_type='other'`) — по решению PO |
| D. Корневые (`1775818815053_Contract …docx`) | нет папки `<uid>/` | **владелец неизвестен** — PO решает: найти владельца вручную или удалить после выгрузки копии |

## 4. Перенос (запись — только после одобрения PO)

Скрипт `scripts/migrate-documents-bucket.ts` (написать при одобрении), режимы `--dry-run` (по
умолчанию, только печатает план) и `--apply`. На каждый объект классов A–C:

1. **Копия, не перемещение.** `storage.from('client-documents').copy` не умеет между бакетами →
   скачать service-role'ом (`documentStorage().download` с лимитом 25 МБ) и загрузить в
   `client-documents` по пути `<uid>/migrated/<uuid>.<ext>` (`upsert: false`).
2. **Строка `documents`.** Для A и C — через `finalizeUpload` (`lib/documents/finalize.ts`) с
   `bucket='client-documents'`: та же проверка (preflight, sha256, дедупликация по компании,
   запуск разбора), что и у обычной загрузки. `doc_type`: A → `scripts`, C → `other`;
   A → `question_key = <ключ ответа>` (`linkDocumentToQuestion`). Компания — `companies.user_id = uid`;
   нет компании → объект пропустить и записать в отчёт.
   Для B — обновить существующую строку: `storage_bucket='client-documents'`, `storage_path`,
   `file_url = storage_path` (идентификатор строки не меняется, связи аудита сохраняются).
3. **Ответ анкеты (A).** `survey_answers.value` → `client-documents/<новый path>` с сохранением
   конверта ответа (если значение было `{ value, … }`, менять только `value`). Писать через
   service role одной транзакцией на пользователя; старое значение сохранить в отчёт
   (`scratchpad/…/migrate-documents-report.json`) для отката.
4. **Проверка** после каждого объекта: `createSignedUrl` нового пути отдаёт 200, хэш совпадает.
5. **Удаление старого объекта** — отдельным запуском `--delete-old` только после того, как PO
   проверит выборочно 2–3 файла через «Открыть»; до этого старые объекты лежат в уже приватном
   бакете и никому не видны.

Откат: из отчёта вернуть старые значения `survey_answers.value` / `documents.storage_*`
(старые объекты не удалены до шага 5); новые строки `documents` удалить по id из отчёта.

## 5. Сам бакет `documents`

После шага 4 (и `--delete-old`) бакет пуст, кроме класса D (если PO решит сохранить).
Варианты:
- оставить пустой приватный бакет (код читает его только для старых ссылок — безвредно);
- через релиз после переноса — убрать `'documents'` из `LEGACY_UPLOAD_BUCKETS`
  (`lib/documents/storage.ts`), `FILE_ROUTE_BUCKETS` (`lib/documents/survey-files.ts`) и ветку
  «голого пути» в `locationForDocument`, затем удалить бакет.

`LEGACY_UPLOAD_BUCKETS` сейчас позволяет зарегистрировать объект из `documents` через legacy-тело
`POST /api/v1/documents` (`file_url`). После 133 браузер не может туда писать чужое (только свою
папку), так что риск низкий, но эту лазейку стоит закрыть тем же релизом.

## 6. Вопросы PO

1. Применять миграцию 133 сразу после деплоя кода (рекомендуется — закрывает утечку) или вместе с переносом?
2. Класс C (прочие файлы в папке пользователя): заводить им строки `documents` (появятся в «Моих документах» и уйдут в разбор) или только перенести байты?
3. Класс D (корневые объекты без владельца): удалить / выгрузить и найти владельца?
4. Старые файлы шага 1 без строки `documents` (3.5) — тоже прогнать через `finalizeUpload` (они начнут разбираться и появятся в «Моих документах»)?
