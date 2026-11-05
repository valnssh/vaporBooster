# Обслуживание полной установки

Команды выполняются из корня репозитория. Сначала определите сокращение:

```bash
dc() { sudo docker compose --project-name hoursbooster --env-file .private/full-stack/compose.env -f deploy/full-stack/compose.yml "$@"; }
dc ps
```

## Резервная копия

Остановите приложение и Keycloak, чтобы согласовать данные авторизации.
PostgreSQL оставьте работающим. Копируйте обе БД и приватные ключи вместе:

```bash
umask 077
backup="backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup"
dc stop vaporbooster keycloak
dc exec -T postgres pg_dump -U postgres -Fc hoursbooster > "$backup/hoursbooster.dump.part" && mv "$backup/hoursbooster.dump.part" "$backup/hoursbooster.dump"
dc exec -T postgres pg_dump -U postgres -Fc keycloak > "$backup/keycloak.dump.part" && mv "$backup/keycloak.dump.part" "$backup/keycloak.dump"
sudo cp -a .private/full-stack "$backup/private"
sudo cp -a certs/full-stack "$backup/certificates"
dc start keycloak vaporbooster
```

При ошибке копирования не считайте копию готовой; устраните причину и повторите.
Защитите и зашифруйте каталог, держите отдельную копию вне сервера. Сохраняйте
`auth_secret`/`BETTER_AUTH_SECRET`: без него Steam-токены не расшифруются.
Не применяйте `down --volumes` и очистку Docker volumes на рабочей установке.

Проверка восстановления: в **отдельной тестовой установке** создайте базу,
например `hoursbooster_restore`, от администратора PostgreSQL и выполните
`pg_restore -U postgres -d hoursbooster_restore /путь/hoursbooster.dump` внутри
контейнера PostgreSQL. Предварительно передайте dump командой `dc cp` в `/tmp`.
Проверьте записи и запуск приложения с восстановленными секретами. Не направляйте
восстановленную тестовую копию с активными Steam-аккаунтами в интернет одновременно
с рабочей. Встроенный `tests/full-stack-smoke.py` проверяет восстановление обеих
БД только на синтетической установке `--test`.

## Обновление

Сделайте проверенную резервную копию, прочитайте CHANGELOG, затем:

```bash
git pull --ff-only
sudo python3 deploy/full-stack/setup.py --settings .private/full-stack/settings.env
dc ps
```

Первый переход с SQLite выполняйте по [отдельной инструкции](MIGRATE_POSTGRESQL.ru.md).
Не меняйте сохранённые домены, OIDC client secret и ключ шифрования произвольно.
Журналы Docker ограничены по размеру; история чатов автоматически не удаляется.

## Сертификаты

После внешнего продления Certbot обновите **обе** PEM-копии в
`certs/full-stack/nginx` с правами из инструкции установки, затем:

```bash
dc exec -T proxy nginx -t
dc exec -T proxy nginx -s reload
```

Внутренние сертификаты обновляйте до истечения 397 дней, например раз в полгода:

```bash
sudo python3 deploy/full-stack/setup.py --settings .private/full-stack/settings.env --renew-internal-tls
```

Команда сохраняет CA и секреты, пересоздаёт контейнеры. Не удаляйте `.private` ради
перевыпуска. Если Nginx не запустился после перезагрузки при привязке к конкретному
IP, убедитесь, что адрес уже назначен интерфейсу, затем выполните `dc start proxy`.
