/**
 * AIStart360 · приёмник анкеты для Google Sheets (Google Apps Script, Web App).
 *
 * Портал (app/api/v1/onboarding/survey → lib/integrations/google-sheets.ts)
 * при каждом сохранении анкеты делает POST с JSON:
 *   { secret?: string, tab: string, headers: string[], values: string[] }
 *
 * Скрипт:
 *   1. проверяет секрет (если задан в Свойствах скрипта: WEBHOOK_SECRET);
 *   2. находит/создаёт лист `tab`;
 *   3. записывает строку заголовков (1-я строка), если она пустая или изменилась;
 *   4. ищет строку, где колонка A == values[0] (user_id) → обновляет её,
 *      иначе дописывает новую;
 *   5. отвечает JSON { ok, action: 'inserted'|'updated', row, url }.
 *
 * Установка — см. scripts/google-apps-script/README.md
 */

var DEFAULT_TAB = 'Анкета';

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) || '{}';
    var body = JSON.parse(raw);

    var secret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET') || '';
    if (secret && body.secret !== secret) {
      return json_({ ok: false, error: 'forbidden' });
    }

    var headers = body.headers;
    var values = body.values;
    if (!Array.isArray(headers) || !Array.isArray(values) || values.length === 0) {
      return json_({ ok: false, error: 'bad payload: headers[] and values[] are required' });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tabName = String(body.tab || DEFAULT_TAB);
    var sheet = ss.getSheetByName(tabName) || ss.insertSheet(tabName);

    // Две параллельные записи не должны создать дубликат строки пользователя.
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var width = Math.max(headers.length, values.length);
      if (sheet.getMaxColumns() < width) {
        sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
      }

      // Заголовки — только если отсутствуют или изменились (новые вопросы в анкете).
      var lastCol = sheet.getLastColumn();
      var existing = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
      var same = existing.length >= headers.length;
      for (var i = 0; same && i < headers.length; i++) {
        if (String(existing[i] || '') !== String(headers[i])) same = false;
      }
      if (!same) {
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        sheet.setFrozenRows(1);
        sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      }

      // Поиск строки по ключу (колонка A = user_id).
      var lastRow = sheet.getLastRow();
      var rowNumber = -1;
      var key = String(values[0]);
      if (lastRow >= 2) {
        var keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
        for (var r = 0; r < keys.length; r++) {
          if (String(keys[r][0]) === key) { rowNumber = r + 2; break; }
        }
      }
      var action = rowNumber === -1 ? 'inserted' : 'updated';
      if (rowNumber === -1) rowNumber = lastRow + 1;

      var cells = values.map(function (v) { return v === null || v === undefined ? '' : String(v); });
      sheet.getRange(rowNumber, 1, 1, cells.length).setValues([cells]);

      return json_({ ok: true, action: action, row: rowNumber, url: ss.getUrl() });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/** Проверка, что деплой живой: откройте /exec URL в браузере. */
function doGet() {
  return json_({ ok: true, service: 'aistart360-survey-sheet', tab: DEFAULT_TAB });
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Ручной тест из редактора: Запустить → testUpsert. Создаст/обновит строку TEST-USER. */
function testUpsert() {
  var fake = {
    postData: {
      contents: JSON.stringify({
        secret: PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET') || undefined,
        tab: DEFAULT_TAB,
        headers: ['user_id', 'Обновлено', 'Email', 'Компания'],
        values: ['TEST-USER', new Date().toISOString(), 'test@example.com', 'ТОО Тест'],
      }),
    },
  };
  Logger.log(doPost(fake).getContent());
}
