# Установка на Debian 13

Для новой установки используйте [полную пошаговую инструкцию](DEPLOY_FULL_STACK.ru.md):
она устанавливает Docker, Nginx, HoursBooster, PostgreSQL и Keycloak, создаёт
отдельные базы/роли, OIDC-клиента и первого пользователя. Node.js, Deno и Java
на хост устанавливать не требуется. Домашняя ВМ с внутренним адресом подходит.

Нужны два DNS-имени, доступные клиентам, и сертификат на оба имени в
`certs/full-stack/nginx`. Выпуск и продление внешним Certbot настраиваются вне
репозитория; DNS API credentials в проект не помещаются. Nginx перенаправляет
HTTP на HTTPS, внутренние соединения также проверяют TLS.

Для установки с уже имеющимися PostgreSQL и OIDC-провайдером можно использовать
корневой `compose.yml`: заполните `example.env` → `.env`, настройте PostgreSQL URL,
OIDC, одинаковые HTTPS `ORIGIN`/`BETTER_AUTH_URL`, сильный `BETTER_AUTH_SECRET`.
В `certs` разместите `fullchain.pem`, `privkey.pem` и `database-ca.pem`.
Ключ приложения должен быть доступен UID/GID `1993:1993` с правами `0400`;
сертификаты — для чтения (`0444`). Для публичного CA PostgreSQL можно скопировать
системный набор `/etc/ssl/certs/ca-certificates.crt` в `certs/database-ca.pem`.
Сертификат PostgreSQL должен соответствовать имени хоста в `DATABASE_URL`.

После настройки:

```bash
sudo chown 1993:1993 certs/privkey.pem
sudo chmod 0400 certs/privkey.pem
chmod 0444 certs/fullchain.pem certs/database-ca.pem
sudo docker compose up -d --build
sudo docker compose ps
```

По умолчанию корневой Compose публикует только `127.0.0.1:443`. Для доступа
из LAN/интернета задайте нужный `HTTPS_BIND_IP` и настройте сетевой доступ.
В этом отдельном варианте TLS завершает Deno, HTTP-перенаправления нет;
для схемы с Nginx используйте полную инструкцию выше.

Управление, резервные копии и продление сертификатов описаны в
[инструкции обслуживания](DEPLOY_MAINTENANCE.ru.md).
