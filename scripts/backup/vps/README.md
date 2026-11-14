# Резервный сервер бэкапов (VPS в Казахстане)

Вторая, независимая от Railway копия базы. Сервер получает каждый дамп, сразу восстанавливает его и проверяет, что восстановилось всё. Последняя проверенная база всегда лежит под именем `a360_current`. Общая схема бэкапов описана в [docs/backup/README.md](../../../docs/backup/README.md).

## Требования

- Ubuntu **24.04 LTS**, 2 vCPU, **4 ГБ** ОЗУ, **80 ГБ** SSD.
- На диске лежат 2 восстановленные базы, 21 зашифрованный дамп за 7 дней и 12 месячных, то есть ~33 дампа. Восстановленная база обычно в 5–15 раз больше сжатого дампа (в учении 1,4 МБ дампа дали базу 22 МБ, но там почти пустые таблицы). Оценка: `33 × D + 2 × 15 × D` ≈ `63 × D`. 80 ГБ хватает при дампе примерно до 1 ГБ. Размер дампа виден в `ops_backup_runs.bytes`: если он подходит к этому порогу, диск нужно увеличить.
- Вход по SSH ключом. Доступ по паролю лучше выключить: `PasswordAuthentication no`.
- Исходящий HTTPS к `api.telegram.org`, если уведомления идут в Telegram.

## Как устроено

```
Railway db-backup ──rsync/SSH (ключ: command="rrsync -wo …/incoming",restrict)──▶ /srv/a360backup/incoming/
   сначала <время>.dump, потом <время>.manifest

systemd a360-restore.path (появился *.manifest) / a360-restore.timer (раз в 30 мин)
   └─ /usr/local/bin/a360-receive-and-restore   (пользователь a360backup)
        sha256 и размер = манифесту
        CREATE DATABASE a360_<время> (template1 с расширениями) → pg_restore --no-owner --no-acl
        сверка: число таблиц public/auth/storage и строки profiles, companies,
                survey_answers, auth.users = манифесту (посчитано в снимке дампа)
        ✓ → a360_current = новая база, прежняя снова a360_<время>, хранится 2 базы
            дамп → age → archive/runs/<время>.dump.age (7 дней) + archive/monthly/<месяц>.dump.age (12)
            открытый дамп удаляется; /var/lib/a360backup/last-success
        ✗ → база-кандидат удаляется, файлы → incoming/failed/, уведомление

systemd a360-backup-check.timer (раз в час): восстановления нет > 10 ч → уведомление (не чаще раза в 6 ч)
```

Ключ Railway на этом сервере умеет только **записать файл во входящие**: никакого shell, чтения, проброса портов (`restrict` плюс `rrsync -wo`). Postgres слушает только `localhost`, а ufw пропускает снаружи один SSH.

## Установка

1. **Ключ передачи** — на своей машине, не на сервере:
   ```bash
   ssh-keygen -t ed25519 -N '' -C railway-db-backup -f a360push
   ```
   `a360push.pub` пойдёт на сервер, `a360push` — в Railway (шаг 4). После этого файлы удалить.
2. **Скопировать** `install.sh` и `receive-and-restore.sh` на сервер и выполнить:
   ```bash
   sudo bash install.sh --push-key "$(cat a360push.pub)"
   # или со своим ключом age: --age-recipient age1…
   ```
   Установка занимает 3–5 минут. Без `--age-recipient` скрипт создаст пару ключей age и **один раз напечатает приватный ключ**. Его нужно сохранить вне сервера, например в менеджере паролей PO. На сервере остаётся только публичный ключ, так что из одного архива на диске дамп не прочитать.
3. **Уведомления**: заполните `/etc/a360backup/backup.env`, файл принадлежит root, права 0640.
   - Telegram: `TELEGRAM_BOT_TOKEN` (лучше отдельный бот или админ-бот портала) и `TELEGRAM_CHAT_ID` (чат супер-админов).
   - Или вебхук: `ALERT_WEBHOOK_URL` и `ALERT_WEBHOOK_SECRET`. Скрипт шлёт `POST {"text": "…"}` с `Authorization: Bearer <secret>`. В портале такого приёмника пока нет. Если он понадобится, его стоит сделать как `/api/ops/backup-report`, чтобы он писал строку `kind='vps'` в `ops_backup_runs`, и тогда сторож портала увидит и VPS.
4. **Railway**, сервис `db-backup` (переменные описаны в docs/backup/README.md §2):
   - `VPS_BACKUP_HOST` — IP или имя сервера; `VPS_BACKUP_PORT` — если SSH не на 22;
   - `VPS_SSH_KEY_B64` — `base64 -w0 a360push` (на macOS: `base64 -i a360push`);
   - `VPS_SSH_KNOWN_HOSTS` — вывод `ssh-keyscan -t ed25519 <host>`. Отпечаток сверить с `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` на самом сервере.
5. **Проверка**: запустить `db-backup` руками и смотреть журнал:
   ```bash
   tail -f /var/log/a360backup/restore.log
   sudo -u a360backup psql -d a360_current -c 'select count(*) from public.profiles'
   systemctl list-timers 'a360-*'
   ```

## Обслуживание

| Задача | Команда |
|---|---|
| Журнал | `/var/log/a360backup/restore.log`, `journalctl -u a360-restore` |
| Какая база текущая | `sudo -u a360backup psql -d postgres -c "select datname, shobj_description(oid,'pg_database') from pg_database where datname like 'a360_%'"` |
| Повторить упавшую поставку | `cd /srv/a360backup/incoming && mv failed/<время>.dump . && mv failed/<время>.manifest .` (дамп первым) |
| Расшифровать архив | `age -d -i key.txt -o x.dump archive/runs/<время>.dump.age` (ключ принести и потом удалить) |
| Восстановить из архива в отдельную базу | `scripts/backup/restore-drill.sh --dump x.dump --manifest archive/runs/<время>.manifest --target-admin-url postgres:///postgres --name a360_manual --keep` |
| Ручная проверка свежести | `sudo -u a360backup a360-receive-and-restore --check` |

**Ошибки `pg_restore`** при восстановлении на обычный Postgres ожидаемы. Это объекты, которые есть только в Supabase: схемы `graphql`, `vault`, `net`, публикации realtime, event triggers. Годность базы решает сверка ключевых таблиц, число ошибок пишется в журнал. Расширения из дампа, которые бывают в обычном Postgres (pgcrypto, uuid-ossp, pg_trgm, citext, vector, pg_stat_statements), заранее созданы в `template1`, в схеме `extensions`.

**Чего этот сервер не делает:** он не заменяет прод автоматически и не принимает подключения снаружи. Читать `a360_current` можно по SSH-туннелю. Файлов Storage здесь нет, они лежат в бакете `db-backups/storage/`. Если понадобятся и на VPS, следующим шагом можно добавить `rclone sync` на сервере.
