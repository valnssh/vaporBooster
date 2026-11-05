# HoursBooster: Debian 13, nginx, PostgreSQL и Keycloak

Для **нового Debian 13** с `sudo` и двумя настоящими поддоменами.
Домашняя ВМ с частным IP подходит. Готовые сертификаты подключаются из папки проекта.
Другие Linux подходят для контейнеров, но команды установки Docker ниже — для Debian.
Практический стартовый запас: 2 vCPU, 4 ГБ RAM, 20 ГБ свободного диска;
это рекомендация, а не измеренный минимум. Node, Deno, Java и PostgreSQL на хост ставить не нужно.

Комплект устанавливает **nginx → HoursBooster / Keycloak → PostgreSQL**.
HoursBooster и Keycloak хранят данные в **PostgreSQL**, в отдельных БД
`hoursbooster` и `keycloak` с отдельными ролями без прав администратора.
Пароли, обе БД и роли, realm `hours`, OIDC-клиент `hoursbooster`
и пользователь `operator` создаются автоматически. Вручную SQL и OIDC-секреты вводить не нужно.
nginx перенаправляет HTTP (TCP 80) на HTTPS (TCP 443). Приложение, Keycloak
и PostgreSQL принимают только защищённые внутренние соединения с проверкой сертификатов.

## 1. Сервер и DNS

Выберите два имени, например `hours.ВАШ-ДОМЕН` и `auth.ВАШ-ДОМЕН`.
Имена `hours` без настоящего домена для Let's Encrypt не подходят.

Для домашней ВМ настройте локальный DNS роутера: оба имени → IP ВМ, например
`192.168.1.50`. На самой ВМ можно добавить в `/etc/hosts` строку
`127.0.0.1 hours.ВАШ-ДОМЕН auth.ВАШ-ДОМЕН`. На клиентских компьютерах имена должны
вести на IP ВМ. Контейнеры получают нужные DNS-псевдонимы автоматически.
Для локального доступа публичные A-записи не обязательны.
Параметр `SERVER_IP` больше не нужен.

Для доступа из интернета направьте публичные A-записи на внешний IP роутера и
пробросьте TCP 80/443 на ВМ. Для доступа только из LAN проброс не нужен.
Порты 80/443 на ВМ должны быть свободны; 5432/8080/8443 наружу не открывайте.
Docker может обходить UFW: учитывайте firewall роутера/хостинга.
Исходящий HTTPS к Steam и реестрам контейнеров необходим. Выпуск и автоматическое
продление сертификатов настройте внешним Certbot отдельно от этого комплекта.

На свежем Debian установите инструменты и Docker из официального APT-репозитория:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git python3 openssl nano less
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: trixie
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker compose version
```

Если Docker уже установлен, достаточно проверить последнюю команду.
Не удаляйте пакеты/данные существующего Docker вслепую; при конфликте пакетов используйте
[официальную инструкцию Debian](https://docs.docker.com/engine/install/debian/).

## 2. Настройки и сертификаты

```bash
git clone https://github.com/isbigguy/HoursBooster.git
cd HoursBooster
umask 077
mkdir -p .private/full-stack
cp deploy/full-stack/settings.example.env .private/full-stack/settings.env
nano .private/full-stack/settings.env
```

Замените значения в файле (без кавычек, пробелов и комментариев после значения):

```dotenv
HOURS_DOMAIN=hours.example.com
AUTH_DOMAIN=auth.example.com
STEAM_ALLOWED_IDS=76561198000000001
EDGE_SUBNET=172.28.0.0/24
```

- `HOURS_DOMAIN` / `AUTH_DOMAIN`: ваши два DNS-имени **без** `https://`, пути и порта.
- `STEAM_ALLOWED_IDS`: ваши SteamID64, 17 цифр, несколько — через запятую без пробелов.
  В Steam откройте свой профиль → «Редактировать профиль» → «Основное»:
  очистите поле «Личная ссылка», сохраните и откройте профиль; число в адресе
  `steamcommunity.com/profiles/ЧИСЛО` — SteamID64. Свою личную ссылку можно вернуть.
- `EDGE_SUBNET`: оставьте как есть; при пересечении с LAN/VPN/Docker выберите свободную
  частную подсеть `/24`, например `172.29.0.0/24`.

В nano: `Ctrl+O`, Enter, `Ctrl+X`.

Подготовьте сертификат с обоими именами в SAN и соответствующий приватный ключ.
Если их обслуживает Certbot, команда `sudo certbot certificates` показывает реальные пути.
Скопируйте **файлы**, не символьные ссылки, заменив `/ПУТЬ/` на выведенный путь:

```bash
sudo install -d -m 0750 -o 101 -g 101 certs/full-stack/nginx
sudo install -m 0444 /ПУТЬ/fullchain.pem certs/full-stack/nginx/fullchain.pem
sudo install -m 0400 -o 101 -g 101 /ПУТЬ/privkey.pem certs/full-stack/nginx/privkey.pem
sudo python3 deploy/full-stack/setup.py --settings .private/full-stack/settings.env
```

Установщик проверяет оба имени, цепочку, срок сертификата и соответствие ключа,
создаёт пароли и внутренний CA, запускает четыре контейнера и проверяет HTTPS.
Он не выпускает публичные сертификаты. Не применяйте `--test` на рабочем сервере.

| Путь                                   | Содержимое                                             |
| -------------------------------------- | ------------------------------------------------------ |
| `certs/full-stack/nginx/fullchain.pem` | публичный сертификат с промежуточной цепочкой          |
| `certs/full-stack/nginx/privkey.pem`   | соответствующий приватный ключ; UID 101, права `0400`  |
| `.private/full-stack/nginx.conf`       | готовая конфигурация из `deploy/full-stack/nginx.conf` |

nginx читает папку сертификатов только для чтения и работает без root.
Сертификаты и приватные настройки исключены из Git и образа. Внутренние сертификаты
сервисов выпускаются отдельно; их CA не нужно устанавливать на клиентские компьютеры.
После продления внешний Certbot должен обновить обе PEM-копии с теми же правами
и выполнить проверку/reload nginx из [инструкции обслуживания](DEPLOY_MAINTENANCE.ru.md).
Настройки DNS API, токены и скрипты Certbot храните вне репозитория.

## 3. Первый вход и администратор Keycloak

```bash
sudo less .private/full-stack/credentials.txt
```

Файл содержит **два разных пароля**. `q` закрывает просмотр; никому их не отправляйте.

1. Откройте `https://ВАШ-HOURS_DOMAIN`, нажмите Keycloak, войдите как **operator**
   с первым паролем. Это обычный пользователь панели.
2. Смените его пароль: `https://ВАШ-AUTH_DOMAIN/realms/hours/account/` →
   **Account security → Signing in → Password → Update**.
3. Откройте `https://ВАШ-AUTH_DOMAIN/admin/`, войдите как **bootstrap-admin** со вторым
   паролем. В левом верхнем переключателе выберите realm **master**.
4. **Users → Add user**: заполните Username, Email, First name, Last name,
   включите Enabled и нажмите Create.
   На вкладке **Credentials → Set password** задайте уникальный пароль,
   отключите Temporary и сохраните. **Role mapping → Assign role → Filter by realm roles**:
   выберите **admin**, нажмите Assign.
5. В отдельном приватном окне проверьте вход новым администратором в `/admin/`.
   Только после успешной проверки удалите `bootstrap-admin` через **master → Users → Delete**.
   Пароли работающего Keycloak меняют здесь, а не в `state.json`.

Для нового пользователя панели: **realm hours → Users → Add user**, укажите Username,
Email, First name и Last name, включите Enabled и Email verified только для проверенного
вами адреса; затем **Credentials → Set password**. Temporary можно включить для смены
при первом входе. Роль `admin` ему не нужна; публичная регистрация закрыта.

Steam-вход необязателен для работы через Keycloak, но allowlist нужен установщику.
Чтобы оба способа открывали один профиль: сначала войдите через Keycloak →
**Link Steam sign-in** → подтвердите на сайте Steam. Отдельный первый вход через Steam
создаёт другой профиль. Steam Web API key не нужен. Аккаунты для бустинга добавляются
отдельно внутри панели паролем/Steam Guard или QR.

## 4. После установки

Если у вас уже работает SQLite-версия, сначала выполните
[перенос с проверкой данных](MIGRATE_POSTGRESQL.ru.md), а не обычную новую установку.

Команды проверки, резервного копирования, обновления и продления внутренних
сертификатов: [обслуживание](DEPLOY_MAINTENANCE.ru.md). Сохраните эту инструкцию.
