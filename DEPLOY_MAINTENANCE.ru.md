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

Проверка восстановления: в **отдельной тестовой установке**, с тем же сокращением
`dc`, задайте `backup` путь к скопированному каталогу резервной копии и выполните:

```bash
for name in hoursbooster keycloak; do
  dc exec -T postgres createdb -U postgres -O "$name" "${name}_restore" || break
  dc exec -T postgres pg_restore -U postgres -d "${name}_restore" < "$backup/$name.dump" || break
done
dc exec -T postgres psql -U postgres -d hoursbooster_restore -c 'SELECT count(*) FROM public."user"; SELECT count(*) FROM steam_chat_message;'
dc exec -T postgres psql -U postgres -d keycloak_restore -c 'SELECT count(*) FROM realm; SELECT count(*) FROM user_entity;'
```

Обе команды восстановления должны завершиться без ошибок; сравните количества
с исходной установкой. Существующие БД этими командами не перезаписываются.
Не запускайте восстановленные активные Steam-аккаунты одновременно с рабочими.
Встроенный `tests/full-stack-smoke.py` проверяет восстановление обеих БД только
на синтетической установке `--test`.

## Обновление

Сделайте проверенную резервную копию, прочитайте CHANGELOG, затем:

```bash
git pull --ff-only
sudo python3 deploy/full-stack/setup.py --settings .private/full-stack/settings.env
dc ps
```

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
